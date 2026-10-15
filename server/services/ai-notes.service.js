// =============================================================
// AI NOTES SERVICE — ai-notes.service.js
// =============================================================
// Implements the "Sense AI candidate display" and "Sense AI note
// audit + task bar" workflows.
//
// Source: GET /apiv2/bi/JobNotesListDetail?jobId=...
//
// Display:
//   Only notes dropped by the AI messaging user AND of one of the
//   4 known TYPENAMEs are used.
//     Sense AI Auto sourcing Evaluation: Positive|Negative -> Engaged Candidate
//     Sense AI Applicant Review:         Positive|Negative -> Engaged Applicant
//   Positive = green band, Negative = red band. A candidate with AI
//   notes in BOTH sections gets an orange band; the most recent
//   note decides which section they are listed in.
//
// Task bar: a task is created as soon as the AI note is seen; once
// 120 min pass without a REC_AI note it is flagged overdue (highlighted).
// Audit (120 min):
//   Clock starts at the latest AI note's DATECREATED. Any note with
//   TYPENAME = REC_AI on the same candidate + job created after it
//   (no recruiter filter) marks the candidate as responded. If none
//   exists 120 min after the AI note, ONE automated task is created
//   for the job's recruiter. The task auto-completes once a REC_AI
//   note is found. A newer AI note resets the clock (new task key).
//
// State is persisted to data/runtime/ai-audit.json so tasks and the
// responded indicator survive restarts. Refreshed hourly by
// startHourlyPoll() and on demand when a job page is opened.
// =============================================================

const fs = require('fs');
const path = require('path');
const atsService = require('./ats.service');

const AI_USER_ID = String(process.env.AI_NOTE_USER_ID || '1453881');
const AI_USER_NAME = String(process.env.AI_NOTE_USER_NAME || 'Sense Messaging').toLowerCase();
// Recruiter response note type in JobDiva ("Rec - Sense AI"); dash/space tolerant.
// The job-notes feed returns a blank TYPENAME for recruiter notes, so a blank
// type from a non-AI user also counts as the recruiter's response.
const isHumanType = t => /^rec\s*[-–—]\s*sense\s*ai$/i.test(String(t || '').trim());
const AUDIT_WINDOW_MS = 120 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 60 * 1000;
const FRESH_MS = 15 * 1000; // on-demand refresh throttle (real-time: only dedupes bursts)
// DATECREATED has no zone; JobDiva returns account-local time.
const NOTE_TZ = process.env.JOBDIVA_NOTE_TIMEZONE || 'America/New_York';

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'runtime', 'ai-audit.json');

const KNOWN_TYPES = [
  { re: /^sense ai auto sourcing evaluation:\s*positive$/i, section: 'Candidate', sentiment: 'positive' },
  { re: /^sense ai auto sourcing evaluation:\s*negative$/i, section: 'Candidate', sentiment: 'negative' },
  { re: /^sense ai applicant evaluation:\s*positive$/i,     section: 'Applicant', sentiment: 'positive' },
  { re: /^sense ai applicant evaluation:\s*negative$/i,     section: 'Applicant', sentiment: 'negative' },
  { re: /^sense ai applicant review:\s*positive$/i,         section: 'Applicant', sentiment: 'positive' },
  { re: /^sense ai applicant review:\s*negative$/i,         section: 'Applicant', sentiment: 'negative' },
];

// state.jobs[jobId] = { jobId, jobTitle, assigneeId, assigneeName, syncedAt, items }
// state.tasks[taskId] = task
let state = { jobs: {}, tasks: {} };
const inflight = new Map();

function load() {
  try { state = { jobs: {}, tasks: {}, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; }
  catch (_) { /* first run */ }
}
function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) { console.warn('[ai-notes] Could not persist state:', e.message); }
}
load();

