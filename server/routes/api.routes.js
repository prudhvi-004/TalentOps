// =============================================================
// API ROUTES — api.routes.js
// =============================================================
// Purpose:
//   All data endpoints the frontend calls via fetch().
//   The frontend never calls the ATS directly.
//   It calls these routes, which then call the ATS service.
//
// Why this pattern:
//   → ATS credentials stay on the server, never in browser
//   → We can swap ATS providers without touching frontend code
//   → Mock fallback happens here transparently
//
// Routes defined:
//   GET  /api/jobs
//   GET  /api/jobs/:id
//   GET  /api/jobs/:id/candidates
//   GET  /api/jobs/:id/ai-engaged
//   GET  /api/candidates/:id
//   POST /api/notes
//
// ⚠️  API CONNECTION POINTS are marked with:
//     // [API-CONNECT] — replace mock call with real ATS call
// =============================================================

const express = require('express');
const router = express.Router();

const { requireLogin } =
  require('../middleware/auth');

const atsService =
  require('../services/ats.service');


// Apply login protection to all /api routes
router.use(requireLogin);


// ----------------------------------------------------------
// GET /api/search?q=...
// Global search used by the top-bar search box.
// ----------------------------------------------------------
router.get('/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) {
      return res.json({ success: true, data: { jobs: [], candidates: [] } });
    }

    const results = await atsService.searchAll(query);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error running global search:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ----------------------------------------------------------
// GET /api/jobs
// Returns list of all open jobs.
// Frontend: public/js/pages/jobs.js
// ----------------------------------------------------------
router.get('/jobs', async (req, res) => {

  try {

    // [API-CONNECT]
    // atsService.getJobs() either calls the
    // real ATS API or returns mock data depending
    // on ATS_PROVIDER
    const jobs =
      await atsService.getJobs();

    res.json({
      success: true,
      data: jobs
    });

  } catch (error) {

    console.error(
      'Error fetching jobs:',
      error.message
    );

    res.status(500).json({
      success: false,
      error: 'Failed to fetch jobs',
      detail: error.message,
    });
  }
});


