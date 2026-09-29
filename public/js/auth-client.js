// Client-side auth state. UI gating only — the server enforces all authorization.
const AuthClient = (() => {
  let user = null;

  function toLogin() {
    location.assign('/auth/login?returnTo=' + encodeURIComponent(location.pathname + location.search));
  }

  async function api(method, url, body) {
    try {
      const r = await fetch(url, {
        method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401) { toLogin(); return { success: false, error: 'Session expired' }; }
      const j = await r.json().catch(() => ({}));
      return r.ok ? j : { success: false, error: j.error || `Server error: ${r.status}` };
    } catch (e) {
      return { success: false, error: 'Network error — is the server running?' };
    }
  }

  async function boot() {
    const res = await api('GET', '/api/me');
    if (!res.success) return null;
    user = res.data;

    const initials = (user.name || user.email || '?').split(/[\s@.]+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('userName').textContent = user.name || user.email;

    if (user.role === 'ADMIN' && !NAV_ITEMS.some(n => n.id === 'admin')) {
      NAV_ITEMS.push({ id: 'admin', label: 'Admin', icon: '⚙️', path: '/admin' });
    }

    document.getElementById('logoutBtn').onclick = async () => {
      const r = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      location.assign(j.redirect || '/access-denied.html?reason=signedout');
    };
    return user;
  }

  return { boot, api, onUnauthorized: toLogin, isAdmin: () => !!user && user.role === 'ADMIN', get user() { return user; } };
})();