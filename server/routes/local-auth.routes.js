// Sandbox-only local login. Passwords are application credentials, never JobDiva credentials.
const path = require('path');
const express = require('express');
const store = require('../services/recruiter.store');
const router = express.Router();

function safeReturnTo(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && !value.startsWith('/auth/') ? value : '/';
}

router.get('/auth/login', (req, res) => {
  if (req.session.user) return res.redirect(safeReturnTo(req.query.returnTo));
  res.sendFile(path.join(__dirname, '../../public/sandbox-login.html'));
});

router.post('/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required.' });
  try {
    const user = await store.findForLogin(email);
    const valid = user && user.active && user.jobdivaActive && await store.verifyPassword(password, user.passwordHash);
    if (!valid) return res.status(401).json({ success: false, error: 'Email or password is incorrect, or this account is inactive.' });
    req.session.regenerate(error => {
      if (error) return res.status(500).json({ success: false, error: 'Could not create a session.' });
      req.session.user = { id: user.id };
      req.session.save(async saveError => {
        if (saveError) return res.status(500).json({ success: false, error: 'Could not save the session.' });
        try { await store.touchLogin(user.id); }
        catch (touchError) { console.error('[auth] Failed to update last login:', touchError.message); }
      res.json({ success: true, redirect: safeReturnTo(req.body?.returnTo) });
      });
    });
  } catch (error) {
    console.error('[auth] Local login failed:', error.message);
    res.status(503).json({ success: false, error: 'Authentication service unavailable.' });
  }
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(error => {
    res.clearCookie('talentops.sid');
    if (error) return res.status(500).json({ success: false, error: 'Could not end the session.' });
    res.json({ success: true, redirect: '/access-denied.html?reason=signedout' });
  });
});

router.get('/auth/denied', (req, res) => {
  res.status(403).sendFile(path.join(__dirname, '../../public/access-denied.html'));
});

module.exports = router;
