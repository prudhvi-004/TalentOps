/* =============================================================
   SUBMITTALS DETAIL PAGE — submittals.js
   =============================================================
   Purpose:
     Dashboard "Submittals" tile drills into this page. Shows every
     submittal across all jobs assigned to the logged-in recruiter.

   API connection:
     ApiService.getSubmittals() → GET /api/submittals →
     atsService.getSubmittals() → live JobDiva JobsSubmittalsDetail,
     scoped server-side to the authenticated user's JobDiva USERID.
   ============================================================= */

const SubmittalsPage = (() => {

  let table = null;
  let activeRange = 'today';
  let activeType = 'all';

  async function render(container) {
    const user = AuthClient.user;

    container.innerHTML = `
      <div class="breadcrumb fade-in" style="margin-bottom:10px">
        <span data-nav="/">← Back to Dashboard</span>
      </div>

      <div class="page-header fade-in">
        <div>
          <div class="page-title">Submittals — Detail</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        ${[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom Date']]
          .map(([val, lbl]) => `
            <button class="filter-btn ${activeRange === val ? 'active' : ''}" data-range="${val}">${lbl}</button>`).join('')}

        <select id="subRecruiterSelect" style="padding:6px 10px;font-size:12px">
          <option>${user ? (user.name || user.email) : 'Recruiter'}</option>
        </select>

        <div id="subCustomDateInputs" style="display:none;gap:6px;align-items:center">
          <input type="date" id="subDateFrom" style="padding:4px 8px;font-size:12px"/>
          <span style="font-size:12px;color:var(--text-muted)">to</span>
          <input type="date" id="subDateTo" style="padding:4px 8px;font-size:12px"/>
        </div>

        <input id="subSearch" placeholder="Search records..." style="min-width:200px;padding:6px 10px;font-size:12px;margin-left:auto"/>
      </div>

      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px">Submittal Type</div>
      <div style="display:flex;gap:8px;margin-bottom:20px">
        ${[['all', 'All'], ['internal', 'Internal'], ['external', 'External']]
          .map(([val, lbl]) => `
            <button class="filter-btn ${activeType === val ? 'active' : ''}" data-type="${val}" data-label="${lbl}">${lbl}</button>`).join('')}
      </div>

      <div class="detail-card">
        <h3 id="subRecordsTitle">Submittals Records</h3>
        <div id="submittalsTableWrap">
          <div class="loading-screen" style="height:160px">
            <div class="loading-spinner"></div>
            <p>Loading submittals...</p>
          </div>
        </div>
      </div>`;

    container.querySelector('[data-nav="/"]').onclick = () => window.navigate('/');

    container.querySelectorAll('[data-range]').forEach(btn => {
      btn.onclick = () => {
        activeRange = btn.dataset.range;
        container.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === activeRange));
        document.getElementById('subCustomDateInputs').style.display = activeRange === 'custom' ? 'flex' : 'none';
        applyFilters();
      };
    });
    document.getElementById('subDateFrom').onchange = applyFilters;
    document.getElementById('subDateTo').onchange = applyFilters;

    container.querySelectorAll('[data-type]').forEach(btn => {
      btn.onclick = () => {
        activeType = btn.dataset.type;
        container.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === activeType));
        applyFilters();
      };
    });

    document.getElementById('subSearch').oninput = LoadMore.debounce(applyFilters, 250);

    await loadScript('/js/components/record-detail-shared.js');

    // Cursor-paginated: the server applies range/search/type and returns one
    // page at a time; `facets.type` carries the counts beside the type buttons.
    table = RecordDetailShared.pagedTable({
      wrap: document.getElementById('submittalsTableWrap'),
      headHtml: `<tr><th>CANDIDATE</th><th>TYPE</th><th>JOB</th><th>CLIENT</th><th>STAGE</th><th>DATE</th></tr>`,
      rowHtml: s => `
        <tr>
          <td><a href="#" data-cand="${s.candidateId}" data-job="${s.jobId}" style="color:var(--primary);font-weight:600;text-decoration:none">${s.candidateName}</a></td>
          <td><span class="chip ${s.type === 'External' ? 'chip-filled' : 'chip-open'}">${s.type.toUpperCase()}</span></td>
          <td><a href="#" data-job-link="${s.jobId}" style="color:var(--primary);text-decoration:none">${s.jobTitle}</a></td>
          <td>${s.client || ''}</td>
          <td><span class="chip ${stageChipClass(s.stage)}">${s.stage.toUpperCase()}</span></td>
          <td>${s.date || ''}</td>
        </tr>`,
      emptyHtml: `<div class="empty"><h3>No submittals match your filters</h3></div>`,
      errorTitle: 'Could not load submittals',
      fetchPage: params => ApiService.getSubmittals(params),
      onPage: ({ pageInfo, facets }) => {
        const counts = (facets && facets.type) || {};
        document.querySelectorAll('[data-type]').forEach(b => {
          b.textContent = `${b.dataset.label} (${counts[b.dataset.type] || 0})`;
        });
        const h = document.getElementById('subRecordsTitle');
        if (h) h.textContent = `Submittals Records (${pageInfo.total})`;
      },
    });
    applyFilters();
  }

  function applyFilters() {
    if (!table) return;
    table.load({
      ...RecordDetailShared.rangeParams(activeRange,
        document.getElementById('subDateFrom').value, document.getElementById('subDateTo').value),
      q: document.getElementById('subSearch').value.trim(),
      type: activeType,
    });
  }

  function stageChipClass(stage) {
    switch (stage) {
      case 'Placed':    return 'chip-filled';
      case 'Interview':  return 'chip-open';
      case 'Rejected':   return 'chip-closed';
      default:           return 'chip-medium'; // Screening
    }
  }

  return { render };

})();