// ---- time ------------------------------------------------------
function zoneOffsetMs(utcMs) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: NOTE_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
// "2026-10-08T12:31:57" (zone-less, account local) -> epoch ms
function parseNoteDate(value) {
  if (!value) return NaN;
  const s = String(value);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return Date.parse(s);
  const naive = Date.parse(s + 'Z');
  if (Number.isNaN(naive)) return NaN;
  return naive - zoneOffsetMs(naive);
}

// ---- classification -------------------------------------------
function isAiUser(note) {
  return String(note.RECRUITERID) === AI_USER_ID ||
    String(note.RECRUITERNAME || '').toLowerCase() === AI_USER_NAME;
}
function classify(note) {
  if (!isAiUser(note)) return null;
  const type = String(note.TYPENAME || '').trim();
  const hit = KNOWN_TYPES.find(t => t.re.test(type));
  if (!hit) return null;
  return { section: hit.section, sentiment: hit.sentiment, typeName: type };
}
function scoreOf(text) {
  const m = /(?:Score on evaluation|AI Conviction score):\s*(\d+)/i.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

// ---- build items from notes -----------------------------------
function buildItems(notes) {
  const rows = (notes || []).map(n => ({ n, t: parseNoteDate(n.DATECREATED) }))
    .filter(r => !Number.isNaN(r.t));

  const humanByCand = new Map();
  const aiByCand = new Map();
  for (const { n, t } of rows) {
    const cid = String(n.CANDIDATEID || '');
    if (!cid || cid === '0') continue;
    if (!isAiUser(n) && (isHumanType(n.TYPENAME) || !String(n.TYPENAME || '').trim())) {
      if (!humanByCand.has(cid)) humanByCand.set(cid, []);
      humanByCand.get(cid).push({ t, by: n.RECRUITERNAME });
      continue;
    }
    const c = classify(n);
    if (!c) continue;
    if (!aiByCand.has(cid)) aiByCand.set(cid, []);
    aiByCand.get(cid).push({ ...c, t, noteId: String(n.NOTEID), note: n });
  }

  const items = [];
  for (const [cid, list] of aiByCand) {
    list.sort((a, b) => b.t - a.t);
    const latest = list[0]; // most recent note decides the section
    const flagged = new Set(list.map(x => x.section)).size > 1;
    // First human response after the latest AI note (rule 5: first one counts)
    const human = (humanByCand.get(cid) || [])
      .filter(h => h.t > latest.t).sort((a, b) => a.t - b.t)[0];
    const n = latest.note;
    items.push({
      id: cid,
      jobId: String(n.JOBID),
      name: `${n.CANFNAME || ''} ${n.CANLNAME || ''}`.trim() || `Candidate ${cid}`,
      aiCategory: latest.section,
      sentiment: latest.sentiment,
      band: flagged ? 'orange' : (latest.sentiment === 'positive' ? 'green' : 'red'),
      flagged,
      aiStageLabel: latest.typeName,
      score: scoreOf(n.NOTE),
      aiNoteId: latest.noteId,
      aiNoteAt: new Date(latest.t).toISOString(),
      responded: !!human,
      respondedAt: human ? new Date(human.t).toISOString() : null,
      respondedBy: human ? human.by || '' : '',
      type: 'ai',
    });
  }
  items.sort((a, b) => Date.parse(b.aiNoteAt) - Date.parse(a.aiNoteAt));
  return items;
}

// ---- tasks -----------------------------------------------------
// One task per candidate per job per AI note; a newer AI note resets the clock.
function taskIdFor(item) { return `ai-${item.jobId}-${item.id}-${item.aiNoteId}`; }

function reconcileTasks(job, items, now) {
  const stamp = new Date(now).toISOString();
  for (const item of items) {
    const id = taskIdFor(item);
    const existing = state.tasks[id];
    if (item.responded) {
      if (existing && existing.status !== 'completed') {
        existing.status = 'completed';
        existing.completedAt = stamp;
        continue;
      }
      if (existing) continue;
      // Already answered before we saw it: record it as a completed task.
    }
    if (existing) {
      if (!existing.assigneeId && job.assigneeId) {
        existing.assigneeId = job.assigneeId;
        existing.assigneeName = job.assigneeName || '';
      }
      existing.aiNote = item.aiStageLabel;
      if (!existing.jobTitle && job.jobTitle) existing.jobTitle = job.jobTitle;
      continue;
    }
    state.tasks[id] = {
      id,
      type: 'Automated',
      status: item.responded ? 'completed' : 'pending',
      jobId: item.jobId,
      jobTitle: job.jobTitle || '',
      candidateId: item.id,
      candidateName: item.name,
      assigneeId: job.assigneeId || '',
      assigneeName: job.assigneeName || '',
      priority: item.sentiment === 'positive' ? 'High' : 'Normal',
      title: `Review AI Evaluated Candidate — ${item.name}`,
      detail: `AI evaluated this candidate at ${item.aiNoteAt}. Please review and drop a 'Rec - Sense AI' note within 120 minutes.`,
      aiNote: item.aiStageLabel,
      aiNoteAt: item.aiNoteAt,
      dueAt: new Date(Date.parse(item.aiNoteAt) + AUDIT_WINDOW_MS).toISOString(),
      createdAt: stamp,
      completedAt: item.responded ? item.respondedAt : null,
    };
  }
}

// ---- sync ------------------------------------------------------
async function syncJob(jobId, jobInfo = {}, batch = false) {
  jobId = String(jobId);
  if (inflight.has(jobId)) return inflight.get(jobId);
  const p = (async () => {
    const prev = state.jobs[jobId] || {};
    // jobInfo may be an object or a loader fn; only load when owner unknown.
    let info = typeof jobInfo === 'function' ? {} : jobInfo;
    if (typeof jobInfo === 'function' && !prev.assigneeId) {
      info = await Promise.resolve(jobInfo()).catch(() => ({}));
    }
    // Self-heal: jobs synced without owner/users info get them from one batched lookup.
    if (!info.users && !(prev.users && prev.users.length)) {
      info = { ...info, ...((await atsService.getJobsMeta([jobId]).catch(() => ({})))[jobId] || {}) };
    }
    const job = {
      jobId,
      jobTitle: info.jobTitle || prev.jobTitle || '',
      jobRef: info.jobRef || prev.jobRef || '',
      users: (info.users && info.users.length) ? info.users : (prev.users || []),
      assigneeId: String(info.assigneeId || prev.assigneeId || ''),
      assigneeName: info.assigneeName || prev.assigneeName || '',
    };
    const notes = await atsService.getJobNotes(jobId);
    const items = buildItems(notes);
    reconcileTasks(job, items, Date.now());
    state.jobs[jobId] = { ...job, syncedAt: Date.now(), items };
    if (!batch) save();
    return state.jobs[jobId];
  })().finally(() => inflight.delete(jobId));
  inflight.set(jobId, p);
  return p;
}

// Cached result is returned instantly; a stale one refreshes in the background.
async function getAIEngagedForJob(jobId, jobInfo) {
  // Always fresh: re-read the job's notes unless they were read seconds ago.
  let rec = state.jobs[String(jobId)];
  if (!rec || Date.now() - rec.syncedAt > FRESH_MS) {
    try { rec = await syncJob(jobId, jobInfo); }
    catch (e) { if (!rec) throw e; console.warn(`[ai-notes] Refresh failed for job ${jobId}: ${e.message}`); }
  }
  const now = Date.now();
  const items = (rec.items || []).map(i => ({
    ...i, overdue: !i.responded && now - Date.parse(i.aiNoteAt) >= AUDIT_WINDOW_MS,
  }));
  return {
    applicants: items.filter(i => i.aiCategory === 'Applicant'),
    candidates: items.filter(i => i.aiCategory === 'Candidate'),
  };
}

// assigneeId set -> strict match (unassigned tasks are admin-only);
// jobId optional filter.
// candidateId -> item, built once per job sync (keeps listTasks O(tasks)).
const itemIdx = new WeakMap();
function itemIndex(jobId) {
  const rec = state.jobs[jobId];
  if (!rec) return new Map();
  let m = itemIdx.get(rec);
  if (!m) { m = new Map((rec.items || []).map(i => [String(i.id), i])); itemIdx.set(rec, m); }
  return m;
}

function listTasks({ all, assigneeId, assigneeName, jobId, jobIds, status, sinceDays } = {}) {
  const since = sinceDays ? Date.now() - sinceDays * 86400000 : 0;
  const nm = String(assigneeName || '').trim().toLowerCase();
  const now = Date.now();
  return Object.values(state.tasks)
    .map(t => {
      const it = itemIndex(t.jobId).get(String(t.candidateId));
      return { ...t, aiNote: t.aiNote || (it && it.aiStageLabel) || '', aiCategory: t.aiCategory || (it && it.aiCategory) || 'Applicant',
        sentiment: t.sentiment || (it && it.sentiment) || '', score: t.score ?? (it && it.score) ?? null,
        jobRef: (state.jobs[t.jobId] || {}).jobRef || '' };
    })
    .map(t => ({ ...t, overdue: t.status !== 'completed' && now >= Date.parse(t.dueAt || t.aiNoteAt) + (t.dueAt ? 0 : AUDIT_WINDOW_MS) }))
    .filter(t => all || (!assigneeId && !nm) ||
      (assigneeId && String(t.assigneeId) === String(assigneeId)) ||
      (nm && String(t.assigneeName || '').trim().toLowerCase() === nm) ||
      ((state.jobs[t.jobId] || {}).users || []).some(u =>
        (assigneeId && String(u.id) === String(assigneeId)) ||
        (nm && String(u.name || '').trim().toLowerCase() === nm)))
    .filter(t => !jobId || String(t.jobId) === String(jobId))
    .filter(t => !jobIds || jobIds.has(String(t.jobId)))
    .filter(t => !since || Date.parse(t.aiNoteAt) >= since)
    .filter(t => !status || t.status === status)
    .sort((a, b) => Date.parse(b.aiNoteAt) - Date.parse(a.aiNoteAt));
}

// Fetch the JobDiva reference no. for jobs that don't have it yet.
async function ensureJobRefs(jobIds, loader) {
  const missing = [...new Set(jobIds.map(String))].filter(id => state.jobs[id] && (!state.jobs[id].jobRef || !state.jobs[id].users || !state.jobs[id].users.length));
  await Promise.all(missing.map(async id => {
    try {
      const info = await loader(id);
      if (info && info.jobRef) state.jobs[id].jobRef = info.jobRef;
      if (info && info.users) state.jobs[id].users = info.users;
    } catch (_) { /* leave blank */ }
  }));
  if (missing.length) save();
}

// ---- background scan: jobs created/updated in the last 30 days, any status ----
// JobsListByUser returns nothing for tagged (non-owner) recruiters, so the
// job universe comes from the job-update feed and tasks are matched to
// recruiters through the users tagged on each job (JobsInternalUsersDetail).
const SCAN_DAYS = Number(process.env.AI_SCAN_DAYS) || 30;
const SCAN_CONCURRENCY = Number(process.env.AI_SCAN_CONCURRENCY) || 8;
const WINDOW_DAYS = SCAN_DAYS;
const SCAN_EVERY_MS = 5 * 60 * 1000; // discover new/changed jobs
let scanning = null;
let lastScanAt = 0;

// Users who have opened Tasks (persisted): only jobs they are tagged on get their notes read.
function matchesUser(users, assigneeId, assigneeName) {
  const nm = String(assigneeName || '').trim().toLowerCase();
  return (users || []).some(u => (assigneeId && String(u.id) === String(assigneeId)) ||
    (nm && String(u.name || '').trim().toLowerCase() === nm));
}
function registerUser(id, name) {
  state.activeUsers = state.activeUsers || {};
  const key = String(id || name || '');
  if (!key || state.activeUsers[key]) return false;
  state.activeUsers[key] = { id: String(id || ''), name: String(name || '') };
  save();
  lastScanAt = 0; // new recruiter: scan for their jobs now
  return true;
}

// 1) job ids of the last 30 days (any status)   2) tagged users for all of them
// in a few batched calls   3) read notes ONLY for jobs tagged to an active recruiter.
async function scanRecentJobs() {
  if (scanning) return scanning;
  scanning = (async () => {
    const ids = [...new Set((await atsService.getRecentJobIds(SCAN_DAYS)).map(String))];
    const meta = await atsService.getJobsMeta(ids);
    const users = Object.values(state.activeUsers || {});
    const targets = ids.filter(id => users.some(u => matchesUser((meta[id] || {}).users, u.id, u.name)));
    let i = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, async () => {
      while (i < targets.length) {
        const id = targets[i++];
        try { await syncJob(id, meta[id] || {}, true); if (++done % 20 === 0) save(); }
        catch (e) { console.warn(`[ai-notes] Sync failed for job ${id}: ${e.message}`); }
      }
    }));
    const keep = new Set(targets);
    for (const id of Object.keys(state.jobs)) if (!keep.has(id)) delete state.jobs[id];
    for (const [tid, t] of Object.entries(state.tasks)) if (!keep.has(String(t.jobId))) delete state.tasks[tid];
    lastScanAt = Date.now();
    save();
    console.log(`[ai-notes] ${ids.length} jobs in last ${SCAN_DAYS} days; read notes of ${targets.length} tagged to ${users.length} recruiter(s)`);
  })().finally(() => { scanning = null; });
  return scanning;
}
// Re-read the notes of specific jobs right now (used per request so the
// Tasks page is live); jobs read within FRESH_MS are skipped.
async function syncKnownJobs(jobIds) {
  const ids = jobIds.map(String).filter(id => state.jobs[id] && Date.now() - state.jobs[id].syncedAt > FRESH_MS);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, ids.length) }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try { await syncJob(id, {}, true); } catch (e) { console.warn(`[ai-notes] Live sync failed for job ${id}: ${e.message}`); }
    }
  }));
  if (ids.length) save();
}
function jobsFor({ all, assigneeId, assigneeName }) {
  return Object.entries(state.jobs).filter(([, j]) => all ||
    (assigneeId && String(j.assigneeId) === String(assigneeId)) ||
    (assigneeName && String(j.assigneeName || '').trim().toLowerCase() === String(assigneeName).trim().toLowerCase()) ||
    matchesUser(j.users, assigneeId, assigneeName)
  ).map(([id]) => id);
}
function isScanning() { return !!scanning || !lastScanAt; }
function refreshInBackground() {
  if (!scanning && Date.now() - lastScanAt > SCAN_EVERY_MS) {
    scanRecentJobs().catch(e => console.warn('[ai-notes] Scan failed:', e.message));
  }
}

let timer = null;
function startHourlyPoll() {
  if (timer || String(process.env.ATS_PROVIDER || 'mock') === 'mock') return;
  scanRecentJobs().catch(e => console.warn('[ai-notes] Initial scan failed:', e.message));
  timer = setInterval(() => scanRecentJobs().catch(e => console.warn('[ai-notes] Scan failed:', e.message)), SCAN_EVERY_MS);
  timer.unref();
}

module.exports = {
  getAIEngagedForJob, syncJob, listTasks, syncKnownJobs, jobsFor, registerUser, scanRecentJobs, refreshInBackground, isScanning, startHourlyPoll,
  WINDOW_DAYS, _test: { buildItems, parseNoteDate, classify, reconcileTasks },
};
