/* =============================================================
   APP.JS — CORE APPLICATION ROUTER & STATE
   =============================================================
   Purpose:
     The main brain of the frontend.
     Handles: routing, navigation, theme, sidebar, toasts,
              notifications, and global state.

   How routing works:
     User clicks nav item → navigate(path) is called
     → currentPath updates → renderPage() is called
     → correct page script renders into #content

   Adding a new page:
     1. Create public/js/pages/mypage.js
     2. Add a case in renderPage() switch below
     3. Add a nav item in NAV_ITEMS array below
     4. Load the script in renderPage() dynamically
   ============================================================= */

/* -----------------------------------------------------------
   GLOBAL STATE
   Single source of truth for the current app state.
----------------------------------------------------------- */
const AppState = {
  currentPath: '/',
  sidebarCollapsed: false,
  theme: localStorage.getItem('talentops_theme') || 'light',

  // Notifications queue (populated by note writeback failures etc.)
  notifications: [],
  unreadCount: 0,
};

/* -----------------------------------------------------------
   NAVIGATION ITEMS
   Controls what appears in the sidebar.
   icon: emoji shown in sidebar
   path: URL path this item navigates to
   label: text shown when sidebar is expanded
   badge: optional count shown next to label
----------------------------------------------------------- */
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard',        icon: '📊', path: '/' },
  { id: 'jobs',      label: 'Jobs',             icon: '💼', path: '/jobs' },
  { id: 'candidates',label: 'Candidates',       icon: '👥', path: '/candidates' },
  { id: 'tasks',     label: 'Tasks',            icon: '✅', path: '/tasks' },
  { id: 'team',      label: 'Team Assignment',  icon: '👫', path: '/team' },
  { id: 'clients',   label: 'Client Assignment',icon: '🏢', path: '/clients' },
  { id: 'admin', label: 'Admin', icon: '⚙️', path: '/admin', roles: ['ADMIN'] },
];

/* -----------------------------------------------------------
   DYNAMIC SCRIPT LOADER
   Loads a JS file once and executes it.
   Prevents loading the same script twice.
----------------------------------------------------------- */
const loadedScripts = new Set();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (loadedScripts.has(src)) {
      resolve(); return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => { loadedScripts.add(src); resolve(); };
    script.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(script);
  });
}

/* -----------------------------------------------------------
   ROUTER — renderPage()
   Reads the current path and renders the correct page.
   Each page script must export a render(container) function
   OR define a global Page object with a render method.
----------------------------------------------------------- */
async function renderPage() {
  const content = document.getElementById('content');
  const path = AppState.currentPath;

  // Show loading spinner while page loads
  content.innerHTML = `
    <div class="loading-screen">
      <div class="loading-spinner"></div>
      <p>Loading...</p>
    </div>`;

  try {
    // Match the path to the correct page script
    if (path === '/') {
      await loadScript('/js/pages/dashboard.js');
      DashboardPage.render(content);

    } else if (path === '/jobs') {
      await loadScript('/js/pages/jobs.js');
      JobsPage.render(content);

     } else if (path.startsWith('/jobs/')) {
      const jobId = path.split('/jobs/')[1];
      await loadScript('/js/pages/job-detail.js');
      await loadScript('/js/components/note-writeback.js');
      // Check if coming from Candidates page with a pre-selected candidate
      // sessionStorage set by candidates.js when tile is clicked
      const openCandId     = sessionStorage.getItem('openCandId');
      const openCandSource = sessionStorage.getItem('openCandSource');
      const openCandAICat  = sessionStorage.getItem('openCandAICat');
      sessionStorage.removeItem('openCandId');
      sessionStorage.removeItem('openCandSource');
      sessionStorage.removeItem('openCandAICat');
      JobDetailPage.render(content, jobId, {
        openCandId, openCandSource, openCandAICat
      });

    } else if (path.startsWith('/candidates/')) {
      // /candidates/C001?source=pipeline&jobId=J001
      const candidateId = path.split('/candidates/')[1];
      const params = new URLSearchParams(window.location.search);
      const source = params.get('source') || 'pipeline';
      const jobId  = params.get('jobId') || null;
      await loadScript('/js/pages/candidate-profile.js?v=20260908-notes-render-fix');
      await loadScript('/js/components/note-writeback.js');
      CandidateProfilePage.render(content, candidateId, source, jobId);

    } else if (path === '/candidates') {
      await loadScript('/js/pages/candidate.js');
      CandidatesPage.render(content);

    } else if (path === '/submittals') {
      await loadScript('/js/pages/submittals.js');
      SubmittalsPage.render(content);

    } else if (path === '/interviews') {
      await loadScript('/js/components/record-detail-shared.js');
      await loadScript('/js/pages/interviews.js');
      InterviewsPage.render(content);

    } else if (path === '/starts') {
      await loadScript('/js/components/record-detail-shared.js');
      await loadScript('/js/pages/starts.js');
      StartsPage.render(content);

    } else if (path === '/first-presentations') {
      await loadScript('/js/components/record-detail-shared.js');
      await loadScript('/js/pages/first-presentations.js');
      FirstPresentationsPage.render(content);

    } else if (path === '/my-primary-jobs') {
      await loadScript('/js/components/record-detail-shared.js');
      await loadScript('/js/pages/my-primary-jobs.js');
      MyPrimaryJobsPage.render(content);

    } else if (path === '/admin') {
      if (!AuthClient.isAdmin()) {
        content.innerHTML = '<div class="empty"><h3>Not authorized</h3><p>You do not have permission to view this page.</p></div>';
        return;
      }
      await loadScript('/js/pages/admin.js');
      await AdminPage.render(content);

    } else if (path === '/tasks') {
      // Tasks — dummy data for demo
      renderDummyPage(content, 'Tasks', '✅',
        'Task management will connect to your workflow system in production.');

    } else if (path === '/team') {
      renderDummyPage(content, 'Team Assignment', '👫',
        'Team structure and recruiter assignments displayed here.');

    } else if (path === '/clients') {
      renderDummyPage(content, 'Client Assignment', '🏢',
        'Client portfolio and engagement tracking displayed here.');

    } else {
      content.innerHTML = `<div class="empty"><h3>Page not found</h3></div>`;
    }

  } catch (err) {
    console.error('Page render error:', err);
    content.innerHTML = `
      <div class="empty">
        <h3>Something went wrong</h3>
        <p>${err.message}</p>
      </div>`;
  }
}

