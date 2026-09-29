// Mounted at /api/admin behind requireLogin + requireRole('ADMIN') in server.js.
const express = require('express');
const store = require('../services/recruiter.store');
const router = express.Router();

const fail = (res, e) => {
  if (!e.status) console.error('[admin] Unexpected error:', e.message);
  res.status(e.status || 500).json({ success: false, error: e.status ? e.message : 'Internal error' });
};

router.get('/recruiters', (req, res) => res.json({ success: true, data: store.list() }));

router.post('/recruiters', (req, res) => {
  try { res.status(201).json({ success: true, data: store.add(req.body || {}) }); }
  catch (e) { fail(res, e); }
});

router.patch('/recruiters/:id', (req, res) => {
  try { res.json({ success: true, data: store.update(req.params.id, req.body || {}, req.user) }); }
  catch (e) { fail(res, e); }
});

// Soft delete: deactivates (history/identity preserved).
router.delete('/recruiters/:id', (req, res) => {
  try { res.json({ success: true, data: store.update(req.params.id, { active: false }, req.user) }); }
  catch (e) { fail(res, e); }
});

module.exports = router;