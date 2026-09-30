// Client-side auth state. UI gating only; the server enforces all authorization.
const AuthClient = (() => {
  let user = null;

  async function toLogin() {
    let loginPath = '/auth/login';
    try {
      const response = await fetch('/api/auth/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const config = await response.json();
      if (config.developmentMockAuth) loginPath = '/auth/dev';
    } catch (_) { /* Keep the production login route if config is unavailable. */ }
    const returnTo = encodeURIComponent(location.pathname + location.search);
    location.assign(loginPath === '/auth/dev' ? loginPath : `${loginPath}?returnTo=${returnTo}`);
  }

  async function api(method, url, body) {
    try {
      const r = await fetch(url, {
        method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401) { await toLogin(); return { success: false, error: 'Session expired' }; }
      const j = await r.json().catch(() => ({}));
      return r.ok ? j : { success: false, error: j.error || `Server error: ${r.status}` };
    } catch (_) {
      return { success: false, error: 'Network error - is the server running?' };
    }
  }

  async function boot() {
    const res = await api('GET', '/api/me');
    if (!res.success) return null;
    user = res.data;
    const initials = (user.name || user.email || '?').split(/[\s@.]+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('userName').textContent = user.name || user.email;
    document.getElementById('userRole').textContent = user.role;
    document.getElementById('userChip').style.visibility = 'visible';
    return user;
  }

  async function logout() {
    user = null;
    const chip = document.getElementById('userChip');
    if (chip) chip.style.visibility = 'hidden';
    try {
      const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const result = await response.json().catch(() => ({}));
      location.assign(result.redirect || '/access-denied.html?reason=signedout');
    } catch (_) { location.assign('/access-denied.html?reason=signedout'); }
  }

  document.addEventListener('DOMContentLoaded', () => document.getElementById('logoutBtn')?.addEventListener('click', logout));
  return { boot, api, logout, onUnauthorized: toLogin, isAdmin: () => !!user && user.role === 'ADMIN', get user() { return user; } };
})();