/* -----------------------------------------------------------
   DUMMY PAGE RENDERER
   For pages with static content in demo mode.
   Replaced with real page scripts in production.
----------------------------------------------------------- */
function renderDummyPage(container, title, icon, note) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${icon} ${title}</div>
        <div class="page-subtitle">Demo — static view</div>
      </div>
    </div>
    <div class="detail-card">
      <h3>${icon} ${title}</h3>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">${note}</p>
      <div style="background:var(--surface-2);border-radius:8px;padding:20px;text-align:center;color:var(--text-muted)">
        <div style="font-size:40px;margin-bottom:8px">${icon}</div>
        <div style="font-weight:600">Static Demo View</div>
        <div style="font-size:12px;margin-top:4px">
          This module will connect to live data in production.
        </div>
      </div>
    </div>`;
}

/* -----------------------------------------------------------
   NAVIGATION — navigate(path)
   Call this to go to a different page.
   Updates the browser URL and re-renders the page.

   Usage:
     navigate('/jobs')
     navigate('/jobs/J001')
     navigate('/candidates/C001?source=ai&jobId=J001')
----------------------------------------------------------- */
function navigate(path) {
  AppState.currentPath = path.split('?')[0];
  // Push to browser history so back button works
  window.history.pushState({}, '', path);
  renderNav();
  renderPage();
}

/* -----------------------------------------------------------
   SIDEBAR — renderNav()
   Draws the navigation items into #navList.
   Highlights the active page.
----------------------------------------------------------- */
function renderNav() {
  const nav = document.getElementById('navList');
  if (!nav) return;

  nav.innerHTML = NAV_ITEMS.filter(item => !item.roles || item.roles.includes(AuthClient.user?.role)).map(item => {
    const isActive = AppState.currentPath === item.path ||
      (item.path !== '/' && AppState.currentPath.startsWith(item.path));
    return `
      <div class="nav-item ${isActive ? 'active' : ''}" data-path="${item.path}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </div>`;
  }).join('');

  // Attach click handlers
  nav.querySelectorAll('.nav-item').forEach(el => {
    el.onclick = () => navigate(el.dataset.path);
  });
}

/* -----------------------------------------------------------
   TOAST NOTIFICATIONS
   Show a brief message at the bottom right of the screen.

   Usage:
     showToast('Note saved!')
     showToast('Error saving note', 'error')
     showToast('Success!', 'success')
----------------------------------------------------------- */
function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show';
  if (type === 'error')   toast.classList.add('error-toast');
  if (type === 'success') toast.classList.add('success-toast');
  setTimeout(() => { toast.className = 'toast'; }, 2800);
}
// Make globally available
window.showToast = showToast;
window.navigate  = navigate;

