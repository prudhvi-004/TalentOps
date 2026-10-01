// Mounted behind requireLogin + requireRole('ADMIN') in server.js.
const express = require('express');
const store = require('../services/recruiter.store');
const router = express.Router();

const fail = (res, error) => {
  if (!error.status) console.error('[admin] Unexpected error:', error.message);
  res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'Internal error' });
};

router.get(['/users', '/recruiters'], async (req, res) => {
  try { res.json({ success: true, data: await store.list() }); }
  catch (error) { fail(res, error); }
});

router.post(['/users', '/recruiters'], async (req, res) => {
  try {
    const id = String(req.body?.jobdivaUserId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'Select an existing MongoDB TalentOps user.' });
    const user = await store.findByJobDivaUserId(id);
    if (!user) return res.status(404).json({ success: false, error: 'This JobDiva user is not in the seeded TalentOps directory.' });
    res.json({ success: true, data: await store.update(user.id, { role: 'RECRUITER', active: true }, req.user) });
  } catch (error) { fail(res, error); }
});

router.patch(['/users/:id', '/recruiters/:id'], async (req, res) => {
  try { res.json({ success: true, data: await store.update(req.params.id, req.body || {}, req.user) }); }
  catch (error) { fail(res, error); }
});

// Kept for existing clients: remove means deactivate TalentOps access only.
router.delete(['/users/:id', '/recruiters/:id'], async (req, res) => {
  try { res.json({ success: true, data: await store.update(req.params.id, { active: false }, req.user) }); }
  catch (error) { fail(res, error); }
});

module.exports = router;
