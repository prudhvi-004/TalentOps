// =============================================================
// SERVER.JS — MAIN APPLICATION ENTRY POINT
// =============================================================
// Purpose:
//   Starts the Express web server.
//   Wires together all routes, middleware, and static files.
//   This is the file you run to start the application.
//
// Start command:
//   node server.js
//
// Then open browser to:
//   http://localhost:3000
// =============================================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./server/routes/auth.routes');
const apiRoutes = require('./server/routes/api.routes');
const { requireLogin } = require('./server/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------
// MIDDLEWARE SETUP
// ----------------------------------------------------------

// Parse incoming JSON request bodies
app.use(express.json());

// Parse URL-encoded form data (login form submissions)
app.use(express.urlencoded({ extended: true }));

// Allow cross-origin requests (needed if frontend ever
// runs on a different port than the server)
app.use(cors());

// Session configuration
// Sessions keep the user logged in between page navigations.
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Session lasts 8 hours (enough for a full demo day)
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,    // Prevents JavaScript from reading cookie
    secure: false,     // Set to true if using HTTPS in production
  },
}));

// ----------------------------------------------------------
// STATIC FILES
// Serve everything in /public directly to the browser.
// /public/css/  → http://localhost:3000/css/
// /public/js/   → http://localhost:3000/js/
// ----------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------
// ROUTES
// ----------------------------------------------------------

// Auth routes (login page + login/logout actions)
// These do NOT require login — they ARE the login flow.
app.use('/', authRoutes);

// API routes (all data endpoints for the frontend)
// requireLogin is applied inside api.routes.js
app.use('/api', apiRoutes);

// ----------------------------------------------------------
// MAIN APP PAGES
// All pages below require the user to be logged in.
// Each route serves the same index.html shell.
// The frontend JavaScript handles what content to show
// based on the current URL path.
// ----------------------------------------------------------
const pages = ['/', '/jobs', '/candidates', '/tasks', '/team', '/clients', '/admin'];

pages.forEach(page => {
  app.get(page, requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
});

// Job detail and candidate profile are dynamic routes
app.get('/jobs/:id', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/candidates/:id', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----------------------------------------------------------
// 404 HANDLER
// Catches any route not matched above.
// ----------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ----------------------------------------------------------
// START SERVER
// ----------------------------------------------------------
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║        TalentOps Demo — Running           ║');
  console.log(`║   http://localhost:${PORT}                   ║`);
  console.log('║                                           ║');
  console.log(`║   ATS Provider: ${process.env.ATS_PROVIDER || 'mock'}                     ║`);
  console.log('║   Login: demo / talentops2024             ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');
});