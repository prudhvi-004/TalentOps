/* =============================================================
   INTERVIEWS DETAIL PAGE — interviews.js
   =============================================================
   Dashboard "Interviews" tile drills into this page. Shows every
   submittal with a scheduled/held interview, across all jobs
   assigned to the logged-in recruiter.

   API connection:
     ApiService.getInterviews() → GET /api/interviews →
     atsService.getInterviews() → derived from getSubmittals(),
     scoped server-side to the authenticated user's JobDiva USERID.
   ============================================================= */

const InterviewsPage = (() => {

  let table = null;
  let activeRange = 'today';

  async function render(container) {
    const user = AuthClient.user;

    container.innerHTML = `
      <div class="breadcrumb fade-in" style="margin-bottom:10px">
        <span data-nav="/">← Back to Dashboard</span>
      </div>

      <div class="page-header fade-in">
        <div><div class="page-title">Interviews — Detail</div></div>
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
        <h3>Interviews Records</h3>
        <div id="tableWrap">
          <div class="loading-screen" style="height:160px">
            <div class="loading-spinner"></div>
            <p>Loading interviews...</p>
          </div>
        </div>
      </div>`;

    RecordDetailShared.wireCommonControls(container, () => activeRange, (v) => activeRange = v, applyFilters);

    // Cursor-paginated: the server filters (range/search) and returns one page
    // at a time; more rows load as the table footer scrolls into view.
    table = RecordDetailShared.pagedTable({
      wrap: document.getElementById('tableWrap'),
      headHtml: `<tr><th>DATE</th><th>CANDIDATE</th><th>JOB</th><th>CLIENT</th><th>NOTES</th></tr>`,
      rowHtml: r => `
        <tr>
          <td>${r.date || ''}</td>
          <td><a href="#" data-cand="${r.candidateId}" data-job="${r.jobId}" style="color:var(--primary);font-weight:600;text-decoration:none">${r.candidateName}</a></td>
          <td><a href="#" data-job-link="${r.jobId}" style="color:var(--primary);text-decoration:none">${r.jobTitle}</a></td>
          <td>${r.client || ''}</td>
          <td>${r.notes || ''}</td>
        </tr>`,
      emptyHtml: `<div class="empty"><h3>No interviews match your filters</h3></div>`,
      errorTitle: 'Could not load interviews',
      fetchPage: params => ApiService.getInterviews(params),
    });
    applyFilters();
  }

  function applyFilters() {
    table.load({
      ...RecordDetailShared.rangeParams(activeRange,
        document.getElementById('dateFrom')?.value, document.getElementById('dateTo')?.value),
      q: document.getElementById('searchInput').value.trim(),
    });
  }

  return { render };

})();