/* -----------------------------------------------------------
   MODAL HELPERS
   Open and close the global modal dialog.

   Usage:
     openModal('Title', '<p>Body HTML</p>', '<button>OK</button>')
     closeModal()
----------------------------------------------------------- */
function openModal(title, bodyHTML, footerHTML = '') {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modalFooter').innerHTML = footerHTML;
  document.getElementById('modalOverlay').classList.add('active');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}
window.openModal  = openModal;
window.closeModal = closeModal;

/* -----------------------------------------------------------
   NOTIFICATIONS SYSTEM
   Adds a notification to the bell icon panel.
   Used by note writeback failure and other system events.

   Usage:
     addNotification('Note failed', 'Note for Emma Wilson failed', 'error')
----------------------------------------------------------- */
function addNotification(title, desc, type = 'info') {
  AppState.notifications.unshift({
    id: Date.now(),
    title, desc, type,
    time: new Date().toLocaleTimeString(),
    read: false,
  });
  AppState.unreadCount++;
  renderNotifications();
}
window.addNotification = addNotification;

function renderNotifications() {
  const badge = document.getElementById('notifBadge');
  const body  = document.getElementById('notifBody');

  // Update badge count
  if (AppState.unreadCount > 0) {
    badge.textContent = AppState.unreadCount;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  // Render notification items
  if (AppState.notifications.length === 0) {
    body.innerHTML = '<p class="notif-empty">No notifications</p>';
    return;
  }

  body.innerHTML = AppState.notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'} ${n.type === 'error' ? 'error' : ''}">
      <div class="notif-title">
        ${n.type === 'error' ? '❌' : n.type === 'success' ? '✅' : 'ℹ️'} ${n.title}
      </div>
      <div class="notif-desc">${n.desc}</div>
      <div class="notif-time">${n.time}</div>
    </div>`).join('');
}

/* -----------------------------------------------------------
   THEME TOGGLE
   Switches between light and dark mode.
   Saves preference to localStorage.
----------------------------------------------------------- */
function initTheme() {
  document.documentElement.dataset.theme = AppState.theme;
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = AppState.theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  AppState.theme = AppState.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('talentops_theme', AppState.theme);
  initTheme();
}

/* -----------------------------------------------------------
   SIDEBAR TOGGLE
   Collapses / expands the sidebar.
----------------------------------------------------------- */
function toggleSidebar() {
  AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
  document.getElementById('mainArea')
    .classList.toggle('collapsed', AppState.sidebarCollapsed);
  const overlay = document.getElementById('sidebarOverlay');
  overlay.classList.toggle('active', !AppState.sidebarCollapsed);
}

/* -----------------------------------------------------------
   BROWSER BACK / FORWARD BUTTON SUPPORT
----------------------------------------------------------- */
window.addEventListener('popstate', () => {
  AppState.currentPath = window.location.pathname;
  renderNav();
  renderPage();
});

/* -----------------------------------------------------------
   GLOBAL SEARCH
   Searches jobs and candidates from the persistent top-bar
   search box. Results are returned by the server so ATS
   credentials never reach the browser.
----------------------------------------------------------- */
let globalSearchTimer = null;
let globalSearchRequest = 0;

function ensureGlobalSearchResults() {
  const box = document.querySelector('.search-box');
  const input = document.getElementById('searchInput');
  if (!box || !input) return null;

  let panel = document.getElementById('globalSearchResults');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'globalSearchResults';
    panel.className = 'global-search-results';
    box.appendChild(panel);
  }
  return panel;
}

function renderGlobalSearchResults(data, query) {
  const panel = ensureGlobalSearchResults();
  if (!panel) return;

  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  if (!jobs.length && !candidates.length) {
    panel.innerHTML = `<div class="global-search-empty">No results for “${escapeGlobalSearch(query)}”</div>`;
    panel.classList.add('open');
    return;
  }

  const jobItems = jobs.map(job => `
    <button class="global-search-result" data-search-type="job" data-search-id="${escapeGlobalSearch(job.id)}">
      <span class="global-search-result-icon">💼</span>
      <span class="global-search-result-text">
        <strong>${escapeGlobalSearch(job.title || 'Untitled Job')}</strong>
        <small>${escapeGlobalSearch(job.client || '—')} · Job ${escapeGlobalSearch(job.atsId || job.id || '—')}</small>
      </span>
    </button>`).join('');

  const candidateItems = candidates.map(candidate => `
    <button class="global-search-result" data-search-type="candidate" data-search-id="${escapeGlobalSearch(candidate.id)}">
      <span class="global-search-result-icon">👤</span>
      <span class="global-search-result-text">
        <strong>${escapeGlobalSearch(candidate.name || 'Unnamed Candidate')}</strong>
        <small>${escapeGlobalSearch(candidate.title || candidate.company || candidate.location || 'Candidate')}</small>
      </span>
    </button>`).join('');

  panel.innerHTML = `
    ${jobs.length ? `<div class="global-search-heading">Jobs</div>${jobItems}` : ''}
    ${candidates.length ? `<div class="global-search-heading">Candidates</div>${candidateItems}` : ''}`;
  panel.classList.add('open');

  panel.querySelectorAll('.global-search-result').forEach(button => {
    button.onclick = () => {
      const type = button.dataset.searchType;
      const id = button.dataset.searchId;
      panel.classList.remove('open');
      const input = document.getElementById('searchInput');
      if (input) input.value = '';
      navigate(type === 'job' ? `/jobs/${id}` : `/candidates/${id}?source=global`);
    };
  });
}

function escapeGlobalSearch(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initGlobalSearch() {
  const input = document.getElementById('searchInput');
  if (!input || input.dataset.bound === '1') return;
  input.dataset.bound = '1';
  ensureGlobalSearchResults();

  input.addEventListener('input', () => {
    const query = input.value.trim();
    const panel = ensureGlobalSearchResults();
    clearTimeout(globalSearchTimer);

    if (query.length < 2) {
      panel?.classList.remove('open');
      return;
    }

    panel?.classList.add('open');
    if (panel) panel.innerHTML = '<div class="global-search-empty">Searching…</div>';

    const requestId = ++globalSearchRequest;
    globalSearchTimer = setTimeout(async () => {
      const result = await ApiService.search(query);
      if (requestId !== globalSearchRequest) return;
      if (!result.success) {
        if (panel) panel.innerHTML = `<div class="global-search-empty">Search failed: ${escapeGlobalSearch(result.error)}</div>`;
        return;
      }
      renderGlobalSearchResults(result.data, query);
    }, 250);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = document.querySelector('#globalSearchResults .global-search-result');
      if (first) { e.preventDefault(); first.click(); }
    }
  });

  document.addEventListener('click', e => {
    const box = document.querySelector('.search-box');
    if (box && !box.contains(e.target)) {
      document.getElementById('globalSearchResults')?.classList.remove('open');
    }
  });
}

/* -----------------------------------------------------------
   KEYBOARD SHORTCUTS
   Ctrl+K → focus search
   Escape → close modal / notification panel
----------------------------------------------------------- */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchInput')?.focus();
  }
  if (e.key === 'Escape') {
    closeModal();
    document.getElementById('notifPanel')?.classList.remove('open');
  }
});

/* -----------------------------------------------------------
   INITIALISE THE APP
   Runs once when the page first loads.
----------------------------------------------------------- */
async function initApp() {
  // Set theme
  initTheme();

  // Wire up the persistent global search box
  initGlobalSearch();

  // Read initial path from browser URL
  AppState.currentPath = window.location.pathname;

  // Wire up sidebar toggle
  document.getElementById('sidebarToggle')
    ?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay')
    ?.addEventListener('click', toggleSidebar);

  // Wire up theme toggle
  document.getElementById('themeToggle')
    ?.addEventListener('click', toggleTheme);

  // Wire up modal close
  document.getElementById('modalClose')
    ?.addEventListener('click', closeModal);
  document.getElementById('modalOverlay')
    ?.addEventListener('click', e => {
      if (e.target.id === 'modalOverlay') closeModal();
    });

  // Wire up notification panel
  document.getElementById('notifBtn')
    ?.addEventListener('click', () => {
      document.getElementById('notifPanel').classList.toggle('open');
      // Mark all as read when panel opened
      AppState.notifications.forEach(n => n.read = true);
      AppState.unreadCount = 0;
      renderNotifications();
    });
  document.getElementById('closeNotif')
    ?.addEventListener('click', () => {
      document.getElementById('notifPanel').classList.remove('open');
    });

  const user = await AuthClient.boot();
  if (!user) return;

  // Render navigation sidebar
  renderNav();

  // Render the current page
  await renderPage();
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
