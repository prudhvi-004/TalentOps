/* =============================================================
   API SERVICE — api.service.js
   =============================================================
   Purpose:
     All fetch() calls from the frontend go through this file.
     No page script ever calls fetch() directly.
     This keeps API logic in one place — easy to update.

   How it works:
     Every function calls our own Express server (/api/...).
     The server then calls the ATS (or returns mock data).
     The frontend never knows which ATS is being used.

   Error handling:
     All functions return { success, data, error } objects.
     Page scripts check success before using data.

   To change an endpoint:
     Find the function below and update the URL string.
     The server route is in: server/routes/api.routes.js
   ============================================================= */

const ApiService = (() => {

  /* -----------------------------------------------------------
     BASE FETCH HELPER
     Wraps fetch() with error handling and JSON parsing.
     All functions below use this.
  ----------------------------------------------------------- */
  async function request(url, options = {}) {
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      // If server returned an error status code
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errData.error || `Server error: ${response.status}`,
          queued: errData.queued || false,
        };
      }

      const data = await response.json();
      return data;

    } catch (err) {
      // Network error — server may be down
      console.error('Network error:', err.message);
      return { success: false, error: 'Network error — is the server running?' };
    }
  }

  /* -----------------------------------------------------------
     JOBS API
  ----------------------------------------------------------- */

  /**
   * getJobs()
   * Fetches all open jobs.
   * Server route: GET /api/jobs
   * Returns: { success, data: [...jobs] }
   */
  async function getJobs() {
    return request('/api/jobs');
  }

  /**
   * search(query)
   * Global search across jobs and candidates.
   * Server route: GET /api/search?q=...
   */
  async function search(query) {
    return request(`/api/search?q=${encodeURIComponent(query)}`);
  }

  /**
   * getJobById(id)
   * Fetches a single job's full details.
   * Server route: GET /api/jobs/:id
   * Returns: { success, data: jobObject }
   */
  async function getJobById(id) {
    return request(`/api/jobs/${id}`);
  }

  /**
   * getJobActivity(id)
   * Fetches the job audit timeline from posting date through today.
   * Server route: GET /api/jobs/:id/activity
   */
  async function getJobActivity(id) {
    return request(`/api/jobs/${id}/activity`);
  }

  /* -----------------------------------------------------------
     CANDIDATES API
  ----------------------------------------------------------- */

  /**
   * getCandidatesForJob(jobId)
   * Fetches pipeline candidates for a specific job.
   * Server route: GET /api/jobs/:id/candidates
   * Returns: { success, data: [...candidates] }
   */
  async function getCandidatesForJob(jobId) {
    return request(`/api/jobs/${jobId}/candidates`);
  }

  /**
   * getAIEngagedForJob(jobId)
   * Fetches AI Engaged applicants + candidates for a job.
   * Server route: GET /api/jobs/:id/ai-engaged
   * Returns: { success, data: { applicants: [...], candidates: [...] } }
   */
  async function getAIEngagedForJob(jobId) {
    return request(`/api/jobs/${jobId}/ai-engaged`);
  }

  /**
   * getCandidateById(id)
   * Fetches full profile of one candidate.
   * Works for both pipeline candidates and AI engaged.
   * Server route: GET /api/candidates/:id
   * Returns: { success, data: candidateObject }
   */
  async function getCandidateById(id) {
    return request(`/api/candidates/${id}`);
  }

  /* -----------------------------------------------------------
     NOTES API
  ----------------------------------------------------------- */

  /**
   * writeNote(payload)
   * Submits a note writeback to the ATS.
   * Server route: POST /api/notes
   *
   * @param {object} payload
   * @param {string} payload.jobId            - ATS Job ID
   * @param {string} payload.candidateId      - ATS Candidate ID
   * @param {string} payload.candidateName    - Display name (UI only)
   * @param {string} payload.noteActionType   - e.g. "Rec – Sense AI"
   * @param {string} payload.candidateAlignment - alignment option
   * @param {string} payload.noteText         - required, free text
   *
   * Returns: { success: true } or { success: false, queued: bool }
   */
  async function writeNote(payload) {
    return request('/api/notes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /* -----------------------------------------------------------
     EXPORT — make functions available globally
  ----------------------------------------------------------- */
  return {
    getJobs,
    search,
    getJobById,
    getJobActivity,
    getCandidatesForJob,
    getAIEngagedForJob,
    getCandidateById,
    writeNote,
  };

})();