const express = require('express');
const store = require('../services/recruiter.store');

const router = express.Router();

const MOCK_ENABLED =
  process.env.NODE_ENV === 'development' &&
  process.env.AUTH_MODE === 'mock';

function ensureMockMode(req, res, next) {
  if (!MOCK_ENABLED) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

function findByEmail(email) {
  return store.list().find(
    user => String(user.email).toLowerCase() === email.toLowerCase()
  );
}

function loginAs(req, res, record) {
  req.session.regenerate(err => {
    if (err) {
      console.error('[dev-auth] Session regeneration failed:', err);
      return res.status(500).json({ error: 'Failed to create session' });
    }

    req.session.user = { id: record.id };

    req.session.save(saveErr => {
      if (saveErr) {
        console.error('[dev-auth] Session save failed:', saveErr);
        return res.status(500).json({ error: 'Failed to save session' });
      }

      res.redirect('/');
    });
  });
}

// Development login page
router.get('/auth/dev', ensureMockMode, (req, res) => {
  res.send(`
    <!doctype html>
    <html>
      <head>
        <title>TalentOps Development Login</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 500px;
            margin: 80px auto;
            padding: 24px;
          }
          a {
            display: block;
            margin: 12px 0;
            padding: 12px;
            text-decoration: none;
            background: #111;
            color: white;
            border-radius: 6px;
          }
        </style>
      </head>
      <body>
        <h1>TalentOps Development Login</h1>
        <p>Development-only authentication.</p>

        <a href="/auth/dev/login/admin">
          Login as Admin
        </a>

        <a href="/auth/dev/login/recruiter">
          Login as Recruiter
        </a>
      </body>
    </html>
  `);
});

// Mock ADMIN login
router.get('/auth/dev/login/admin', ensureMockMode, (req, res) => {
  const email = 'admin@example.local';
  const record = findByEmail(email);

  if (!record) {
    return res.status(500).json({
      error:
        'Mock admin not found. Check INITIAL_ADMIN_EMAILS and recruiter store.'
    });
  }

  return loginAs(req, res, record);
});

// Mock RECRUITER login
router.get('/auth/dev/login/recruiter', ensureMockMode, (req, res) => {
  const email = 'recruiter@example.local';

  let record = findByEmail(email);

  if (!record) {
    record = store.add({
      email,
      name: 'Mock Recruiter',
      role: 'RECRUITER',
      jobdivaRecruiterId:
        process.env.DEV_MOCK_JOBDIVA_RECRUITER_ID || '900001'
    });
  }

  return loginAs(req, res, record);
});

module.exports = router;