// ----------------------------------------------------------
// GET /api/jobs/:id
// Returns a single job by its ATS ID.
// Frontend: public/js/pages/job-detail.js
// ----------------------------------------------------------
router.get('/jobs/:id', async (req, res) => {

  try {

    const { id } =
      req.params;


    // [API-CONNECT]
    // Calls ATS for single job details
    const job =
      await atsService.getJobById(id);


    if (!job) {

      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }


    res.json({
      success: true,
      data: job
    });

  } catch (error) {

    console.error(
      'Error fetching job:',
      error.message
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// ----------------------------------------------------------
// GET /api/jobs/:id/activity
// Returns the audit timeline for this job starting at its posting date.
// ----------------------------------------------------------
router.get('/jobs/:id/activity', async (req, res) => {
  try {
    const activity = await atsService.getJobActivity(req.params.id);

    if (!activity) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error('Error fetching job activity:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ----------------------------------------------------------
// GET /api/jobs/:id/candidates
// Returns candidates submitted/assigned to a specific job.
//
// JobDiva uses JobsSubmittalsDetail for the
// job → candidate relationship.
//
// Frontend:
//   public/js/components/candidates-pipeline.js
// ----------------------------------------------------------
router.get(
  '/jobs/:id/candidates',
  async (req, res) => {

    try {

      const { id } =
        req.params;


      // [API-CONNECT]
      // Calls ATS for candidates on this job
      const candidates =
        await atsService.getCandidatesForJob(id);


      res.json({
        success: true,
        data: candidates
      });

    } catch (error) {

      console.error(
        'Error fetching candidates:',
        error.message
      );

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ----------------------------------------------------------
// GET /api/jobs/:id/ai-engaged
// Returns AI Engaged candidates for a specific job.
//
// How this works:
//   The ATS has a dedicated candidate record (or group) for
//   AI Engaged contacts. Each AI Engaged candidate has a UDF
//   field (e.g. customText1) storing the JobID they match to,
//   and another UDF (e.g. customText2) storing their category
//   (Applicant or Candidate).
//
// This route:
//   1. Fetches AI Engaged candidates from ATS
//   2. Filters by JobID matching the requested :id
//   3. Groups by category
//   4. Returns the grouped result
//
// [API-CONNECT]
//   See atsService.getAIEngagedForJob()
//
// Frontend:
//   public/js/components/ai-engaged.js
// ----------------------------------------------------------
router.get(
  '/jobs/:id/ai-engaged',
  async (req, res) => {

    try {

      const { id } =
        req.params;


      // [API-CONNECT]
      // Fetches and filters AI Engaged candidates
      const aiEngaged =
        await atsService.getAIEngagedForJob(id);


      // aiEngaged returns:
      // { applicants: [...], candidates: [...] }
      res.json({
        success: true,
        data: aiEngaged
      });

    } catch (error) {

      console.error(
        'Error fetching AI engaged:',
        error.message
      );

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ----------------------------------------------------------
// GET /api/candidates/:id
// Returns full profile of a single candidate by ATS ID.
//
// Used by both Pipeline and AI Engaged profile views.
//
// Frontend:
//   public/js/pages/candidate-profile.js
// ----------------------------------------------------------
router.get(
  '/candidates/:id',
  async (req, res) => {

    try {

      const { id } =
        req.params;


      // [API-CONNECT]
      // Fetches full candidate record from ATS
      const candidate =
        await atsService.getCandidateById(id);


      if (!candidate) {

        return res.status(404).json({
          success: false,
          error: 'Candidate not found'
        });
      }


      res.json({
        success: true,
        data: candidate
      });

    } catch (error) {

      console.error(
        'Error fetching candidate:',
        error.message
      );

      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);


// ----------------------------------------------------------
// POST /api/notes
// Writes a note back to the ATS.
//
// Expected request body:
//
// {
//   jobId: "12345",
//   candidateId: "67890",
//   candidateName: "Emma Wilson",
//   noteActionType: "Rec – Sense AI",
//   candidateAlignment: "Candidate Aligns with the Role",
//   noteText: "Strong Python skills..."
// }
//
// IMPORTANT:
//
// Candidate Alignment is ONLY required when:
//   noteActionType === "Rec – Sense AI"
//
// For all other action types:
//
//   candidateAlignment may be empty.
//
// Note format sent to ATS:
//
//   Rec – Sense AI:
//     "Candidate Aligns with the Role – Strong Python skills..."
//
//   Other actions:
//     "Strong Python skills..."
//
// Returns:
//   { success: true }  if ATS confirms receipt
//   { success: false } if ATS fails or times out
//
// Optional queue logic:
//   If ATS returns failure, note is saved to failed-notes queue.
//   A retry timer (30 min) attempts to resend.
//
// [API-CONNECT]
//   See atsService.writeNote()
//
// Frontend:
//   public/js/components/note-writeback.js
// ----------------------------------------------------------
router.post('/notes', async (req, res) => {
  const {
    jobId,
    candidateId,
    candidateName,
    noteActionType,
    candidateAlignment,
    noteText,
  } = req.body;

  /*
   * Candidate Alignment is an action-specific field.
   *
   * Rec – Sense AI:
   *   candidateAlignment is required.
   *
   * All other note actions:
   *   candidateAlignment is NOT required.
   */
  const requiresAlignment =
    noteActionType === 'Rec – Sense AI';

  // ----------------------------------------------------------
  // Validate fields
  //
  // Required for ALL actions:
  //   jobId
  //   candidateId
  //   noteActionType
  //   noteText
  //
  // Required ONLY for Rec – Sense AI:
  //   candidateAlignment
  // ----------------------------------------------------------
  const missingFields = [];

  if (!jobId) {
    missingFields.push('jobId');
  }

  if (!candidateId) {
    missingFields.push('candidateId');
  }

  if (!noteActionType) {
    missingFields.push('noteActionType');
  }

  if (!noteText || !String(noteText).trim()) {
    missingFields.push('noteText');
  }

  if (
    requiresAlignment &&
    (!candidateAlignment || !String(candidateAlignment).trim())
  ) {
    missingFields.push('candidateAlignment');
  }

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Missing required fields: ${missingFields.join(', ')}.`,
    });
  }

  /*
   * ----------------------------------------------------------
   * Compose the note that will actually be sent to JobDiva.
   *
   * Rec – Sense AI:
   *
   *   Candidate Aligns with the Role – Strong Python background
   *
   * Other actions:
   *
   *   Strong Python background
   *
   * The UI action type is also written as JobDiva's `action`
   * field. The ATS service ensures that the action is registered
   * before creating the note.
   * ----------------------------------------------------------
   */
  const cleanNoteText =
    String(noteText).trim();

  const cleanAlignment =
    candidateAlignment
      ? String(candidateAlignment).trim()
      : '';

  const composedNote =
    requiresAlignment
      ? `${cleanAlignment} – ${cleanNoteText}`
      : cleanNoteText;

  try {
    // --------------------------------------------------------
    // Send the correctly composed note to the ATS.
    // --------------------------------------------------------
    const result =
      await atsService.writeNote({
        jobId,
        candidateId,
        noteActionType,
        composedNote,
      });

    if (result.success) {
      return res.json({
        success: true,
        message: 'Note pushed to ATS successfully.',
      });
    }

    // --------------------------------------------------------
    // ATS did not confirm.
    // Queue for retry.
    // --------------------------------------------------------
    try {
      const NoteQueueService =
        require('../services/note-queue.service');

      NoteQueueService.add({
        jobId,
        candidateId,
        noteActionType,
        composedNote,
      });

      console.log(
        `[API] Note queued for retry — ` +
        `Job: ${jobId}, Candidate: ${candidateId}`
      );

    } catch (queueErr) {
      console.error(
        '[API] Note queue error:',
        queueErr.message
      );
    }

    return res.status(502).json({
      success: false,
      error:
        'ATS did not confirm note receipt. Queued for retry in 30 minutes.',
      queued: true,
    });

  } catch (error) {

    console.error(
      'Note writeback error:',
      error.message
    );

    return res.status(500).json({
      success: false,
      error: error.message,
      queued: false,
    });
  }
});


module.exports = router;