// One-time, idempotent patch for existing frontend files. Run from project root:
//   node scripts/apply-sso-frontend-patch.js
const fs = require('fs');
const edits = [
  { file: 'public/index.html',
    find: '<a href="/logout" class="icon-btn" title="Logout" style="text-decoration:none">↪</a>',
    replace: '<button class="icon-btn" id="logoutBtn" title="Logout">↪</button>' },
  { file: 'public/index.html',
    find: '<script src="/js/app.js"></script>',
    replace: '<script src="/js/auth-client.js"></script>\n<script src="/js/app.js"></script>' },
  { file: 'public/js/services/api.service.js',
    find: 'if (!response.ok) {',
    replace: "if (response.status === 401) { AuthClient.onUnauthorized(); return { success: false, error: 'Session expired' }; }\n      if (!response.ok) {" },
  { file: 'public/js/app.js',
    find: "document.addEventListener('DOMContentLoaded', initApp);",
    replace: "document.addEventListener('DOMContentLoaded', async () => { if (await AuthClient.boot()) initApp(); });" },
  { file: 'public/js/app.js',
    find: "} else if (path === '/tasks') {",
    replace: "} else if (path === '/admin') {\n      if (!AuthClient.isAdmin()) { content.innerHTML = '<div class=\"empty\"><h3>Not authorized</h3></div>'; return; }\n      await loadScript('/js/pages/admin.js');\n      AdminPage.render(content);\n\n    } else if (path === '/tasks') {" },
];
let failed = false;
for (const e of edits) {
  let src = fs.readFileSync(e.file, 'utf8');
  if (src.includes(e.replace)) { console.log(`skip (already applied): ${e.file}`); continue; }
  const n = src.split(e.find).length - 1;
  if (n !== 1) { console.error(`FAILED (${n} matches): ${e.file} :: ${e.find}`); failed = true; continue; }
  fs.writeFileSync(e.file, src.split(e.find).join(e.replace));
  console.log(`patched: ${e.file}`);
}
process.exit(failed ? 1 : 0);