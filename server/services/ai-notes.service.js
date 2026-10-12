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
const HUMAN_TYPENAME = 'REC_AI';
const AUDIT_WINDOW_MS = 120 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 60 * 1000;
const FRESH_MS = 5 * 60 * 1000; // on-demand refresh throttle
// DATECREATED has no zone; JobDiva returns account-local time.
const NOTE_TZ = process.env.JOBDIVA_NOTE_TIMEZONE || 'America/New_York';

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'runtime', 'ai-audit.json');

const KNOWN_TYPES = [
  { re: /^sense ai auto sourcing evaluation:\s*positive$/i, section: 'Candidate', sentiment: 'positive' },
  { re: /^sense ai auto sourcing evaluation:\s*negative$/i, section: 'Candidate', sentiment: 'negative' },
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
    if (String(n.TYPENAME || '').trim().toUpperCase() === HUMAN_TYPENAME) {
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
      }
      continue;
    }
    if (existing) {
      if (!existing.assigneeId && job.assigneeId) {
        existing.assigneeId = job.assigneeId;
        existing.assigneeName = job.assigneeName || '';
      }
      if (!existing.jobTitle && job.jobTitle) existing.jobTitle = job.jobTitle;
      continue;
    }
    if (now - Date.parse(item.aiNoteAt) < AUDIT_WINDOW_MS) continue;
    state.tasks[id] = {
      id,
      type: 'Automated',
      status: 'pending',
      jobId: item.jobId,
      jobTitle: job.jobTitle || '',
      candidateId: item.id,
      candidateName: item.name,
      assigneeId: job.assigneeId || '',
      assigneeName: job.assigneeName || '',
      priority: item.sentiment === 'positive' ? 'High' : 'Normal',
      title: `Review AI Evaluated Candidate — ${item.name}`,
      detail: `AI evaluated this candidate at ${item.aiNoteAt}. No follow-up note has been recorded. Please review and drop a REC_AI note.`,
      aiNoteAt: item.aiNoteAt,
      createdAt: stamp,
      completedAt: null,
    };
  }
}

// ---- sync ------------------------------------------------------
async function syncJob(jobId, jobInfo = {}) {
  jobId = String(jobId);
  if (inflight.has(jobId)) return inflight.get(jobId);
  const p = (async () => {
    const prev = state.jobs[jobId] || {};
    // jobInfo may be an object or a loader fn; only load when owner unknown.
    let info = typeof jobInfo === 'function' ? {} : jobInfo;
    if (typeof jobInfo === 'function' && !prev.assigneeId) {
      info = await Promise.resolve(jobInfo()).catch(() => ({}));
    }
    const job = {
      jobId,
      jobTitle: info.jobTitle || prev.jobTitle || '',
      assigneeId: String(info.assigneeId || prev.assigneeId || ''),
      assigneeName: info.assigneeName || prev.assigneeName || '',
    };
    const notes = await atsService.getJobNotes(jobId);
    const items = buildItems(notes);
    reconcileTasks(job, items, Date.now());
    state.jobs[jobId] = { ...job, syncedAt: Date.now(), items };
    save();
    return state.jobs[jobId];
  })().finally(() => inflight.delete(jobId));
  inflight.set(jobId, p);
  return p;
}

// Cached result is returned instantly; a stale one refreshes in the background.
async function getAIEngagedForJob(jobId, jobInfo) {
  let rec = state.jobs[String(jobId)];
  if (!rec) rec = await syncJob(jobId, jobInfo);
  else if (Date.now() - rec.syncedAt > FRESH_MS) {
    syncJob(jobId, jobInfo).catch(e => console.warn(`[ai-notes] Refresh failed for job ${jobId}: ${e.message}`));
  }
  const items = rec.items || [];
  return {
    applicants: items.filter(i => i.aiCategory === 'Applicant'),
    candidates: items.filter(i => i.aiCategory === 'Candidate'),
  };
}

// assigneeId set -> strict match (unassigned tasks are admin-only);
// jobId optional filter.
function listTasks({ assigneeId, jobId, status } = {}) {
  return Object.values(state.tasks)
    .filter(t => !assigneeId || String(t.assigneeId) === String(assigneeId))
    .filter(t => !jobId || String(t.jobId) === String(jobId))
    .filter(t => !status || t.status === status)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

let timer = null;
function startHourlyPoll() {
  if (timer || String(process.env.ATS_PROVIDER || 'mock') === 'mock') return;
  const run = async () => {
    for (const jobId of Object.keys(state.jobs)) {
      try { await syncJob(jobId); }
      catch (e) { console.warn(`[ai-notes] Hourly sync failed for job ${jobId}: ${e.message}`); }
    }
  };
  timer = setInterval(run, POLL_INTERVAL_MS);
  timer.unref();
}

module.exports = {
  getAIEngagedForJob, syncJob, listTasks, startHourlyPoll,
  _test: { buildItems, parseNoteDate, classify, reconcileTasks },
};
