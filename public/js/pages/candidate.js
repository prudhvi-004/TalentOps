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

  const GRID_TO_LIST_THRESHOLD = 8;
  const SCROLL_HYSTERESIS = 24;
  let viewMode = 'grid';
  let scrollThresholdPx = null;
  let currentFiltered = [];
  let scrollContainer = null;

  function handleScroll() {
    if (scrollThresholdPx == null || !scrollContainer) return;
    const top = scrollContainer.scrollTop;
    if (viewMode === 'grid' && top > scrollThresholdPx + SCROLL_HYSTERESIS) {
      viewMode = 'list'; renderView();
    } else if (viewMode === 'list' && top < scrollThresholdPx - SCROLL_HYSTERESIS) {
      viewMode = 'grid'; renderView();
    }
  }

  function renderView() {
    if (viewMode === 'list') return renderList(currentFiltered);
    renderGrid(currentFiltered);
    const card = document.getElementById('candGrid')
      ?.querySelectorAll('[data-cand-tile]')[GRID_TO_LIST_THRESHOLD - 1];
    if (currentFiltered.length > GRID_TO_LIST_THRESHOLD && card) {
      scrollThresholdPx = scrollContainer.scrollTop +
        (card.getBoundingClientRect().bottom - scrollContainer.getBoundingClientRect().top);
    } else {
      scrollThresholdPx = null;
    }
  }

  function wireClicks(grid) {
    grid.querySelectorAll('[data-cand-tile]').forEach(el => {
      el.onclick = () => {
        sessionStorage.setItem('openCandId', el.dataset.candId);
        sessionStorage.setItem('openCandSource', el.dataset.source);
        sessionStorage.setItem('openCandAICat', el.dataset.aiCategory || 'Applicant');
        window.navigate(`/jobs/${el.dataset.jobId}`);
      };
    });
  }

  function renderList(candidates) {
    const grid = document.getElementById('candGrid');
    if (!grid) return;
    grid.className = '';
    grid.innerHTML = `
      <div class="detail-card">
        <h3>All Candidates</h3>
        <table class="data-table">
          <thead><tr><th>CANDIDATE</th><th>JOB</th><th>CLIENT</th><th>EMAIL</th><th>PHONE</th><th>LOCATION</th><th>STAGE</th><th>SUBMITTED</th></tr></thead>
          <tbody>
            ${candidates.map(c => `
              <tr data-cand-tile="${c.id}" data-cand-id="${c.id}" data-job-id="${c._job?.id || ''}"
                  data-source="${c._source}" style="cursor:pointer">
                <td style="font-weight:600">${c.name}</td>
                <td>${c._job?.title || '—'}</td>
                <td>${c._job?.client || ''}</td>
                <td>${c.email || ''}</td>
                <td>${c.phone || ''}</td>
                <td>${c.candidateLocation || ''}</td>
                <td>${c.stage || ''}</td>
                <td>${c.submittedOn || ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    wireClicks(grid);
  }

  async function render(container) {
    viewMode = 'grid';
    scrollThresholdPx = null;
    container.innerHTML = `
      <div class="page-header fade-in">
        <div>
          <div class="page-title">Candidates</div>
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

    // Cursor-paginated: one row per submitted candidate+job (this recruiter's
    // submittals, newest first). The server applies search / job filter and
    // returns a page at a time; more tiles load as the footer scrolls into view.
    const pager = ApiService.createPager(params => ApiService.getCandidates(params));
    const more = document.createElement('div');
    container.appendChild(more);
    let loaded = [];
    let jobsFilled = false;

    // Server row -> the tile shape the renderers below use.
    const toTile = r => ({
      id: r.id, name: r.name, _source: 'pipeline',
      _job: { id: r.jobId, title: r.jobTitle, client: r.client },
      stage: r.stage, submittedOn: r.submittedOn, type: r.type,
      email: r.email, phone: r.phone, candidateLocation: r.candidateLocation,
      currentTitle: r.currentTitle, currentCompany: r.currentCompany,
      interviewDate: r.interviewDate, startDate: r.startDate, jobLocation: r.jobLocation,
    });

    scrollContainer = container;
    container.onscroll = handleScroll;

    const showPage = (page, append) => {
      const grid = document.getElementById('candGrid');
      if (!grid) return; // navigated away
      if (!page.success) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Could not load data</h3></div>';
        return;
      }
      // Job dropdown options arrive with the first page of the first load.
      if (!jobsFilled && page.meta) {
        jobsFilled = true;
        const jobFilter = document.getElementById('candJobFilter');
        page.meta.jobs.forEach(j => {
          const opt = document.createElement('option');
          opt.value = j.id;
          opt.textContent = j.title;
          jobFilter.appendChild(opt);
        });
      }
      loaded = append ? loaded.concat(page.rows.map(toTile)) : page.rows.map(toTile);
      currentFiltered = loaded;
      document.getElementById('candPageSub').textContent =
        `${page.pageInfo.total} submitted candidates`;
      renderView();
      LoadMore.attach(more, {
        shown: loaded.length, total: page.pageInfo.total, hasMore: pager.hasMore,
        onMore: async () => { const next = await pager.next(); if (next) showPage(next, true); },
      });
    };

    async function applyFilters() {
      viewMode = 'grid';
      scrollThresholdPx = null;
      const page = await pager.reset({
        q: document.getElementById('candSearch').value.trim(),
        jobId: document.getElementById('candJobFilter').value,
      });
      if (page) showPage(page, false);
    }

    document.getElementById('candSearch').oninput   = LoadMore.debounce(applyFilters, 250);
    document.getElementById('candJobFilter').onchange = applyFilters;

    applyFilters();
  }

  function renderGrid(candidates) {
    const grid = document.getElementById('candGrid');
    if (!grid) return;
    grid.className = 'tile-grid';

    if (candidates.length === 0) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <h3>No candidates match</h3>
        </div>`;
      return;
    }

    grid.className = 'tile-grid';
    grid.innerHTML = candidates.map(c => candidateTile(c)).join('');
    wireClicks(grid);
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
            ${isAI ? '' : ''}${c.name}
          </div>
          ${isAI
            ? `<span class="ai-stage-badge" style="font-size:10px">AI</span>`
            : ''}
        </div>

        <div class="tile-client">
          ${c._job?.title || '—'} · ${c._job?.client || '—'}
        </div>

        ${c.currentTitle || c.currentCompany
          ? `<div style="margin-top:6px;font-size:12px">${[c.currentTitle, c.currentCompany].filter(Boolean).join(' @ ')}</div>` : ''}
        <div style="margin-top:6px;font-size:12px;color:var(--text-muted)">
          ${c.candidateLocation || c.jobLocation || '—'}
        </div>

        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="chip chip-open">${(c.stage || '').toUpperCase()}</span>
          <span class="chip ${c.type === 'External' ? 'chip-filled' : 'chip-medium'}">${(c.type || '').toUpperCase()}</span>
        </div>

        <div class="tile-meta" style="flex-wrap:wrap;gap:4px 12px">
          <span>${c.email || ''}</span>
          <span>${c.phone || ''}</span>
          <span>Submitted ${c.submittedOn || '—'}</span>
          ${c.interviewDate ? `<span>Interview ${c.interviewDate}</span>` : ''}
          ${c.startDate ? `<span>Start ${c.startDate}</span>` : ''}
        </div>

      </div>`;
  }

  return { render };

})();