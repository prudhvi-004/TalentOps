// MongoDB-backed TalentOps identities. JobDiva USERID is the stable external key.
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const ROLES = ['ADMIN', 'RECRUITER', 'UNASSIGNED'];
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const isEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
let client;
let users;
let writeQueue = Promise.resolve();

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

async function connect() {
  if (users) return users;
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) throw new Error('MONGODB_URI and MONGODB_DB are required.');
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  users = client.db(process.env.MONGODB_DB).collection('users');
  await Promise.all([
    users.createIndex({ id: 1 }, { unique: true }),
    users.createIndex({ jobdivaUserId: 1 }, { unique: true }),
    users.createIndex({ email: 1 }, { unique: true }),
    users.createIndex({ oidcSubject: 1 }, { unique: true, sparse: true }),
  ]);
  return users;
}

async function close() {
  if (client) await client.close();
  client = undefined;
  users = undefined;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltText, hashText] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64');
    const actual = await scrypt(password, Buffer.from(saltText, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}

function activeFlag(value) { return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase()); }
function mapJobDivaUser(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const firstName = String(raw.FIRSTNAME || raw.firstName || '').trim();
  const lastName = String(raw.LASTNAME || raw.lastName || '').trim();
  const email = normalizeEmail(raw.EMAIL || raw.email);
  const jobdivaUserId = String(raw.USERID || raw.userId || raw.jobdivaUserId || '').trim();
  if (!jobdivaUserId || !isEmail(email)) return null;
  const customRoles = raw.CUSTOM_ROLES || raw.customRoles || {};
  const recruiterFlag = activeFlag(raw.RECRUITERFLAG ?? raw.recruiterFlag);
  return {
    jobdivaUserId, email, firstName, lastName,
    name: String(raw.name || '').trim() || [firstName, lastName].filter(Boolean).join(' ') || String(raw.NAME || '').trim(),
    title: String(raw.TITLE || raw.title || '').trim(),
    division: String(raw.DIVISION || raw.division || '').trim(),
    divisionId: String(raw.DIVISION_ID || raw.divisionId || '').trim(),
    timezone: String(raw.TIMEZONE || raw.timezone || '').trim(),
    city: String(raw.CITY || raw.city || '').trim(),
    state: String(raw.STATE || raw.state || '').trim(),
    jobdivaCreatedAt: raw.DATECREATED || null,
    jobdivaUpdatedAt: raw.DATE_UPDATED || raw.jobdivaUpdatedAt || null,
    jobdivaActive: activeFlag(raw.ACTIVEFLAG ?? raw.jobdivaActive),
    recruiterFlag,
    salesFlag: activeFlag(raw.SALESFLAG ?? raw.salesFlag),
    recruitingManagerFlag: activeFlag(raw.RECRUITINGMANAGERFLAG ?? raw.recruitingManagerFlag ?? customRoles['Recruitment Manager']),
    teamLeaderFlag: activeFlag(raw.TEAMLEADERFLAG ?? raw.teamLeaderFlag),
    superUserFlag: activeFlag(raw.SUPERUSERFLAG ?? raw.superUserFlag),
    source: 'jobdiva-sandbox',
  };
}

function publicView(user) {
  if (!user) return null;
  const { passwordHash, oidcSubject, _id, ...safe } = user;
  return safe;
}

async function list() { return (await connect()).find({}).sort({ name: 1, email: 1 }).toArray().then(rows => rows.map(publicView)); }
async function findById(id) { return publicView(await (await connect()).findOne({ id: String(id) })); }
async function findByJobDivaUserId(id) { return publicView(await (await connect()).findOne({ jobdivaUserId: String(id) })); }
async function findByEmail(email) { return publicView(await (await connect()).findOne({ email: normalizeEmail(email) })); }
async function findForLogin(identifier, loginType = 'email') {
  const value = String(identifier || '').trim();
  const query = loginType === 'recruiterId'
    ? { jobdivaUserId: value }
    : { email: normalizeEmail(value) };
  return (await connect()).findOne(query);
}
async function touchLogin(id) { await (await connect()).updateOne({ id: String(id) }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } }); }

