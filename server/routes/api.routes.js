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

const aiNotesService =
  require('../services/ai-notes.service');

const { respond, toTime } = require('../utils/pagination');

// Shared cursor-pagination configs. Every list endpoint is opt-in: without
// ?limit it still returns the full array (legacy callers); with ?limit=N
// (+ optional ?cursor=) it returns one keyset page - see utils/pagination.js.
const byDateDesc = field => ({ sortValue: r => toTime(r[field]), idOf: r => r.id, order: 'desc', dateOf: r => r[field] });
const RECORD_SEARCH = ['candidateName', 'jobTitle', 'client'];


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

    // ?days=30 -> posted in the last N days (the Jobs page / dashboard window).
    // ?status= and ?priority= narrow server-side; newest posting first.
    const postedAt = j => j.postingDateRaw || j.createdAtRaw;
    respond(req, res, jobs, {
      sortValue: j => toTime(postedAt(j)),
      idOf: j => j.id,
      order: 'desc',
      dateOf: postedAt,
      // Job search matches the job title or job id (JobDiva ref like 26-06542, or internal id).
      searchFields: ['id', 'atsId', 'title'],
      filters: {
        days: (j, v) => toTime(postedAt(j)) >= Date.now() - Number(v) * 86400000,
        status: (j, v) => j.status === v,
        priority: (j, v) => j.priorityLevel === v,
      },
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

    // Legacy: { jobId, postingDate, events }. Paged (?limit=): `events` is one
    // cursor page (oldest first) and pageInfo rides alongside `data`.
    if (req.query.limit === undefined && req.query.cursor === undefined) {
      return res.json({ success: true, data: activity });
    }
    const out = {};
    const sink = { json: body => Object.assign(out, body), status(code) { out.status = code; return this; } };
    respond(req, sink, activity.events || [], {
      sortValue: e => toTime(e.timestamp),
      idOf: e => `${e.type}:${e.timestamp}:${e.to || ''}:${e.label || ''}`,
      order: 'asc',
    });
    if (out.success === false) return res.status(out.status || 400).json({ success: false, error: out.error });
    res.json({ success: true, data: { ...activity, events: out.data }, pageInfo: out.pageInfo });
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


      respond(req, res, candidates, {
        sortValue: c => String(c.name || '').toLowerCase(),
        idOf: c => c.id,
        order: 'asc',
        searchFields: ['id', 'name', 'email', 'city', 'state', 'location', 'skills'],
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
// GET /api/tasks?status=pending|completed
// Automated tasks created by the 120-minute AI note audit.
// Recruiters see their own tasks; admins see all.
// ----------------------------------------------------------
router.get('/tasks', async (req, res) => {
  // Recruiters see tasks for jobs they are tagged on (any job status); admins see all.
  // Answers from cache; the scan of the last 30 days runs in the background.
  const isAdmin = req.user?.role === 'ADMIN';
  if (process.env.ATS_PROVIDER === 'jobdiva') aiNotesService.refreshInBackground();
  const who = { all: isAdmin, assigneeId: req.user?.jobdivaUserId, assigneeName: req.user?.name };
  // First visit by this recruiter: scan the last 30 days for their tagged jobs and wait for it
  // (up to 40s) so the first view isn't empty.
  if (!isAdmin && (aiNotesService.registerUser(who.assigneeId, who.assigneeName) || !aiNotesService.jobsFor(who).length)
      && process.env.ATS_PROVIDER === 'jobdiva') {
    await Promise.race([aiNotesService.scanRecentJobs().catch(() => {}), new Promise(r => setTimeout(r, 40000))]);
  }
  // Live: re-read this recruiter's jobs' notes now (jobs read <15s ago are skipped).
  try { await aiNotesService.syncKnownJobs(aiNotesService.jobsFor(who)); }
  catch (e) { console.warn('[tasks] live sync failed:', e.message); }
  const data = aiNotesService.listTasks({ ...who, sinceDays: aiNotesService.WINDOW_DAYS });
  const syncing = aiNotesService.isScanning();
  // Legacy (no ?limit): optional ?status= filter, full array.
  if (req.query.limit === undefined && req.query.cursor === undefined) {
    const rows = req.query.status ? data.filter(t => t.status === req.query.status) : data;
    return res.json({ success: true, syncing, data: rows });
  }
  // Paged: newest AI note first; ?status=pending|completed with facets.status
  // carrying both tab counts.
  const json = res.json.bind(res);
  res.json = body => json({ ...body, syncing });
  respond(req, res, data, {
    sortValue: t => toTime(t.aiNoteAt),
    idOf: t => `${t.jobId}:${t.candidateId}`,
    order: 'desc',
    searchFields: ['candidateName', 'jobRef', 'jobTitle', 'aiNote'],
    facets: { status: t => t.status },
  });
});

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
      // JobDiva: derived from JobNotesListDetail AI notes
      // (see ai-notes.service.js). Mock: data/ai-engaged.json.
      let aiEngaged;
      if (process.env.ATS_PROVIDER === 'jobdiva') {
        // Task owner = the job's primary recruiter (not the viewer).
        aiEngaged = await aiNotesService.getAIEngagedForJob(
          id, () => atsService.getJobAssignment(id));
      } else {
        aiEngaged = await atsService.getAIEngagedForJob(id);
      }


      // Legacy shape: { applicants: [...], candidates: [...] }.
      // Paged (?limit=): one flat cursor page; ?category=applicant|candidate
      // picks the tab and `facets.category` carries both tab counts.
      if (req.query.limit === undefined && req.query.cursor === undefined) {
        return res.json({ success: true, data: aiEngaged });
      }
      const rows = [
        ...(aiEngaged.applicants || []).map(c => ({ ...c, _group: 'applicant' })),
        ...(aiEngaged.candidates || []).map(c => ({ ...c, _group: 'candidate' })),
      ];
      respond(req, res, rows, {
        sortValue: c => String(c.name || '').toLowerCase(),
        idOf: c => `${c._group}:${c.id}`,
        order: 'asc',
        searchFields: ['name', 'email', 'aiStageLabel', 'aiStage'],
        facets: { category: c => c._group },
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
// GET /api/submittals
// Returns every submittal across all jobs assigned to the logged-in
// recruiter — powers the dashboard's "Submittals" detail view.
// Frontend: public/js/pages/submittals.js
// ----------------------------------------------------------
router.get('/submittals', async (req, res) => {
  try {
    const submittals = await atsService.getRecruiterSubmittals();
    respond(req, res, submittals, {
      ...byDateDesc('dateRaw'),
      searchFields: ['candidateName', 'jobTitle', 'client', 'stage', 'type'],
      // ?type=internal|external; facets.type carries the per-type counts.
      facets: { type: s => String(s.type || '').toLowerCase() },
    });
  } catch (error) {
    console.error('Error fetching submittals:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ----------------------------------------------------------
// GET /api/interviews, /api/starts, /api/first-presentations,
// /api/my-primary-jobs
// Dashboard tile detail views. Each is derived from getSubmittals()
// server-side (no extra JobDiva calls), so these stay fast even for
// recruiters with hundreds of submittals.
// ----------------------------------------------------------
router.get('/interviews', async (req, res) => {
  try {
    respond(req, res, await atsService.getInterviews(), { ...byDateDesc('dateRaw'), searchFields: RECORD_SEARCH });
  } catch (error) {
    console.error('Error fetching interviews:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/starts', async (req, res) => {
  try {
    respond(req, res, await atsService.getStarts(), {
      ...byDateDesc('dateRaw'),
      searchFields: ['candidateName', 'jobTitle', 'client', 'location', 'status'],
      // ?view= mirrors the Starts page's segment buttons.
      filters: {
        view: (r, v) => ({
          active: r.status === 'Active',
          bench: r.status === 'Ended',
          ending30: !!r.endingSoon,
          unapproved: !r.approved,
        }[v] ?? true),
      },
    });
  } catch (error) {
    console.error('Error fetching starts:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/first-presentations', async (req, res) => {
  try {
    respond(req, res, await atsService.getFirstPresentations(), { ...byDateDesc('dateRaw'), searchFields: RECORD_SEARCH });
  } catch (error) {
    console.error('Error fetching first presentations:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/my-primary-jobs', async (req, res) => {
  try {
    respond(req, res, await atsService.getMyPrimaryJobRecords(), {
      ...byDateDesc('dateRaw'),
      searchFields: RECORD_SEARCH,
      distinctOf: r => r.jobId, // ?distinct=1 -> pageInfo.distinctTotal (dashboard tile)
    });
  } catch (error) {
    console.error('Error fetching primary job records:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ----------------------------------------------------------
// GET /api/candidates
// Candidates page: one row per submitted candidate+job for this
// recruiter. ?jobId= narrows to one job.
// Frontend: public/js/pages/candidate.js
// ----------------------------------------------------------
router.get('/candidates', async (req, res) => {
  try {
    const rows = await atsService.getSubmittedCandidates();
    respond(req, res, rows, {
      ...byDateDesc('dateRaw'),
      idOf: r => `${r.id}|${r.jobId}`,
      searchFields: [
        'id', 'name', 'email', 'currentTitle', 'currentCompany', 'candidateLocation',
        'jobId', 'jobTitle', 'client',
      ],
      filters: { jobId: (r, v) => String(r.jobId) === String(v) },
      // Options for the page's job dropdown, sent with the first page only.
      meta: all => ({
        jobs: [...new Map(all.map(r => [String(r.jobId), { id: r.jobId, title: r.jobTitle }])).values()],
      }),
    });
  } catch (error) {
    console.error('Error fetching candidates:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


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