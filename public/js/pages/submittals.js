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

  let allSubmittals = [];
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
            <button class="filter-btn ${activeType === val ? 'active' : ''}" data-type="${val}">${lbl}</button>`).join('')}
      </div>

      <div class="detail-card">
        <h3>Submittals Records</h3>
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

    document.getElementById('subSearch').oninput = applyFilters;

    const result = await ApiService.getSubmittals();
    if (!result.success) {
      document.getElementById('submittalsTableWrap').innerHTML = `
        <div class="empty"><h3>Could not load submittals</h3><p>${result.error}</p></div>`;
      return;
    }

    allSubmittals = result.data;
    applyFilters();
  }

  function inRange(dateRaw) {
    if (!dateRaw) return activeRange === 'custom' ? false : true;
    const d = new Date(dateRaw);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Upper bound: today/week/month are trailing windows ending "now", not
    // open-ended into the future — otherwise a future-dated record (e.g. a
    // placement start date next month) would match every range, "Today" included.
    const endOfToday = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    if (activeRange === 'today') {
      return d >= startOfDay && d < endOfToday;
    }
    if (activeRange === 'week') {
      const weekAgo = new Date(startOfDay.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d >= weekAgo && d < endOfToday;
    }
    if (activeRange === 'month') {
      const monthAgo = new Date(startOfDay.getTime() - 30 * 24 * 60 * 60 * 1000);
      return d >= monthAgo && d < endOfToday;
    }
    if (activeRange === 'custom') {
      const from = document.getElementById('subDateFrom').value;
      const to = document.getElementById('subDateTo').value;
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1)) return false;
      return true;
    }
    return true;
  }

  function applyFilters() {
    const search = document.getElementById('subSearch').value.trim().toLowerCase();

    const filtered = allSubmittals.filter(s => {
      const typeOk = activeType === 'all' || s.type.toLowerCase() === activeType;
      const rangeOk = inRange(s.dateRaw);
      const haystack = [s.candidateName, s.jobTitle, s.client, s.stage, s.type].map(v => String(v || '').toLowerCase());
      const searchOk = !search || haystack.some(v => v.includes(search));
      return typeOk && rangeOk && searchOk;
    });

    renderTable(filtered);
  }

  function stageChipClass(stage) {
    switch (stage) {
      case 'Placed':    return 'chip-filled';
      case 'Interview':  return 'chip-open';
      case 'Rejected':   return 'chip-closed';
      default:           return 'chip-medium'; // Screening
    }
  }

  function renderTable(rows) {
    const wrap = document.getElementById('submittalsTableWrap');
    if (!wrap) return;

    if (rows.length === 0) {
      wrap.innerHTML = `<div class="empty"><h3>No submittals match your filters</h3></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>CANDIDATE</th>
            <th>TYPE</th>
            <th>JOB</th>
            <th>CLIENT</th>
            <th>STAGE</th>
            <th>DATE</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(s => `
            <tr>
              <td><a href="#" data-cand="${s.candidateId}" data-job="${s.jobId}" style="color:var(--primary);font-weight:600;text-decoration:none">${s.candidateName}</a></td>
              <td><span class="chip ${s.type === 'External' ? 'chip-filled' : 'chip-open'}">${s.type.toUpperCase()}</span></td>
              <td><a href="#" data-job-link="${s.jobId}" style="color:var(--primary);text-decoration:none">${s.jobTitle}</a></td>
              <td>${s.client || ''}</td>
              <td><span class="chip ${stageChipClass(s.stage)}">${s.stage.toUpperCase()}</span></td>
              <td>${s.date || ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('[data-cand]').forEach(el => {
      el.onclick = (e) => {
        e.preventDefault();
        window.navigate(`/candidates/${el.dataset.cand}?source=pipeline&jobId=${el.dataset.job}`);
      };
    });
    wrap.querySelectorAll('[data-job-link]').forEach(el => {
      el.onclick = (e) => {
        e.preventDefault();
        window.navigate(`/jobs/${el.dataset.jobLink}`);
      };
    });
  }

  return { render };

})();
