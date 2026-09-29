// =============================================================
// SERVER.JS — MAIN APPLICATION ENTRY POINT  (start: node server.js)
// =============================================================
require('dotenv').config();

const REQUIRED_ENV = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'SESSION_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error('❌ SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./server/routes/auth.routes');
const adminRoutes = require('./server/routes/admin.routes');
const apiRoutes = require('./server/routes/api.routes');
const { requireLogin, requireRole } = require('./server/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const secureCookie = process.env.NODE_ENV === 'production' || /^https:/i.test(process.env.OIDC_REDIRECT_URI);

// Set TRUST_PROXY=1 when behind a TLS-terminating proxy so secure cookies work.
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use(session({
  name: 'talentops.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',      // 'strict' would drop the cookie on the IdP → callback redirect
    secure: secureCookie,
  },
}));

// Static assets. index:false so "/" is NOT served without authentication.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Auth (login / callback / logout / denied) — public by design
app.use('/', authRoutes);

// Identity + admin APIs (must be registered before the generic /api router)
app.get('/api/me', requireLogin, (req, res) => res.json({ success: true, data: req.user }));
app.use('/api/admin', requireLogin, requireRole('ADMIN'), adminRoutes);

// Existing data APIs (requireLogin is applied inside api.routes.js)
app.use('/api', apiRoutes);

// App shell pages
const shell = (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html'));
['/', '/index.html', '/jobs', '/candidates', '/tasks', '/team', '/clients'].forEach(p => app.get(p, requireLogin, shell));
app.get('/admin', requireLogin, requireRole('ADMIN'), shell);
app.get('/jobs/:id', requireLogin, shell);
app.get('/candidates/:id', requireLogin, shell);

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

app.listen(PORT, () => {
  console.log(`TalentOps running on http://localhost:${PORT}`);
  console.log(`ATS Provider: ${process.env.ATS_PROVIDER || 'mock'} | Auth: OIDC SSO`);
});