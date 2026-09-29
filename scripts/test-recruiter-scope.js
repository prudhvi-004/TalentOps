// Offline test (stubbed node-fetch, no JobDiva needed). Run AFTER the scope patch:
//   node scripts/test-recruiter-scope.js
process.env.ATS_PROVIDER = 'jobdiva';
process.env.JOBDIVA_BASE_URL = 'https://jd.test';
process.env.JOBDIVA_CLIENT_ID = 'c'; process.env.JOBDIVA_USERNAME = 'u'; process.env.JOBDIVA_PASSWORD = 'p';
process.env.JOBDIVA_RECRUITER_ID = '111'; // legacy global (admin fallback only)

const calls = [];
const stub = async (url) => {
  const u = String(url); calls.push(u);
  const body = u.includes('/authenticate') ? 'TOKEN'
    : u.includes('JobsListByUser') ? JSON.stringify({ data: [['jobId'], [1]] })
    : JSON.stringify({ data: [] });
  return { ok: true, status: 200, text: async () => body };
};
const p = require.resolve('node-fetch');
require.cache[p] = { id: p, filename: p, loaded: true, exports: stub };

const ats = require('../server/services/ats.service');
const ctx = require('../server/services/request-context');
const as = (user, fn) => new Promise((res, rej) => ctx.run(user, () => fn().then(res, rej)));
const listIds = () => calls.filter(c => c.includes('JobsListByUser')).map(c => new URL(c).searchParams.get('recruiterId'));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

(async () => {
  const A = { role: 'RECRUITER', jobdivaRecruiterId: '12345' }, B = { role: 'RECRUITER', jobdivaRecruiterId: '67890' };
  await Promise.all([as(A, () => ats.getJobs()), as(B, () => ats.getJobs())]);
  ok(listIds().sort().join() === '12345,67890', 'concurrent recruiters each use their own JobDiva ID');

  calls.length = 0;
  await as({ role: 'RECRUITER', jobdivaRecruiterId: '' }, () => ats.getJobs()).then(() => ok(false, 'recruiter w/o ID rejected'), e => ok(e.status === 403 && !listIds().length, 'recruiter w/o ID rejected (403), no JobDiva call'));

  calls.length = 0;
  await as({ role: 'ADMIN', jobdivaRecruiterId: '' }, () => ats.getJobs());
  ok(listIds()[0] === '111', 'admin w/o own ID uses legacy global ID');
  calls.length = 0;
  await as({ role: 'ADMIN', jobdivaRecruiterId: '555' }, () => ats.getJobs());
  ok(listIds()[0] === '555', 'admin with own ID uses it');

  await as(A, () => ats.getCandidatesForJob('999')).then(() => ok(false, 'foreign job blocked'), e => ok(e.status === 404, 'candidates of a job outside recruiter scope -> 404'));
  process.exit(fail ? 1 : 0);
})();