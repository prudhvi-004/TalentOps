// One-time, idempotent patch for server/services/ats.service.js. Run from project root:
//   node scripts/apply-recruiter-scope-patch.js
// Every config.recruiterId use in ats.service.js represents "the recruiter whose data this
// request is for" (jobs list scope, direct job-URL scope check, note author) -> per-user.
const fs = require('fs');
const F = 'server/services/ats.service.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('function currentRecruiterId')) { console.log('skip: already applied'); process.exit(0); }
const die = m => { console.error('FAILED: ' + m); process.exit(1); };
const count = t => s.split(t).length - 1;
const swap = (find, rep, n = 1) => { if (count(find) !== n) die(`${count(find)} matches (expected ${n}) for: ${find}`); s = s.split(find).join(rep); };

swap('config.recruiterId', 'currentRecruiterId()', 6);

swap('let authToken = null;', `const requestContext = require('./request-context');

// Per-request JobDiva recruiter scope.
//  RECRUITER: must use their OWN existing JobDiva recruiter ID; never falls back to the global one.
//  ADMIN: own ID if one is set, otherwise the legacy global JOBDIVA_RECRUITER_ID.
function currentRecruiterId() {
  const user = requestContext.currentUser();
  if (user && user.role === 'RECRUITER') {
    if (!user.jobdivaRecruiterId) {
      const e = new Error('No JobDiva recruiter ID is assigned to this account. Contact an administrator.');
      e.status = 403;
      throw e;
    }
    return String(user.jobdivaRecruiterId);
  }
  return user && user.jobdivaRecruiterId ? String(user.jobdivaRecruiterId) : config.recruiterId;
}

// Job-level access check for job-keyed endpoints (candidates / AI engaged).
async function assertJobAccess(jobId) {
  const data = await requestJobDivaGet(config.endpoints.jobsListByUser, { recruiterId: Number(currentRecruiterId()) });
  const rows = getRows(data) || [];
  const ids = new Set((Array.isArray(rows) ? rows : [rows])
    .map(r => extractId(r, ['jobId', 'JOBID', 'jobID', 'id', 'ID'])).filter(v => v != null && v !== '').map(String));
  if (!ids.has(String(jobId))) { const e = new Error('Job not found'); e.status = 404; throw e; }
}

let authToken = null;`);

// job activity cache must not leak across recruiters
swap('const cacheKey = String(id);', 'const cacheKey = `${currentRecruiterId()}:${id}`;');

swap("if (provider !== 'jobdiva') throw new Error(`getCandidatesForJob is not implemented for provider: ${provider}`);",
     "if (provider !== 'jobdiva') throw new Error(`getCandidatesForJob is not implemented for provider: ${provider}`);\n  await assertJobAccess(jobId);");
swap('const jobField = config.fields.aiJobIdUdf;', 'await assertJobAccess(jobId);\n  const jobField = config.fields.aiJobIdUdf;');
swap('  getAuthToken,', '  getAuthToken,\n  currentRecruiterId,');

fs.writeFileSync(F, s);
console.log('patched: ' + F);