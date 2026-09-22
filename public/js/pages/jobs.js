/* =============================================================
   JOBS LIST PAGE — jobs.js
   =============================================================
   Purpose:
     Renders the jobs list with filters.
     Fetches jobs from ApiService (real ATS or mock data).
     Each job card is clickable → goes to job detail page.

   API connection:
     ApiService.getJobs() → server → ATS or mock data
   ============================================================= */

const JobsPage = (() => {

  /* -----------------------------------------------------------
     render(container)
     Main entry — called by app.js router.
  ----------------------------------------------------------- */
  async function render(container) {
    // Show page shell immediately, load data async
    container.innerHTML = `
      <div class="page-header fade-in">
        <div>
          <div class="page-title">💼 Jobs</div>
          <div class="page-subtitle" id="jobsSubtitle">Loading...</div>
        </div>
      </div>

      <!-- Filters -->
      <div class="filters">
        <select id="fltStatus">
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="onhold">On Hold</option>
          <option value="filled">Filled</option>
          <option value="closed">Closed</option>
        </select>
        <select id="fltPriority">
          <option value="">All Priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input id="fltSearch" placeholder="Search jobs..." style="min-width:200px"/>
      </div>

      <!-- Jobs grid -->
      <div id="jobsGrid" class="tile-grid">
        <div class="loading-screen" style="height:200px">
          <div class="loading-spinner"></div>
          <p>Loading jobs...</p>
        </div>
      </div>`;

    // Fetch jobs from API
    const result = await ApiService.getJobs();

    if (!result.success) {
      document.getElementById('jobsGrid').innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <h3>Could not load jobs</h3>
          <p>${result.error}</p>
        </div>`;
      return;
    }

    const allJobs = result.data;
    const initialSearch = new URLSearchParams(window.location.search).get('search') || '';
    const searchInput = document.getElementById('fltSearch');
    if (searchInput) searchInput.value = initialSearch;

    document.getElementById('jobsSubtitle').textContent =
      `${allJobs.length} jobs · Synced from ATS`;

    // Initial render
    // Filter handlers
    const applyFilters = () => {
      const status = document.getElementById('fltStatus').value;
      const priority = document.getElementById('fltPriority').value;
      const search = document.getElementById('fltSearch').value.trim().toLowerCase();

      const filtered = allJobs.filter(j => {
        const haystack = [
          j.id, j.atsId, j.title, j.client, j.location, j.primaryRecruiter,
          j.hiringManager, j.status, j.priority, j.jobType,
          ...(j.requirements || []),
        ].map(v => String(v || '').toLowerCase());
        return (!status || j.status === status) &&
               (!priority || j.priority === priority) &&
               (!search || haystack.some(v => v.includes(search)));
      });
      renderGrid(filtered, allJobs);
    };

    ['fltStatus', 'fltPriority'].forEach(id => {
      document.getElementById(id).onchange = applyFilters;
    });
    document.getElementById('fltSearch').oninput = applyFilters;

    // Apply a search value supplied by the global search bar.
    applyFilters();
  }

  /* -----------------------------------------------------------
     Renders job tiles into the grid
  ----------------------------------------------------------- */
  function renderGrid(jobs) {
    const grid = document.getElementById('jobsGrid');
    if (!grid) return;

    if (jobs.length === 0) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <h3>No jobs match your filters</h3>
        </div>`;
      return;
    }

    grid.innerHTML = jobs.map(job => jobTile(job)).join('');

    // Click handler → navigate to job detail
    grid.querySelectorAll('[data-job]').forEach(el => {
      el.onclick = () => window.navigate(`/jobs/${el.dataset.job}`);
    });
  }

  /* -----------------------------------------------------------
     Renders a single job tile card
  ----------------------------------------------------------- */
  function jobTile(job) {
    const reqs = (job.requirements || []).slice(0, 3);
    const extra = (job.requirements || []).length - 3;
    return `
      <div class="tile fade-in" data-job="${job.id}">
        <div class="tile-header">
          <div>
            <div class="tile-title">${job.title}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px">
              ${job.atsId || ''}
            </div>
          </div>
          <span class="chip chip-${job.status}">${job.status}</span>
        </div>

        <div class="tile-client">🏢 ${job.client} · 📍 ${job.location}</div>

        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          <span class="chip chip-${job.priority}">${job.priority}</span>
          <span style="font-size:12px;color:var(--text-muted)">${job.salary || ''}</span>
        </div>

        <div style="margin-top:8px">
          ${reqs.map(r => `<span class="tile-tag">${r}</span>`).join('')}
          ${extra > 0 ? `<span class="tile-tag">+${extra}</span>` : ''}
        </div>

        <div class="tile-meta">
          <span>👤 ${job.primaryRecruiter || 'Unassigned'}</span>
          <span>📅 ${job.createdAt || ''}</span>
        </div>
      </div>`;
  }

  return { render };

})();