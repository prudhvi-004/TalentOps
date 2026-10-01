// Per-request authenticated user, available to service code without threading params.
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
module.exports = {
  run: (user, fn) => als.run({ user }, fn),
  currentUser: () => { const s = als.getStore(); return s ? s.user : null; },
};