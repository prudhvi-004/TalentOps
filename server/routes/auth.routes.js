// =============================================================
// AUTH ROUTES — auth.routes.js
// =============================================================
// Purpose:
//   Handles login and logout HTTP requests.
//
// Routes defined here:
//   GET  /login  → Serve the login HTML page
//   POST /login  → Validate credentials, create session
//   GET  /logout → Destroy session, redirect to login
//
// Credentials come from .env:
//   DEMO_USERNAME and DEMO_PASSWORD
//
// For production:
//   Replace the credential check below with a real
//   database lookup or SSO/SAML authentication flow.
//   The structure of the route stays the same.
// =============================================================

const express = require('express');
const router = express.Router();
require('dotenv').config();

// ----------------------------------------------------------
// GET /login
// Serves the login page HTML file.
// ----------------------------------------------------------
router.get('/login', (req, res) => {
  // If already logged in, skip login and go to dashboard
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  // Send the login HTML file from the public folder
  res.sendFile('login.html', { root: './public' });
});

// ----------------------------------------------------------
// POST /login
// Receives username + password from the login form.
// Validates against .env credentials.
// On success: creates session and redirects to dashboard.
// On failure: redirects back to login with error message.
// ----------------------------------------------------------
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Pull allowed credentials from environment variables
  const validUsername = process.env.DEMO_USERNAME || 'demo';
  const validPassword = process.env.DEMO_PASSWORD || 'talentops2024';

  // Compare submitted credentials
  if (username === validUsername && password === validPassword) {
    // Credentials match — create a session for this user
    req.session.user = {
      username: username,
      name: 'Demo Presenter',    // Display name shown in topbar
      role: 'recruiter',         // Default role for demo
      loginTime: Date.now(),
    };

    // Redirect to the main dashboard after successful login
    return res.redirect('/');
  }

  // Credentials did not match — send back to login with flag
  // The ?error=1 in the URL tells the login page to show
  // an error message to the user.
  return res.redirect('/login?error=1');
});

// ----------------------------------------------------------
// GET /logout
// Destroys the current session and returns to login page.
// ----------------------------------------------------------
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
    }
    // Redirect to login regardless of error
    res.redirect('/login');
  });
});

module.exports = router;