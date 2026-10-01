// =============================================================
// TalentOps application server
// =============================================================
require('dotenv').config();

const dns = require('dns');

// Development-only workaround for MongoDB Atlas SRV DNS resolution.
// Your current machine's default DNS resolver is refusing SRV queries,
// while 1.1.1.1 and 8.8.8.8 resolve the Atlas cluster correctly.
if (
  process.env.NODE_ENV === 'development' &&
  process.env.MONGODB_URI?.startsWith('mongodb+srv://')
) {
  const servers = (
    process.env.MONGODB_DNS_SERVERS || '1.1.1.1,8.8.8.8'
  )
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  dns.setServers(servers);
  console.log(`[startup] MongoDB DNS servers: ${servers.join(', ')}`);
}

const AUTH_PROVIDER = String(process.env.AUTH_PROVIDER || 'local').trim().toLowerCase();
if (!['local', 'oidc'].includes(AUTH_PROVIDER)) {
  console.error('AUTH_PROVIDER must be local or oidc.');
  process.exit(1);
}
if (AUTH_PROVIDER === 'local' && process.env.NODE_ENV === 'production') {
  console.error('Sandbox local authentication is not permitted in production.');
  process.exit(1);
}
const REQUIRED_ENV = ['SESSION_SECRET', 'MONGODB_URI', 'MONGODB_DB'];
if (AUTH_PROVIDER === 'oidc') REQUIRED_ENV.push('OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI');
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (AUTH_PROVIDER === 'local' && process.env.SANDBOX_DEFAULT_PASSWORD.length < 12) {
  console.error('SANDBOX_DEFAULT_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const userStore = require('./server/services/recruiter.store');
const localAuthRoutes = require('./server/routes/local-auth.routes');
const oidcAuthRoutes = require('./server/routes/auth.routes');
const adminRoutes = require('./server/routes/admin.routes');
const apiRoutes = require('./server/routes/api.routes');
const { requireLogin, requireRole } = require('./server/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const secureCookie = process.env.NODE_ENV === 'production' || /^https:/i.test(process.env.OIDC_REDIRECT_URI || '');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(session({
  name: 'talentops.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: secureCookie },
}));

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/', AUTH_PROVIDER === 'local' ? localAuthRoutes : oidcAuthRoutes);

app.get('/api/auth/config', (req, res) => res.json({ developmentMockAuth: false, sandboxLocalAuth: AUTH_PROVIDER === 'local' }));
app.get('/api/me', requireLogin, (req, res) => res.json({ success: true, data: req.user }));
app.use('/api/admin', requireLogin, requireRole('ADMIN'), adminRoutes);
app.use('/api', apiRoutes);

const shell = (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html'));
['/', '/index.html', '/jobs', '/candidates', '/submittals', '/interviews', '/starts', '/first-presentations', '/my-primary-jobs', '/tasks', '/team', '/clients'].forEach(route => app.get(route, requireLogin, shell));
app.get('/admin', requireLogin, requireRole('ADMIN'), shell);
app.get('/jobs/:id', requireLogin, shell);
app.get('/candidates/:id', requireLogin, shell);
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

async function start() {
  await userStore.connect();
  if (AUTH_PROVIDER === 'local') {
    console.warn('SANDBOX local authentication enabled. Never use this mode in production. Run npm run seed:users after configuring the seed settings.');
  }
  app.listen(PORT, () => {
    console.log(`TalentOps running on http://localhost:${PORT}`);
    console.log(`ATS Provider: ${process.env.ATS_PROVIDER || 'mock'} | Auth provider: ${AUTH_PROVIDER}`);
  });
}

start().catch(error => {
  console.error('[startup] Could not initialize authentication:', error.message);
  process.exit(1);
});
