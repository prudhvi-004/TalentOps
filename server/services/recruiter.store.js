// Recruiter authorization store — JSON file (same approach as data/*.json).
// Single-process only. Swap for a DB later without changing the exported API.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '../../data/recruiters.json');
const ROLES = ['ADMIN', 'RECRUITER'];
let cache = null;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { cache = []; }
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

const normEmail = v => String(v || '').trim().toLowerCase();
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const publicView = r => ({
  id: r.id, email: r.email, name: r.name, role: r.role, active: r.active,
  jobdivaRecruiterId: r.jobdivaRecruiterId || '', lastLoginAt: r.lastLoginAt || null,
  createdAt: r.createdAt,
});

function list() { return load().map(publicView); }
function findById(id) { return load().find(r => r.id === id) || null; }

function activeAdminCount(exceptId) {
  return load().filter(r => r.active && r.role === 'ADMIN' && r.id !== exceptId).length;
}

function add({ email, name, role, jobdivaRecruiterId }) {
  email = normEmail(email);
  role = String(role || 'RECRUITER').toUpperCase();
  if (!isEmail(email)) throw httpError(400, 'A valid email is required.');
  if (!ROLES.includes(role)) throw httpError(400, 'Role must be ADMIN or RECRUITER.');
  if (jobdivaRecruiterId && !/^\d+$/.test(String(jobdivaRecruiterId))) {
    throw httpError(400, 'JobDiva recruiter ID must be numeric.');
  }
  if (load().some(r => r.email === email)) {
    throw httpError(409, 'User already exists. Reactivate the existing record instead.');
  }
  const now = new Date().toISOString();
  const rec = {
    id: crypto.randomUUID(), email, name: String(name || '').trim(), role, active: true,
    jobdivaRecruiterId: jobdivaRecruiterId ? String(jobdivaRecruiterId) : '',
    sub: '', createdAt: now, updatedAt: now,
  };
  load().push(rec);
  save();
  return publicView(rec);
}

function update(id, patch, actor) {
  const rec = findById(id);
  if (!rec) throw httpError(404, 'Recruiter not found.');
  const next = {
    active: patch.active === undefined ? rec.active : Boolean(patch.active),
    role: patch.role === undefined ? rec.role : String(patch.role).toUpperCase(),
  };
  if (!ROLES.includes(next.role)) throw httpError(400, 'Role must be ADMIN or RECRUITER.');
  if (patch.jobdivaRecruiterId !== undefined && patch.jobdivaRecruiterId !== '' &&
      !/^\d+$/.test(String(patch.jobdivaRecruiterId))) {
    throw httpError(400, 'JobDiva recruiter ID must be numeric.');
  }
  const losesAdmin = rec.role === 'ADMIN' && rec.active && (!next.active || next.role !== 'ADMIN');
  if (losesAdmin) {
    if (actor && actor.id === id) throw httpError(400, 'You cannot deactivate or demote yourself.');
    if (activeAdminCount(id) === 0) throw httpError(400, 'At least one active admin is required.');
  }
  rec.active = next.active;
  rec.role = next.role;
  if (patch.name !== undefined) rec.name = String(patch.name).trim();
  if (patch.jobdivaRecruiterId !== undefined) rec.jobdivaRecruiterId = String(patch.jobdivaRecruiterId || '');
  rec.updatedAt = new Date().toISOString();
  save();
  return publicView(rec);
}

// Called from the OIDC callback with verified ID-token claims.
function resolveLogin(claims) {
  const raw = claims.email || claims.preferred_username || claims.upn;
  const email = isEmail(normEmail(raw)) ? normEmail(raw) : '';
  if (claims.email_verified === false) return { ok: false, reason: 'unverified' };

  const rec = load().find(r => r.sub && r.sub === claims.sub) ||
              (email && load().find(r => r.email === email));
  if (!rec) return { ok: false, reason: 'not_provisioned' };
  if (rec.sub && rec.sub !== claims.sub) return { ok: false, reason: 'identity' };
  if (!rec.active) return { ok: false, reason: 'inactive' };

  rec.sub = rec.sub || claims.sub;
  if (!rec.name) rec.name = claims.name || '';
  rec.lastLoginAt = new Date().toISOString();
  save();
  return { ok: true, record: rec };
}

// Bootstrap: INITIAL_ADMIN_EMAILS (comma-separated) are created as ADMIN if absent.
(function seedAdmins() {
  const emails = (process.env.INITIAL_ADMIN_EMAILS || '').split(',').map(normEmail).filter(isEmail);
  let added = 0;
  for (const email of emails) {
    if (!load().some(r => r.email === email)) { add({ email, role: 'ADMIN' }); added++; }
  }
  if (added) console.log(`[auth] Seeded ${added} initial admin(s).`);
})();

module.exports = { list, add, update, findById, resolveLogin };