async function seedUsers(sourceUsers, initialAdminId, passwordHash) {
  const collection = await connect();
  const seenIds = new Set();
  const seenEmails = new Set();
  const valid = [];
  let skippedInvalid = 0;
  for (const raw of sourceUsers) {
    const user = mapJobDivaUser(raw);
    if (!user || !/^\d+$/.test(user.jobdivaUserId) || seenIds.has(user.jobdivaUserId) || seenEmails.has(user.email)) {
      skippedInvalid++;
      continue;
    }
    seenIds.add(user.jobdivaUserId);
    seenEmails.add(user.email);
    valid.push(user);
  }

  if (!valid.some(user => user.jobdivaUserId === String(initialAdminId))) {
    throw new Error(`Configured initial admin USERID ${initialAdminId} is missing or invalid in data/users.seed.json.`);
  }

  const seeded = [];
  for (const user of valid) {
    const isInitialAdmin = user.jobdivaUserId === String(initialAdminId);
    const defaultRole = isInitialAdmin ? 'ADMIN' : (user.recruiterFlag ? 'RECRUITER' : 'UNASSIGNED');
    const now = new Date();
    const set = {
      ...user,
      passwordHash,
      updatedAt: now,
      sync: { syncedAt: now, source: 'data/users.seed.json' },
    };
    if (isInitialAdmin) set.role = 'ADMIN';
    if (!user.jobdivaActive) set.active = false;

    const setOnInsert = {
      id: crypto.randomUUID(),
      createdAt: now,
      lastLoginAt: null,
    };
    if (!isInitialAdmin) setOnInsert.role = defaultRole;
    if (user.jobdivaActive) setOnInsert.active = defaultRole !== 'UNASSIGNED';

    try {
      await collection.updateOne(
        { jobdivaUserId: user.jobdivaUserId },
        { $set: set, $setOnInsert: setOnInsert },
        { upsert: true },
      );
      seeded.push(await collection.findOne({ jobdivaUserId: user.jobdivaUserId }));
    } catch (error) {
      if (error.code === 11000) { skippedInvalid++; continue; }
      throw error;
    }
  }

  return {
    sourceUsers: sourceUsers.length,
    importedUpdated: seeded.length,
    skippedInvalid,
    admins: seeded.filter(user => user.role === 'ADMIN').length,
    recruiters: seeded.filter(user => user.role === 'RECRUITER').length,
    unassigned: seeded.filter(user => user.role === 'UNASSIGNED').length,
    inactive: seeded.filter(user => !user.active).length,
  };
}

async function update(id, patch, actor) {
  let release;
  const previous = writeQueue;
  writeQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    const collection = await connect();
    const user = await collection.findOne({ id: String(id) });
    if (!user) throw httpError(404, 'User not found.');
    const role = patch.role === undefined ? user.role : String(patch.role).toUpperCase();
    if (patch.active !== undefined && typeof patch.active !== 'boolean') throw httpError(400, 'active must be a boolean.');
    let active = patch.active === undefined ? user.active : patch.active;
    if (!ROLES.includes(role)) throw httpError(400, 'Role must be ADMIN, RECRUITER, or UNASSIGNED.');
    if (role === 'UNASSIGNED') active = false;
    if (active && !user.jobdivaActive) throw httpError(400, 'Inactive JobDiva users cannot be activated in TalentOps.');
    const losesAdmin = user.role === 'ADMIN' && user.active && (!active || role !== 'ADMIN');
    if (losesAdmin) {
      if (actor && actor.id === user.id) throw httpError(400, 'You cannot deactivate or demote yourself.');
      if (await collection.countDocuments({ role: 'ADMIN', active: true, id: { $ne: user.id } }) === 0) throw httpError(400, 'At least one active admin is required.');
    }
    await collection.updateOne({ id: user.id }, { $set: { role, active, updatedAt: new Date() } });
    return publicView(await collection.findOne({ id: user.id }));
  } finally { release(); }
}

async function resolveLogin(claims) {
  const raw = claims.email || claims.preferred_username || claims.upn;
  const email = normalizeEmail(raw);
  if (claims.email_verified === false) return { ok: false, reason: 'unverified' };
  const collection = await connect();
  const user = (claims.sub && await collection.findOne({ oidcSubject: claims.sub })) || await collection.findOne({ email });
  if (!user) return { ok: false, reason: 'not_provisioned' };
  if (user.oidcSubject && user.oidcSubject !== claims.sub) return { ok: false, reason: 'identity' };
  if (!user.active || !user.jobdivaActive) return { ok: false, reason: 'inactive' };
  await collection.updateOne({ id: user.id }, { $set: {
    oidcSubject: claims.sub || user.oidcSubject,
    name: user.name || claims.name || '',
    lastLoginAt: new Date(), updatedAt: new Date(),
  } });
  return { ok: true, record: publicView(await collection.findOne({ id: user.id })) };
}

module.exports = { connect, close, hashPassword, verifyPassword, mapJobDivaUser, list, findById, findByJobDivaUserId, findByEmail, findForLogin, touchLogin, seedUsers, update, resolveLogin };
