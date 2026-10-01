// Session + role enforcement. The session stores only the recruiter id;
// role/active status are re-read from the store on EVERY request so
// deactivation and demotion take effect immediately.
const store = require('../services/recruiter.store');
const requestContext = require('../services/request-context');

const isApi = req => req.originalUrl.startsWith('/api/');

async function requireLogin(req, res, next) {
  const sid = req.session && req.session.user && req.session.user.id;
  let rec;
  try { rec = sid ? await store.findById(sid) : null; }
  catch (error) {
    console.error('[auth] User lookup failed:', error.message);
    return res.status(503).json({ success: false, error: 'Authentication service unavailable' });
  }

  if (!rec || !rec.active) {
    const finish = () => {
      if (isApi(req)) {
        return res.status(401).json({ success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' });
      }
      return res.redirect('/auth/login?returnTo=' + encodeURIComponent(req.originalUrl));
    };
    if (req.session && sid) return req.session.destroy(finish); // revoked/removed
    return finish();
  }

  req.user = {
    id: rec.id, email: rec.email, name: rec.name, role: rec.role,
    jobdivaUserId: rec.jobdivaUserId,
    jobdivaRecruiterId: rec.jobdivaUserId || '',
    active: rec.active,
  };
  requestContext.run(req.user, next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    if (isApi(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
    return res.redirect('/auth/denied?reason=forbidden');
  };
}

module.exports = { requireLogin, requireRole };
