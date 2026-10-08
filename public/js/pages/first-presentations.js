/* =============================================================
   FIRST PRESENTATION SUCCESS DETAIL PAGE — first-presentations.js
   =============================================================
   Dashboard "First Presentation" tile drills into this page. Shows
   the earliest submittal per candidate+job — the first time each
   candidate was presented to the client for that role.

   API connection:
     ApiService.getFirstPresentations() → GET /api/first-presentations →
     atsService.getFirstPresentations() → derived from getSubmittals(),
     scoped server-side to the authenticated user's JobDiva USERID.
   ============================================================= */

const FirstPresentationsPage = (() => {

  let allRecords = [];
  let activeRange = 'today';

  async function render(container) {
    const user = AuthClient.user;

    container.innerHTML = `
      <div class="breadcrumb fade-in" style="margin-bottom:10px">
        <span data-nav="/">← Back to Dashboard</span>
      </div>

      <div class="page-header fade-in">
        <div><div class="page-title">First Presentation Success — Detail</div></div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;flex-wrap:wrap">
        ${[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom Date']]
          .map(([val, lbl]) => `
            <button class="filter-btn ${activeRange === val ? 'active' : ''}" data-range="${val}">${lbl}</button>`).join('')}

        <select id="recruiterSelect" style="padding:6px 10px;font-size:12px">
          <option>${user ? (user.name || user.email) : 'Recruiter'}</option>
        </select>

        <div id="customDateInputs" style="display:none;gap:6px;align-items:center">
          <input type="date" id="dateFrom" style="padding:4px 8px;font-size:12px"/>
          <span style="font-size:12px;color:var(--text-muted)">to</span>
          <input type="date" id="dateTo" style="padding:4px 8px;font-size:12px"/>
        </div>

        <input id="searchInput" placeholder="Search records..." style="min-width:200px;padding:6px 10px;font-size:12px;margin-left:auto"/>
      </div>

      <div class="detail-card">
        <h3>First Presentation Success Records</h3>
        <div id="tableWrap">
          <div class="loading-screen" style="height:160px">
            <div class="loading-spinner"></div>
            <p>Loading records...</p>
          </div>
        </div>
      </div>`;

    RecordDetailShared.wireCommonControls(container, () => activeRange, (v) => activeRange = v, applyFilters);

    const result = await ApiService.getFirstPresentations();
    if (!result.success) {
      document.getElementById('tableWrap').innerHTML = `
        <div class="empty"><h3>Could not load records</h3><p>${result.error}</p></div>`;
      return;
    }

    allRecords = result.data;
    applyFilters();
  }

  function applyFilters() {
    const search = document.getElementById('searchInput').value.trim().toLowerCase();
    const filtered = allRecords.filter(r => {
      const rangeOk = RecordDetailShared.inRange(r.dateRaw, activeRange);
      const haystack = [r.candidateName, r.jobTitle, r.client].map(v => String(v || '').toLowerCase());
      const searchOk = !search || haystack.some(v => v.includes(search));
      return rangeOk && searchOk;
    });
    renderTable(filtered);
  }

  function renderTable(rows) {
    const wrap = document.getElementById('tableWrap');
    if (!wrap) return;

    if (rows.length === 0) {
      wrap.innerHTML = `<div class="empty"><h3>No records match your filters</h3></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>DATE</th><th>CANDIDATE</th><th>JOB</th><th>CLIENT</th><th>NOTES</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.date || ''}</td>
              <td><a href="#" data-cand="${r.candidateId}" data-job="${r.jobId}" style="color:var(--primary);font-weight:600;text-decoration:none">${r.candidateName}</a></td>
              <td><a href="#" data-job-link="${r.jobId}" style="color:var(--primary);text-decoration:none">${r.jobTitle}</a></td>
              <td>${r.client || ''}</td>
              <td>${r.notes || ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    RecordDetailShared.wireRowLinks(wrap);
  }

  return { render };

})();
