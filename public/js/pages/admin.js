// Admin view — recruiter management. Server enforces ADMIN on every call.
const AdminPage = (() => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

  async function render(container) {
    container.innerHTML = `
      <div class="page-header fade-in"><div>
        <div class="page-title">⚙️ Admin — Recruiters</div>
        <div class="page-subtitle">Manage who can access TalentOps</div></div></div>
      <div class="detail-card">
        <h3>➕ Add user</h3>
        <div class="form-row">
          <div class="form-group"><label>Email *</label><input id="adEmail" type="email" placeholder="name@company.com"/></div>
          <div class="form-group"><label>Display name</label><input id="adName"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Role</label><select id="adRole"><option>RECRUITER</option><option>ADMIN</option></select></div>
          <div class="form-group"><label>Existing JobDiva recruiter ID (required for recruiters)</label><input id="adJd" inputmode="numeric"/></div>
        </div>
        <button class="btn btn-primary" id="adAdd">Add</button>
      </div>
      <div id="adList"><div class="loading-screen" style="height:100px"><div class="loading-spinner"></div></div></div>`;

    document.getElementById('adAdd').onclick = async () => {
      const res = await AuthClient.api('POST', '/api/admin/recruiters', {
        email: document.getElementById('adEmail').value,
        name: document.getElementById('adName').value,
        role: document.getElementById('adRole').value,
        jobdivaRecruiterId: document.getElementById('adJd').value.trim(),
      });
      if (!res.success) return showToast(res.error, 'error');
      showToast('User added', 'success');
      render(container);
    };
    await loadList(container);
  }

  async function loadList(container) {
    const res = await AuthClient.api('GET', '/api/admin/recruiters');
    const el = document.getElementById('adList');
    if (!res.success) { el.innerHTML = `<div class="empty"><p>${esc(res.error)}</p></div>`; return; }
    const me = AuthClient.user;
    el.innerHTML = `<table class="data-table"><thead><tr>
      <th>User</th><th>Role</th><th>Status</th><th>JobDiva ID</th><th>Last login</th><th></th></tr></thead><tbody>
      ${res.data.map(r => `<tr style="cursor:default">
        <td><strong>${esc(r.name || '—')}</strong><div class="cand-meta">${esc(r.email)}</div></td>
        <td>${esc(r.role)}</td>
        <td><span class="chip ${r.active ? 'chip-filled' : 'chip-closed'}">${r.active ? 'Active' : 'Inactive'}</span></td>
        <td>${esc(r.jobdivaRecruiterId || '—')}</td>
        <td>${r.lastLoginAt ? esc(new Date(r.lastLoginAt).toLocaleString()) : '—'}</td>
        <td>${r.id === me.id ? '<span class="cand-meta">You</span>' :
          `<button class="btn btn-sm btn-secondary" data-toggle="${esc(r.id)}" data-active="${r.active}">${r.active ? 'Deactivate' : 'Reactivate'}</button>`}</td>
      </tr>`).join('')}</tbody></table>`;

    el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const activate = b.dataset.active !== 'true';
      const r = await AuthClient.api('PATCH', `/api/admin/recruiters/${encodeURIComponent(b.dataset.toggle)}`, { active: activate });
      if (!r.success) return showToast(r.error, 'error');
      showToast(activate ? 'Reactivated' : 'Deactivated', 'success');
      loadList(container);
    });
  }

  return { render };
})();