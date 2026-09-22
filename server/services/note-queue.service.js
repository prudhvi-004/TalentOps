// =============================================================
// NOTE QUEUE SERVICE — note-queue.service.js
// =============================================================
// Purpose:
//   Server-side note retry queue.
//   When an ATS note writeback fails, the note is saved here
//   and retried automatically after 30 minutes.
//
// How it works:
//   1. POST /api/notes is called
//   2. atsService.writeNote() fails or ATS doesn't confirm
//   3. api.routes.js calls NoteQueueService.add(payload)
//   4. This service saves the note and starts a 30-min timer
//   5. After 30 min, it retries atsService.writeNote()
//   6. If success: marks as sent, logs it
//   7. If still failing: marks as failed, triggers notification
//
// In demo mode (ATS_PROVIDER=mock):
//   The mock always returns success so this queue
//   is rarely triggered. To test it manually:
//   Change writeNote() in ats.service.js to return
//   { success: false } temporarily.
//
// For production:
//   Replace the in-memory queue (array below) with a
//   database table (e.g. Postgres table: note_queue)
//   so notes survive server restarts.
//   Use a proper job scheduler like BullMQ or node-cron
//   instead of setTimeout for reliability.
// =============================================================

const atsService = require('./ats.service');

// In-memory queue for demo purposes.
// In production: replace with database persistence.
// Schema: { id, payload, queuedAt, retryAt, retryCount, status, timerId }
const queue = [];

// How long to wait before retrying (30 minutes in milliseconds)
const RETRY_DELAY_MS = 30 * 60 * 1000;

// Maximum number of retry attempts before marking as permanently failed
const MAX_RETRIES = 1;

/**
 * add(payload)
 * Adds a failed note to the retry queue.
 * Starts the 30-minute retry timer immediately.
 *
 * @param {object} payload - Same payload sent to atsService.writeNote()
 *   {
 *     jobId, candidateId, noteActionType, composedNote
 *   }
 * @returns {object} queueEntry - The created queue entry
 */
function add(payload) {
  const entry = {
    id:         `nq_${Date.now()}`,
    payload,
    queuedAt:   new Date(),
    retryAt:    new Date(Date.now() + RETRY_DELAY_MS),
    retryCount: 0,
    status:     'queued',   // queued | retrying | sent | failed
    timerId:    null,
  };

  // Log the queued note
  console.log(`[NOTE QUEUE] Note queued for retry in 30 min.`);
  console.log(`  Queue ID:     ${entry.id}`);
  console.log(`  Job ID:       ${payload.jobId}`);
  console.log(`  Candidate ID: ${payload.candidateId}`);
  console.log(`  Retry at:     ${entry.retryAt.toLocaleTimeString()}`);

  // Start 30-minute countdown
  // [PRODUCTION NOTE] Replace with BullMQ delayed job or
  // node-cron schedule for reliability across server restarts
  entry.timerId = setTimeout(() => retryNote(entry), RETRY_DELAY_MS);

  queue.push(entry);

  return entry;
}

/**
 * retryNote(entry)
 * Called automatically after RETRY_DELAY_MS.
 * Attempts to resend the note to the ATS.
 *
 * @param {object} entry - Queue entry object
 */
async function retryNote(entry) {
  entry.status     = 'retrying';
  entry.retryCount += 1;

  console.log(`[NOTE QUEUE] Retrying note ${entry.id}...`);

  try {
    // [API-CONNECT] Re-attempt the ATS note write
    const result = await atsService.writeNote(entry.payload);

    if (result.success) {
      // ── SUCCESS ──────────────────────────────────────
      entry.status = 'sent';
      entry.sentAt = new Date();

      console.log(`[NOTE QUEUE] ✅ Note ${entry.id} successfully sent on retry.`);

      // Remove from active queue
      const idx = queue.indexOf(entry);
      if (idx > -1) queue.splice(idx, 1);

      // In production: push a real-time notification to the
      // specific user's browser session (WebSocket or SSE).
      // For demo: logged to console.
      console.log(`[NOTE QUEUE] 🔔 Notification: Note retry succeeded for job ${entry.payload.jobId}`);

    } else {
      // ── STILL FAILING ────────────────────────────────
      entry.status = 'failed';
      entry.failedAt = new Date();

      console.error(`[NOTE QUEUE] ❌ Note ${entry.id} still failed after retry.`);
      console.error(`  Job:       ${entry.payload.jobId}`);
      console.error(`  Candidate: ${entry.payload.candidateId}`);

      // In production: push failure notification to user via WebSocket.
      // For demo: the frontend handles its own client-side notification
      // (see note-writeback.js → queueNoteForRetry()).
    }

  } catch (err) {
    entry.status = 'failed';
    entry.error  = err.message;
    console.error(`[NOTE QUEUE] ❌ Retry error for ${entry.id}:`, err.message);
  }
}

/**
 * getQueue()
 * Returns the current queue (for debugging or admin view).
 * In production: query this from the database.
 */
function getQueue() {
  return queue.map(e => ({
    id:         e.id,
    jobId:      e.payload.jobId,
    candidateId:e.payload.candidateId,
    queuedAt:   e.queuedAt,
    retryAt:    e.retryAt,
    status:     e.status,
    retryCount: e.retryCount,
  }));
}

/**
 * getStats()
 * Returns summary stats about the queue.
 */
function getStats() {
  return {
    total:    queue.length,
    queued:   queue.filter(e => e.status === 'queued').length,
    retrying: queue.filter(e => e.status === 'retrying').length,
    sent:     queue.filter(e => e.status === 'sent').length,
    failed:   queue.filter(e => e.status === 'failed').length,
  };
}

module.exports = { add, getQueue, getStats };