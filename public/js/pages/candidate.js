/* =============================================================
   CANDIDATES PAGE — candidates.js
   =============================================================
   Purpose:
     Renders the Candidates navigation page.
     Shows all candidates across all jobs as a tile grid.
     Clicking a candidate → navigates to their associated
     job detail page with that candidate open in split view.

   This gives recruiters a candidate-first entry point
   rather than having to find the job first.

   API connection:
     All candidates come from the combined pool of:
       → data/candidates.json (pipeline)
       → data/ai-engaged.json (AI engaged)
     Both fetched via existing job-level API calls
     or directly via getCandidateById for full profiles.

   [API-CONNECT]
     In production: add a dedicated endpoint:
       GET /api/candidates  → all candidates across all jobs
     For now: fetches all jobs then all candidates per job.
   ============================================================= */

const CandidatesPage = (() => {

  async function render(container) {
    container.innerHTML = `
      <div class="page-header fade-in">
        <div>
          <div class="page-title">👥 Candidates</div>
          <div class="page-subtitle" id="candPageSub">Loading...</div>
        </div>
      </div>
      <div class="filters">
        <input id="candSearch" placeholder="Search by name, skill, location..."
               style="min-width:260px"/>
        <select id="candJobFilter">
          <option value="">All Jobs</option>
        </select>
      </div>
      <div id="candGrid" class="tile-grid">
        <div class="loading-screen" style="height:200px">
          <div class="loading-spinner"></div>
          <p>Loading candidates...</p>
        </div>
      </div>`;

    const initialSearch = new URLSearchParams(window.location.search).get('search') || '';
    const searchInput = document.getElementById('candSearch');
    if (searchInput) searchInput.value = initialSearch;

    // Fetch all jobs to get candidates from each
    const jobsResult = await ApiService.getJobs();
    if (!jobsResult.success) {
      document.getElementById('candGrid').innerHTML =
        '<div class="empty" style="grid-column:1/-1"><h3>Could not load data</h3></div>';
      return;
    }

    // Fetch all candidates across all jobs in parallel
    const allJobs = jobsResult.data;
    const candRequests = allJobs.map(j => ApiService.getCandidatesForJob(j.id));
    const aiRequests   = allJobs.map(j => ApiService.getAIEngagedForJob(j.id));

    const [candResults, aiResults] = await Promise.all([
      Promise.all(candRequests),
      Promise.all(aiRequests),
    ]);

    // Flatten all candidates into one array with job context
    let allCandidates = [];
    candResults.forEach((result, i) => {
      if (result.success) {
        result.data.forEach(c => {
          allCandidates.push({
            ...c,
            _job: allJobs[i],
            _source: 'pipeline',
          });
        });
      }
    });

    // Include AI engaged candidates
    aiResults.forEach((result, i) => {
      if (result.success) {
        [...(result.data.applicants || []),
         ...(result.data.candidates || [])].forEach(c => {
          allCandidates.push({
            ...c,
            _job: allJobs[i],
            _source: 'ai',
          });
        });
      }
    });

    // Update subtitle
    document.getElementById('candPageSub').textContent =
      `${allCandidates.length} candidates across ${allJobs.length} jobs`;

    // Populate job filter dropdown
    const jobFilter = document.getElementById('candJobFilter');
    allJobs.forEach(j => {
      const opt = document.createElement('option');
      opt.value = j.id;
      opt.textContent = j.title;
      jobFilter.appendChild(opt);
    });

    // Render tiles
    function applyFilters() {
      const search = document.getElementById('candSearch').value.trim().toLowerCase();
      const jobFilter = document.getElementById('candJobFilter').value;

      const filtered = allCandidates.filter(c => {
        const haystack = [
          c.id, c.name, c.email, c.title, c.company, c.location,
          c.city, c.state, c._job?.id, c._job?.atsId, c._job?.title, c._job?.client,
          ...(c.skills || []),
        ].map(v => String(v || '').toLowerCase());
        return (!search || haystack.some(v => v.includes(search))) &&
               (!jobFilter || String(c._job?.id) === String(jobFilter));
      });
      renderGrid(filtered);
    }

    document.getElementById('candSearch').oninput   = applyFilters;
    document.getElementById('candJobFilter').onchange = applyFilters;

    applyFilters();
  }

  function renderGrid(candidates) {
    const grid = document.getElementById('candGrid');
    if (!grid) return;

    if (candidates.length === 0) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <h3>No candidates match</h3>
        </div>`;
      return;
    }

    grid.innerHTML = candidates.map(c => candidateTile(c)).join('');

    // Click → navigate to job with this candidate in split view
    grid.querySelectorAll('[data-cand-tile]').forEach(el => {
      el.onclick = () => {
        const jobId  = el.dataset.jobId;
        const candId = el.dataset.candId;
        const source = el.dataset.source;
        const aiCat  = el.dataset.aiCategory || 'Applicant';

        // Store which candidate to open in split view
        // job-detail.js reads this on load
        sessionStorage.setItem('openCandId',     candId);
        sessionStorage.setItem('openCandSource', source);
        sessionStorage.setItem('openCandAICat',  aiCat);

        window.navigate(`/jobs/${jobId}`);
      };
    });
  }

  function candidateTile(c) {
    const isAI = c._source === 'ai';
    const skills = (c.skills || []).slice(0, 4);

    return `
      <div class="tile fade-in"
           data-cand-tile="${c.id}"
           data-cand-id="${c.id}"
           data-job-id="${c._job?.id || ''}"
           data-source="${c._source}"
           data-ai-category="${c.aiCategory || 'Applicant'}">

        <div class="tile-header">
          <div class="tile-title">
            ${isAI ? '🤖 ' : ''}${c.name}
          </div>
          ${isAI
            ? `<span class="ai-stage-badge" style="font-size:10px">AI</span>`
            : ''}
        </div>

        <div class="tile-client">
          ${c._job?.title || '—'} · ${c._job?.client || '—'}
        </div>

        <div style="margin-top:6px">
          <span style="font-size:12px;color:var(--text-muted)">
            📍 ${c.city || c.location || '—'}, ${c.state || ''}
            ${c.experience ? `· ${c.experience}y exp` : ''}
          </span>
        </div>

        <div style="margin-top:8px">
          ${skills.map(s => `<span class="tile-tag">${s}</span>`).join('')}
          ${(c.skills || []).length > 4
            ? `<span class="tile-tag">+${(c.skills || []).length - 4}</span>`
            : ''}
        </div>

        <div class="tile-meta">
          <span>📧 ${c.email || '—'}</span>
        </div>

      </div>`;
  }

  return { render };

})();