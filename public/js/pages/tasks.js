/* =============================================================
   TASKS PAGE — tasks.js
   Automated tab: tasks created by the 120-minute AI note audit
   (server/services/ai-notes.service.js). Pending -> completed
   happens server-side when a REC_AI note is detected.
   API: GET /api/tasks
   ============================================================= */

const TasksPage = (() => {
  let tasks = [];
  let activeStatus = 'pending';

  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const when = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  // Cursor pagination: the server filters by status and returns newest-first
  // pages. `nextCursor` continues the list; the live poll re-reads as many rows
  // as are already shown (no cursor) so refreshes never drop loaded pages.
  let nextCursor = null;
  let hasMore = false;
  let total = 0;
  let version = 0; // bumped on every tab change so stale responses are ignored

  async function fetchTasks(list, { reset }) {
    const myVersion = version;
    const limit = reset ? ApiService.PAGE_SIZE : Math.min(Math.max(tasks.length, ApiService.PAGE_SIZE), 500);
    const result = await ApiService.getTasks(activeStatus, { limit });
    if (myVersion !== version) return null;
    if (!result.success) {
      list.innerHTML = `<div class="empty"><h3>Could not load tasks</h3><p>${esc(result.error)}</p></div>`;
      return result;
    }
    tasks = result.data || [];
    nextCursor = result.pageInfo.nextCursor;
    hasMore = result.pageInfo.hasMore;
    total = result.pageInfo.total;
    renderList(list);
    return result;
  }

  async function loadMore(list) {
    const myVersion = version;
    const result = await ApiService.getTasks(activeStatus, { limit: ApiService.PAGE_SIZE, cursor: nextCursor });
    if (myVersion !== version || !result.success) return;
    tasks = tasks.concat(result.data || []);
    nextCursor = result.pageInfo.nextCursor;
    hasMore = result.pageInfo.hasMore;
    total = result.pageInfo.total;
    renderList(list);
  }

  async function render(container) {
    tasks = [];
    nextCursor = null;
    hasMore = false;
    container.innerHTML = `
      <div class="page-header fade-in"><div class="page-title">Tasks</div></div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="filter-btn active" disabled>Automated</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="filter-btn active" data-status="pending">Pending</button>
        <button class="filter-btn" data-status="completed">Completed</button>
      </div>
      <div id="taskList"><div class="loading-spinner"></div></div>
      <div id="taskMore"></div>`;

    const list = container.querySelector('#taskList');
    container.querySelectorAll('[data-status]').forEach(btn => {
      btn.onclick = () => {
        activeStatus = btn.dataset.status;
        container.querySelectorAll('[data-status]').forEach(b =>
          b.classList.toggle('active', b.dataset.status === activeStatus));
        version++;
        tasks = [];
        list.innerHTML = '<div class="loading-spinner"></div>';
        fetchTasks(list, { reset: true });
      };
    });

    // Keep the list live while the page is open.
    let first = true;
    while (container.contains(list)) {
      const result = await fetchTasks(list, { reset: first });
      first = false;
      if (!container.contains(list)) return; // navigated away
      if (result && !result.success) return;
      // Live view: re-read every 5s while scanning, then every 30s while the page is open.
      await new Promise(r => setTimeout(r, result && result.syncing ? 5000 : 30000));
    }
  }

  // Derives source / note type / sentiment from the Sense AI note type name,
  // e.g. "Sense AI Auto sourcing Evaluation: Positive", "Sense AI Applicant Review: Negative".
  function classify(t) {
    const text = String(t.aiNote || '');
    const source = /auto\s*sourc/i.test(text) ? 'Auto Sourcing'
                 : /applicant/i.test(text) ? 'Applicant'
                 : t.aiCategory === 'Candidate' ? 'Auto Sourcing'
                 : t.aiCategory === 'Applicant' ? 'Applicant' : 'Other';
    const kind = /review/i.test(text) ? 'Review' : /evaluation/i.test(text) ? 'Evaluation' : '';
    const sentiment = /positive/i.test(text + ' ' + (t.sentiment || '')) ? 'positive'
                    : /negative/i.test(text + ' ' + (t.sentiment || '')) ? 'negative' : '';
    return { source, kind, sentiment };
  }

  function renderList(list) {
    const rows = tasks;
    if (!rows.length) {
      LoadMore.clear(list.parentElement.querySelector('#taskMore'));
      list.innerHTML = `<div class="empty"><h3>No ${activeStatus} automated tasks</h3></div>`;
      return;
    }
    // Segregate by source (Applicant vs Auto Sourcing); each group gets a header row.
    const groups = [
      { key: 'Applicant', label: 'Applicant', rows: [] },
      { key: 'Auto Sourcing', label: 'Auto Sourcing', rows: [] },
      { key: 'Other', label: 'Other', rows: [] },
    ];
    rows.forEach(t => (groups.find(g => g.key === classify(t).source) || groups[2]).rows.push(t));

    const pill = (text, fg, bg) =>
      `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:${fg};background:${bg};white-space:nowrap">${text}</span>`;

    const rowHtml = t => {
      const c = classify(t);
      const band = c.sentiment === 'positive' ? '#16a34a' : c.sentiment === 'negative' ? '#dc2626' : '#6366f1';
      const tint = c.sentiment === 'positive' ? 'rgba(22,163,74,.06)' : c.sentiment === 'negative' ? 'rgba(220,38,38,.06)' : '';
      const result = c.sentiment === 'positive' ? pill('Positive', '#15803d', 'rgba(22,163,74,.15)')
                   : c.sentiment === 'negative' ? pill('Negative', '#b91c1c', 'rgba(220,38,38,.15)')
                   : '<span style="color:var(--text-muted)">—</span>';
      const kind = c.kind === 'Review' ? pill('Review', '#4338ca', 'rgba(99,102,241,.15)')
                 : c.kind === 'Evaluation' ? pill('Evaluation', '#0e7490', 'rgba(6,182,212,.15)')
                 : '<span style="color:var(--text-muted)">—</span>';
      return `
          <tr class="task-row" data-job="${esc(t.jobId)}" data-cand="${esc(t.candidateId)}" data-cat="${esc(t.aiCategory)}"
              style="cursor:pointer;border-top:1px solid var(--border);box-shadow:inset 4px 0 0 ${band};background:${tint}">
            <td style="padding:12px 16px;font-weight:600">${esc(t.candidateName)}</td>
            <td style="padding:12px 16px">${esc(t.jobRef || t.jobId)}${t.jobTitle ? `<div style="font-size:11px;color:var(--text-muted)">${esc(t.jobTitle)}</div>` : ''}</td>
            <td style="padding:12px 16px">${kind}</td>
            <td style="padding:12px 16px">${result}${t.score != null ? `<span class="chip" style="margin-left:6px">Score ${esc(t.score)}</span>` : ''}</td>
            <td style="padding:12px 16px;white-space:nowrap;color:var(--text-muted)">
              ${when(t.createdAt)}${t.overdue ? '<div style="font-size:11px;color:#d97706;font-weight:600">120+ min, no recruiter note</div>' : ''}${t.completedAt ? `<div style="font-size:11px">Done ${when(t.completedAt)}</div>` : ''}
            </td>
          </tr>`;
    };

    list.innerHTML = `
      <div style="background:var(--card-bg,#fff);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;background:rgba(99,102,241,.08);color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em">
          <th style="padding:12px 16px">Name</th>
          <th style="padding:12px 16px">JobDiva Ref</th>
          <th style="padding:12px 16px">Note Type</th>
          <th style="padding:12px 16px">Result</th>
          <th style="padding:12px 16px">Created</th>
        </tr></thead>
        <tbody>${groups.filter(g => g.rows.length).map(g => `
          <tr><td colspan="5" style="padding:10px 16px;background:rgba(99,102,241,.05);border-top:1px solid var(--border);font-weight:700;font-size:12px">
            ${g.label} <span style="font-weight:400;color:var(--text-muted)">(${g.rows.length})</span>
          </td></tr>
          ${g.rows.map(rowHtml).join('')}`).join('')}
        </tbody>
      </table></div></div>`;

    list.querySelectorAll('[data-job]').forEach(el => {
      el.onclick = () => {
        // Opens the job in split view: job on one side, candidate on the other
        sessionStorage.setItem('openCandId', el.dataset.cand);
        sessionStorage.setItem('openCandSource', 'ai');
        sessionStorage.setItem('openCandAICat', el.dataset.cat || 'Applicant');
        window.navigate(`/jobs/${el.dataset.job}`);
      };
    });

    LoadMore.attach(list.parentElement.querySelector('#taskMore'), {
      shown: tasks.length, total, hasMore, onMore: () => loadMore(list),
    });
  }

  return { render };
})();
