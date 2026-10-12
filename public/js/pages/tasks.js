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

    const result = await ApiService.getTasks();
    const list = container.querySelector('#taskList');
    if (!result.success) {
      list.innerHTML = `<div class="empty"><h3>Could not load tasks</h3><p>${esc(result.error)}</p></div>`;
      return;
    }
    tasks = result.data || [];
    renderList(list);
  }

  function renderList(list) {
    const rows = tasks.filter(t => t.status === activeStatus);
    if (!rows.length) {
      list.innerHTML = `<div class="empty"><h3>No ${activeStatus} automated tasks</h3></div>`;
      return;
    }
    list.innerHTML = rows.map(t => `
      <div class="ai-cand-item fade-in" data-job="${esc(t.jobId)}" data-cand="${esc(t.candidateId)}" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div class="cand-name" style="font-size:14px">${esc(t.title)}</div>
          <span class="chip">${esc(t.priority)}</span>
        </div>
        <div class="cand-meta" style="margin-top:4px">
          Job ${esc(t.jobId)}${t.jobTitle ? ` (${esc(t.jobTitle)})` : ''} · Automated · Created ${when(t.createdAt)}
          ${t.completedAt ? ` · Completed ${when(t.completedAt)}` : ''}
        </div>
        <div style="font-size:12px;margin-top:6px">${esc(t.detail)}</div>
      </div>`).join('');

    list.querySelectorAll('[data-job]').forEach(el => {
      el.onclick = () => window.navigate(`/jobs/${el.dataset.job}`);
    });
  }

  return { render };
})();
