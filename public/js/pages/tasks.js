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

  async function render(container) {
    container.innerHTML = `
      <div class="page-header fade-in"><div class="page-title">✅ Tasks</div></div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="filter-btn active" disabled>Automated</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="filter-btn active" data-status="pending">Pending</button>
        <button class="filter-btn" data-status="completed">Completed</button>
      </div>
      <div id="taskList"><div class="loading-spinner"></div></div>`;

    container.querySelectorAll('[data-status]').forEach(btn => {
      btn.onclick = () => {
        activeStatus = btn.dataset.status;
        container.querySelectorAll('[data-status]').forEach(b =>
          b.classList.toggle('active', b.dataset.status === activeStatus));
        renderList(container.querySelector('#taskList'));
      };
    });

    const list = container.querySelector('#taskList');
    // Keep the list live while the page is open.
    while (container.contains(list)) {
      const result = await ApiService.getTasks();
      if (!container.contains(list)) return; // navigated away
      if (!result.success) {
        list.innerHTML = `<div class="empty"><h3>Could not load tasks</h3><p>${esc(result.error)}</p></div>`;
        return;
      }
      tasks = result.data || [];
      renderList(list);
      // Live view: re-read every 5s while scanning, then every 30s while the page is open.
      await new Promise(r => setTimeout(r, result.syncing ? 5000 : 30000));
    }
  }

  function renderList(list) {
    const rows = tasks.filter(t => t.status === activeStatus);
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><h3>No ${activeStatus} automated tasks</h3></div>`;
      return;
    }
    list.innerHTML = `
      <div style="background:var(--card-bg,#fff);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;background:rgba(99,102,241,.08);color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em">
          <th style="padding:12px 16px">Name</th>
          <th style="padding:12px 16px">JobDiva Ref</th>
          <th style="padding:12px 16px">Sense AI Note</th>
          <th style="padding:12px 16px">Created</th>
        </tr></thead>
        <tbody>${rows.map((t, idx) => {
          const head = '';
          const text = t.aiNote || t.sentiment || '';
          const pos = /positive/i.test(text);
          const neg = /negative/i.test(text);
          const band = t.overdue ? '#e53935' : pos ? '#16a34a' : '#6366f1';
          return `${head}
          <tr class="task-row" data-job="${esc(t.jobId)}" data-cand="${esc(t.candidateId)}" data-cat="${esc(t.aiCategory)}"
              style="cursor:pointer;border-top:1px solid var(--border);box-shadow:inset 4px 0 0 ${band};${t.overdue ? 'background:rgba(229,57,53,.07);' : ''}">
            <td style="padding:12px 16px;font-weight:600">${t.overdue ? '⚠️ ' : ''}${esc(t.candidateName)}</td>
            <td style="padding:12px 16px">${esc(t.jobRef || t.jobId)}${t.jobTitle ? `<div style="font-size:11px;color:var(--text-muted)">${esc(t.jobTitle)}</div>` : ''}</td>
            <td style="padding:12px 16px">
              <span>${esc(t.aiNote || '')}</span>
              ${t.score != null ? `<span class="chip" style="margin-left:6px">Score ${esc(t.score)}</span>` : ''}
            </td>
            <td style="padding:12px 16px;white-space:nowrap;color:${t.overdue ? '#e53935' : 'var(--text-muted)'}">
              ${when(t.createdAt)}${t.overdue ? '<div style="font-size:11px">120+ min, no recruiter note</div>' : ''}${t.completedAt ? `<div style="font-size:11px">Done ${when(t.completedAt)}</div>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
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
  }

  return { render };
})();
