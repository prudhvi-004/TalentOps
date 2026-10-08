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

  // Beyond 12 jobs, the page switches from a grid of cards to a compact
  // list (row-per-job) once the user scrolls past where the 12th card
  // ends — and back to grid when scrolled back above that point.
  const GRID_TO_LIST_THRESHOLD = 12;
  const SCROLL_HYSTERESIS = 24; // px buffer so the switch doesn't flicker right at the boundary

  let viewMode = 'grid';
  let scrollThresholdPx = null;
  let currentFiltered = [];
  let scrollContainer = null;

  /* -----------------------------------------------------------
     render(container)
     Main entry — called by app.js router.
  ----------------------------------------------------------- */
  async function render(container) {
    viewMode = 'grid';
    scrollThresholdPx = null;
    scrollContainer = container;
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
               (!priority || j.priorityLevel === priority) &&
               (!search || haystack.some(v => v.includes(search)));
      });
      currentFiltered = filtered;
      // A fresh filter result starts back at the top in grid mode — the
      // old scroll threshold no longer applies to the new list.
      viewMode = 'grid';
      scrollThresholdPx = null;
      renderJobsView();
    };

    ['fltStatus', 'fltPriority'].forEach(id => {
      document.getElementById(id).onchange = applyFilters;
    });
    document.getElementById('fltSearch').oninput = applyFilters;

    container.onscroll = handleScroll;

    // Apply a search value supplied by the global search bar.
    applyFilters();
  }

  /* -----------------------------------------------------------
     Scroll-driven grid/list threshold
  ----------------------------------------------------------- */
  function handleScroll() {
    if (scrollThresholdPx == null || !scrollContainer) return;
    const scrollTop = scrollContainer.scrollTop;

    if (viewMode === 'grid' && scrollTop > scrollThresholdPx + SCROLL_HYSTERESIS) {
      viewMode = 'list';
      renderJobsView();
    } else if (viewMode === 'list' && scrollTop < scrollThresholdPx - SCROLL_HYSTERESIS) {
      viewMode = 'grid';
      renderJobsView();
    }
  }

  /* -----------------------------------------------------------
     Renders the current filtered jobs in whichever mode is active,
     then (grid mode only) measures where the 12th card ends so
     handleScroll() knows when to flip to list mode.
  ----------------------------------------------------------- */
  function renderJobsView() {
    if (viewMode === 'list') {
      renderList(currentFiltered);
    } else {
      renderGrid(currentFiltered);
      if (currentFiltered.length > GRID_TO_LIST_THRESHOLD) {
        measureGridThreshold();
      } else {
        scrollThresholdPx = null;
      }
    }
  }

  function measureGridThreshold() {
    const grid = document.getElementById('jobsGrid');
    if (!grid) return;
    const cards = grid.querySelectorAll('[data-job]');
    const twelfthCard = cards[GRID_TO_LIST_THRESHOLD - 1];
    if (!twelfthCard) return;
    // getBoundingClientRect (not offsetTop/offsetParent) so this stays
    // correct regardless of which ancestor ends up as the CSS positioning
    // context — it computes the scrollTop at which the 12th card's bottom
    // edge reaches the scroll container's top edge (i.e. has scrolled out).
    const containerRect = scrollContainer.getBoundingClientRect();
    const cardRect = twelfthCard.getBoundingClientRect();
    scrollThresholdPx = scrollContainer.scrollTop + (cardRect.bottom - containerRect.top);
  }

  /* -----------------------------------------------------------
     Renders job tiles into the grid
  ----------------------------------------------------------- */
  function renderGrid(jobs) {
    const grid = document.getElementById('jobsGrid');
    if (!grid) return;
    grid.className = 'tile-grid';

    if (jobs.length === 0) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <h3>No jobs match your filters</h3>
        </div>`;
      return;
    }

    grid.innerHTML = jobs.map(job => jobTile(job)).join('');
    wireJobLinks(grid);
  }

  // Row accent color by status — matches the solid "text" shade of each
  // status chip (see .chip-open/.chip-onhold/etc in main.css) so the list
  // view's left strip reads as the same status language as the grid chips.
  const STATUS_STRIP_COLOR = {
    open: '#1e40af', active: '#1e40af',
    onhold: '#92400e',
    filled: '#065f46',
    closed: '#4b5563',
  };

  /* -----------------------------------------------------------
     Renders jobs as a compact list (row per job) once there are more
     than GRID_TO_LIST_THRESHOLD jobs and the user has scrolled past
     where the grid's 12th card ended.
  ----------------------------------------------------------- */
  function renderList(jobs) {
    const grid = document.getElementById('jobsGrid');
    if (!grid) return;
    grid.className = '';

    if (jobs.length === 0) {
      grid.innerHTML = `<div class="empty"><h3>No jobs match your filters</h3></div>`;
      return;
    }

    grid.innerHTML = `
      <div class="detail-card">
        <h3>All Jobs</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:4px;padding:0"></th>
              <th>JOB TITLE</th>
              <th>CLIENT</th>
              <th>LOCATION</th>
              <th>STATUS</th>
              <th>PRIORITY</th>
              <th>RECRUITER</th>
              <th>POSTED</th>
            </tr>
          </thead>
          <tbody>
            ${jobs.map(job => `
              <tr data-job="${job.id}">
                <td style="padding:0;background:${STATUS_STRIP_COLOR[job.status] || '#9ca3af'}"></td>
                <td style="font-weight:600">${job.title}</td>
                <td>${job.client || ''}</td>
                <td>${job.location || ''}</td>
                <td><span class="chip chip-${job.status}">${job.status}</span></td>
                <td>${job.priority || '—'}</td>
                <td>${job.primaryRecruiter || 'Unassigned'}</td>
                <td>${job.createdAt || ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    wireJobLinks(grid);
  }

  function wireJobLinks(container) {
    container.querySelectorAll('[data-job]').forEach(el => {
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
          <span style="font-size:12px;color:var(--text-muted)">${job.priority || '—'}</span>
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