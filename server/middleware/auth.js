// =============================================================
// AUTH MIDDLEWARE — auth.js
// =============================================================
// Purpose:
//   Protects all routes that require a logged-in user.
//   If someone tries to access /dashboard without logging in,
//   they get redirected to the login page.
//
// How it works:
//   Express attaches req.session to every request.
//   After login, we store req.session.user = { username }.
//   This middleware checks if that session value exists.
//   If yes → allow request through.
//   If no  → redirect to /login.
//
// Used in:
//   server.js — applied to all protected routes
// =============================================================

/**
 * requireLogin
 * Middleware function that blocks unauthenticated requests.
 * Attach this to any route that needs protection.
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Call next() to continue to the route
 */
function requireLogin(req, res, next) {
  // Check if a user session exists
  if (req.session && req.session.user) {
    // User is logged in — let them through
    return next();
  }

  // No session found — redirect to login page
  // req.originalUrl captures where they were trying to go,
  // so after login we can send them back there if needed.
  return res.redirect('/login');
}

module.exports = { requireLogin };