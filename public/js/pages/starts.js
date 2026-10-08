/* =============================================================
   STARTS DETAIL PAGE — starts.js
   =============================================================
   Dashboard "Starts" tile drills into this page. Shows every
   submittal with a start date, across all jobs assigned to the
   logged-in recruiter.

   "Filter Candidates" buttons map onto real JobDiva submittal
   fields as follows (there is no dedicated "bench" flag in the
   BI feed, so it's approximated from start/end dates):
     Active                → no end date yet, or end date in the future
     On Bench              → assignment has already ended (candidate is
                              between engagements)
     Ending in 30 Days     → end date falls within the next 30 days
     Unapproved Assignments→ JobDiva START_STATUS isn't "Approved"

   API connection:
     ApiService.getStarts() → GET /api/starts →
     atsService.getStarts() → derived from getSubmittals(),
     scoped server-side to the authenticated user's JobDiva USERID.
   ============================================================= */

const StartsPage = (() => {

  let allRecords = [];
  let activeRange = 'today';
  let activeCandidateFilter = 'active';

  async function render(container) {
    const user = AuthClient.user;

    container.innerHTML = `
      <div class="breadcrumb fade-in" style="margin-bottom:10px">
        <span data-nav="/">← Back to Dashboard</span>
      </div>

      <div class="page-header fade-in">
        <div><div class="page-title">Starts — Detail</div></div>
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
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

      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px">Filter Candidates</div>
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
        ${[
          ['active', 'Active'],
          ['bench', 'On Bench'],
          ['ending30', 'Ending in 30 Days'],
          ['unapproved', 'Unapproved Assignments'],
        ].map(([val, lbl]) => `
          <button class="filter-btn ${activeCandidateFilter === val ? 'active' : ''}" data-cfilter="${val}">${lbl}</button>`).join('')}
      </div>

      <div class="detail-card">
        <h3>Starts Records</h3>
        <div id="tableWrap">
          <div class="loading-screen" style="height:160px">
            <div class="loading-spinner"></div>
            <p>Loading starts...</p>
          </div>
        </div>
      </div>`;

    RecordDetailShared.wireCommonControls(container, () => activeRange, (v) => activeRange = v, applyFilters);

    container.querySelectorAll('[data-cfilter]').forEach(btn => {
      btn.onclick = () => {
        activeCandidateFilter = btn.dataset.cfilter;
        container.querySelectorAll('[data-cfilter]').forEach(b => b.classList.toggle('active', b.dataset.cfilter === activeCandidateFilter));
        applyFilters();
      };
    });

    const result = await ApiService.getStarts();
    if (!result.success) {
      document.getElementById('tableWrap').innerHTML = `
        <div class="empty"><h3>Could not load starts</h3><p>${result.error}</p></div>`;
      return;
    }

    allRecords = result.data;
    applyFilters();
  }

  function candidateFilterOk(r) {
    switch (activeCandidateFilter) {
      case 'active':      return r.status === 'Active';
      case 'bench':        return r.status === 'Ended';
      case 'ending30':     return !!r.endingSoon;
      case 'unapproved':   return !r.approved;
      default:             return true;
    }
  }

  function applyFilters() {
    const search = document.getElementById('searchInput').value.trim().toLowerCase();
    const filtered = allRecords.filter(r => {
      const rangeOk = RecordDetailShared.inRange(r.dateRaw, activeRange);
      const candidateOk = candidateFilterOk(r);
      const haystack = [r.candidateName, r.jobTitle, r.client, r.location].map(v => String(v || '').toLowerCase());
      const searchOk = !search || haystack.some(v => v.includes(search));
      return rangeOk && candidateOk && searchOk;
    });
    renderTable(filtered);
  }

  function statusChipClass(status) {
    if (status === 'Active') return 'chip-filled';
    if (status === 'Unapproved') return 'chip-medium';
    return 'chip-closed'; // Ended
  }

  function renderTable(rows) {
    const wrap = document.getElementById('tableWrap');
    if (!wrap) return;

    if (rows.length === 0) {
      wrap.innerHTML = `<div class="empty"><h3>No starts match your filters</h3></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>CANDIDATE</th><th>STATUS</th><th>JOB</th><th>CLIENT</th><th>LOCATION</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><a href="#" data-cand="${r.candidateId}" data-job="${r.jobId}" style="color:var(--primary);font-weight:600;text-decoration:none">${r.candidateName}</a></td>
              <td><span class="chip ${statusChipClass(r.status)}">${r.status.toUpperCase()}</span></td>
              <td><a href="#" data-job-link="${r.jobId}" style="color:var(--primary);text-decoration:none">${r.jobTitle}</a></td>
              <td>${r.client || ''}</td>
              <td>${r.location || ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    RecordDetailShared.wireRowLinks(wrap);
  }

  return { render };

})();
