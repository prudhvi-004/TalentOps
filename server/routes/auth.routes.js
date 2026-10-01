// OIDC (authorization code + PKCE + state + nonce). Provider-agnostic via discovery.
const path = require('path');
const express = require('express');
const { Issuer, generators } = require('openid-client');
const store = require('../services/recruiter.store');

const router = express.Router();
const SCOPE = 'openid profile email';
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI;
const POST_LOGOUT_URI = process.env.OIDC_POST_LOGOUT_REDIRECT_URI;

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = Issuer.discover(process.env.OIDC_ISSUER_URL)
      .then(issuer => new issuer.Client({
        client_id: process.env.OIDC_CLIENT_ID,
        client_secret: process.env.OIDC_CLIENT_SECRET,
        redirect_uris: [REDIRECT_URI],
        response_types: ['code'],
      }))
      .catch(err => { clientPromise = null; throw err; });
  }
  return clientPromise;
}

// Only same-site relative paths; blocks open redirects.
function safeReturnTo(v) {
  return typeof v === 'string' && /^\/(?![/\\])/.test(v) && !v.startsWith('/auth/') ? v : '/';
}
const deny = (res, reason) => res.redirect('/auth/denied?reason=' + encodeURIComponent(reason));

router.get('/auth/login', async (req, res) => {
  if (req.session.user) return res.redirect(safeReturnTo(req.query.returnTo));
  try {
    const client = await getClient();
    const state = generators.state();
    const nonce = generators.nonce();
    const verifier = generators.codeVerifier();
    req.session.oidc = { state, nonce, verifier, returnTo: safeReturnTo(req.query.returnTo) };
    const url = client.authorizationUrl({
      scope: SCOPE, state, nonce,
      code_challenge: generators.codeChallenge(verifier),
      code_challenge_method: 'S256',
    });
    req.session.save(err => (err ? deny(res, 'error') : res.redirect(url)));
  } catch (err) {
    console.error('[auth] Login initiation failed:', err.message);
    deny(res, 'provider');
  }
});

router.get('/auth/callback', async (req, res) => {
  const saved = req.session.oidc;
  if (!saved) return deny(res, 'session');
  try {
    const client = await getClient();
    const params = client.callbackParams(req);
    if (params.error) {
      console.warn('[auth] IdP returned error:', params.error);
      return deny(res, 'idp');
    }
    const tokenSet = await client.callback(REDIRECT_URI, params, {
      state: saved.state, nonce: saved.nonce, code_verifier: saved.verifier,
    });
    const result = await store.resolveLogin(tokenSet.claims());
    if (!result.ok) return req.session.destroy(() => deny(res, result.reason));

    const idToken = tokenSet.id_token; // kept server-side only (logout hint)
    req.session.regenerate(err => {
      if (err) return deny(res, 'error');
      req.session.user = { id: result.record.id };
      req.session.idToken = idToken;
      req.session.save(() => res.redirect(saved.returnTo));
    });
  } catch (err) {
    console.error('[auth] Callback validation failed:', err.message);
    req.session.destroy(() => deny(res, 'error'));
  }
});

router.post('/auth/logout', async (req, res) => {
  const idToken = req.session && req.session.idToken;
  req.session.destroy(async () => {
    res.clearCookie('talentops.sid');
    let redirect = '/access-denied.html?reason=signedout';
    try {
      if (POST_LOGOUT_URI) {
        const client = await getClient();
        if (client.issuer.metadata.end_session_endpoint) {
          redirect = client.endSessionUrl({ id_token_hint: idToken, post_logout_redirect_uri: POST_LOGOUT_URI });
        }
      }
    } catch (_) { /* fall back to local sign-out page */ }
    res.json({ success: true, redirect });
  });
});

router.get('/auth/denied', (req, res) => {
  res.status(403).sendFile(path.join(__dirname, '../../public/access-denied.html'));
});

module.exports = router;
