// Admin view for seeded TalentOps users. JobDiva identities come from MongoDB.
const AdminPage = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  let directory = [];

  async function render(container) {
    container.innerHTML = `
      <div class="page-header fade-in"><div>
        <div class="page-title">Admin - Users</div>
        <div class="page-subtitle">Manage seeded sandbox users and TalentOps access</div></div></div>
      <div class="detail-card">
        <h3>Add recruiter from TalentOps directory</h3>
        <div class="form-group"><label for="userSearch">Search seeded users by name, email, or JobDiva USERID</label><input id="userSearch" autocomplete="off"/></div>
        <div id="directoryResults"><p class="cand-meta">Search for an unassigned, active JobDiva user to add as a recruiter.</p></div>
      </div>
      <div class="detail-card"><h3>TalentOps users</h3><div id="userList"><div class="loading-screen" style="height:100px"><div class="loading-spinner"></div></div></div></div>`;

    await loadList(container);
    document.getElementById('userSearch').addEventListener('input', e => renderDirectory(e.target.value));
  }

  function renderDirectory(query) {
    const target = document.getElementById('directoryResults');
    if (!target) return;
    const term = String(query || '').trim().toLowerCase();
    if (!term) {
      target.innerHTML = '<p class="cand-meta">Search for an unassigned, active JobDiva user to add as a recruiter.</p>';
      return;
    }
    const matches = directory.filter(user => user.role === 'UNASSIGNED' && user.jobdivaActive &&
      `${user.name} ${user.email} ${user.jobdivaUserId} ${user.title}`.toLowerCase().includes(term));
    if (!matches.length) { target.innerHTML = '<p class="cand-meta">No active unassigned user matched.</p>'; return; }
    target.innerHTML = `<table class="data-table"><thead><tr><th>User</th><th>JobDiva USERID</th><th>Title</th><th></th></tr></thead><tbody>
      ${matches.map(user => `<tr><td><strong>${esc(user.name || user.email)}</strong><div class="cand-meta">${esc(user.email)}</div></td>
        <td>${esc(user.jobdivaUserId)}</td><td>${esc(user.title || '-')}</td>
        <td><button class="btn btn-sm btn-primary" data-add-recruiter="${esc(user.jobdivaUserId)}">Add recruiter</button></td></tr>`).join('')}</tbody></table>`;
    target.querySelectorAll('[data-add-recruiter]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      const result = await AuthClient.api('POST', '/api/admin/users', { jobdivaUserId: button.dataset.addRecruiter });
      if (!result.success) { showToast(result.error, 'error'); button.disabled = false; return; }
      showToast('Recruiter access added', 'success');
      await loadList(document.getElementById('content'));
      renderDirectory(document.getElementById('userSearch')?.value);
    });
  }

  async function loadList(container) {
    const target = document.getElementById('userList');
    const response = await AuthClient.api('GET', '/api/admin/users');
    if (!target?.isConnected) return;
    if (!response.success) { target.innerHTML = `<div class="empty"><p>${esc(response.error)}</p></div>`; return; }
    directory = response.data;
    const me = AuthClient.user;
    target.innerHTML = `<table class="data-table"><thead><tr><th>User</th><th>JobDiva USERID</th><th>Role</th><th>TalentOps access</th><th>JobDiva status</th><th></th></tr></thead><tbody>
      ${directory.map(user => `<tr style="cursor:default">
        <td><strong>${esc(user.name || user.email)}</strong><div class="cand-meta">${esc(user.email)}${user.title ? ` · ${esc(user.title)}` : ''}</div></td>
        <td>${esc(user.jobdivaUserId)}</td>
        <td>${user.id === me.id ? esc(user.role) : `<select data-role="${esc(user.id)}"><option value="ADMIN" ${user.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option><option value="RECRUITER" ${user.role === 'RECRUITER' ? 'selected' : ''}>RECRUITER</option><option value="UNASSIGNED" ${user.role === 'UNASSIGNED' ? 'selected' : ''}>UNASSIGNED</option></select>`}</td>
        <td><span class="chip ${user.active ? 'chip-filled' : 'chip-closed'}">${user.active ? 'Active' : 'Inactive'}</span></td>
        <td>${user.jobdivaActive ? 'Active' : 'Inactive'}</td>
        <td>${user.id === me.id ? '<span class="cand-meta">You</span>' : `<button class="btn btn-sm btn-secondary" data-access="${esc(user.id)}" data-enabled="${user.active}" ${!user.jobdivaActive ? 'disabled title="JobDiva account is inactive"' : ''}>${user.active ? 'Deactivate' : 'Reactivate'}</button>`}</td>
      </tr>`).join('')}</tbody></table>`;

    target.querySelectorAll('[data-role]').forEach(select => select.addEventListener('change', async () => {
      select.disabled = true;
      const result = await AuthClient.api('PATCH', `/api/admin/users/${encodeURIComponent(select.dataset.role)}`, { role: select.value });
      if (!result.success) { showToast(result.error, 'error'); await loadList(container); return; }
      showToast('Role updated', 'success');
      await loadList(container);
    }));
    target.querySelectorAll('[data-access]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      const active = button.dataset.enabled !== 'true';
      const result = await AuthClient.api('PATCH', `/api/admin/users/${encodeURIComponent(button.dataset.access)}`, { active });
      if (!result.success) { showToast(result.error, 'error'); button.disabled = false; return; }
      showToast(active ? 'TalentOps access activated' : 'TalentOps access deactivated', 'success');
      await loadList(container);
    });
  }

  return { render };
})();
