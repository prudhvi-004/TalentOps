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
        cache: 'no-store',
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
     CURSOR PAGINATION
     Every list endpoint accepts ?limit=N&cursor=... and answers
     { data, pageInfo: { limit, hasMore, nextCursor, total }, facets? }.
     Calling an endpoint WITHOUT params still returns the full list.
  ----------------------------------------------------------- */
  const PAGE_SIZE = 25;

  function withParams(url, params) {
    if (!params) return url;
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    });
    const text = qs.toString();
    return text ? `${url}${url.includes('?') ? '&' : '?'}${text}` : url;
  }

  /**
   * createPager(fetchPage, baseParams)
   * Walks one endpoint page by page. reset(params) starts over (stale
   * responses from an earlier filter are discarded); next() fetches the
   * following page using the server's cursor.
   *   fetchPage(params) => Promise<{ success, data, pageInfo, facets }>
   * Both resolve to { success, rows, pageInfo, facets, error } or null when
   * superseded / nothing more to load.
   */
  function createPager(fetchPage, baseParams = {}) {
    let params = { limit: PAGE_SIZE, ...baseParams };
    let cursor = null;
    let more = true;
    let busy = false;
    let gen = 0;

    async function run(extra) {
      const myGen = gen;
      busy = true;
      const res = await fetchPage({ ...params, ...(cursor ? { cursor } : {}), ...extra });
      if (myGen !== gen) return null; // a newer reset() superseded this request
      busy = false;
      if (!res.success) return { success: false, error: res.error };
      cursor = res.pageInfo ? res.pageInfo.nextCursor : null;
      more = !!(res.pageInfo && res.pageInfo.hasMore);
      return { success: true, rows: res.data, pageInfo: res.pageInfo, facets: res.facets, meta: res.meta };
    }

    return {
      reset(nextParams) {
        gen++;
        cursor = null;
        more = true;
        busy = false;
        params = { limit: PAGE_SIZE, ...baseParams, ...nextParams };
        return run();
      },
      next() { return more && !busy ? run() : Promise.resolve(null); },
      get hasMore() { return more; },
    };
  }

  /** Follows every cursor and returns all rows (for views that need the full set). */
  async function fetchAllPages(fetchPage, params = {}, limit = 200) {
    const pager = createPager(fetchPage, { ...params, limit });
    let page = await pager.reset();
    if (!page || !page.success) return page;
    const rows = [...page.rows];
    let facets = page.facets;
    while (pager.hasMore) {
      page = await pager.next();
      if (!page || !page.success) break;
      rows.push(...page.rows);
      facets = page.facets || facets;
    }
    return { success: true, rows, facets };
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
  async function getJobs(params) {
    return request(withParams('/api/jobs', params));
  }

  /**
   * getSubmittals()
   * Fetches all submittals across every job assigned to the logged-in
   * recruiter (scoped server-side by their JobDiva USERID).
   * Server route: GET /api/submittals
   */
  async function getSubmittals(params) {
    return request(withParams('/api/submittals', params));
  }

  /** getInterviews() — GET /api/interviews */
  async function getInterviews(params) {
    return request(withParams('/api/interviews', params));
  }

  /** getStarts() — GET /api/starts */
  async function getStarts(params) {
    return request(withParams('/api/starts', params));
  }

  /** getFirstPresentations() — GET /api/first-presentations */
  async function getFirstPresentations(params) {
    return request(withParams('/api/first-presentations', params));
  }

  /** getMyPrimaryJobRecords() — GET /api/my-primary-jobs */
  async function getMyPrimaryJobRecords(params) {
    return request(withParams('/api/my-primary-jobs', params));
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
  async function getJobActivity(id, params) {
    return request(withParams(`/api/jobs/${id}/activity`, params));
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
  async function getCandidatesForJob(jobId, params) {
    return request(withParams(`/api/jobs/${jobId}/candidates`, params));
  }

  /**
   * getAIEngagedForJob(jobId)
   * Fetches AI Engaged applicants + candidates for a job.
   * Server route: GET /api/jobs/:id/ai-engaged
   * Returns: { success, data: { applicants: [...], candidates: [...] } }
   */
  async function getTasks(status, params) {
    return request(withParams('/api/tasks', { ...(status ? { status } : {}), ...params }));
  }

  /** getCandidates(params) — GET /api/candidates (submitted candidates, paged). */
  async function getCandidates(params) {
    return request(withParams('/api/candidates', params));
  }

  async function getAIEngagedForJob(jobId, params) {
    return request(withParams(`/api/jobs/${jobId}/ai-engaged`, params));
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
    PAGE_SIZE,
    createPager,
    fetchAllPages,
    getCandidates,
    getJobs,
    getSubmittals,
    getInterviews,
    getStarts,
    getFirstPresentations,
    getMyPrimaryJobRecords,
    search,
    getJobById,
    getJobActivity,
    getCandidatesForJob,
    getAIEngagedForJob,
    getTasks,
    getCandidateById,
    writeNote,
  };

})();