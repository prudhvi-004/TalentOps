// One-time / repeatable import for the reviewed sandbox user dataset.
require('dotenv').config();
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const store = require('../server/services/recruiter.store');

if (process.env.NODE_ENV === 'development' && process.env.MONGODB_URI?.startsWith('mongodb+srv://')) {
  const servers = (process.env.MONGODB_DNS_SERVERS || '1.1.1.1,8.8.8.8').split(',').map(value => value.trim()).filter(Boolean);
  dns.setServers(servers);
  console.log(`[seed:users] MongoDB DNS servers: ${servers.join(', ')}`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Sandbox user seeding is disabled in production.');
  const required = ['MONGODB_URI', 'MONGODB_DB', 'SANDBOX_DEFAULT_PASSWORD', 'SANDBOX_INITIAL_ADMIN_JOBDIVA_USER_ID'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (process.env.SANDBOX_DEFAULT_PASSWORD.length < 12) throw new Error('SANDBOX_DEFAULT_PASSWORD must be at least 12 characters.');

  const seedPath = path.join(__dirname, '../data/users.seed.json');
  const sourceUsers = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  if (!Array.isArray(sourceUsers)) throw new Error('data/users.seed.json must contain a JSON array.');
  const initialAdminId = process.env.SANDBOX_INITIAL_ADMIN_JOBDIVA_USER_ID.trim();
  const containsInitialAdmin = sourceUsers.some(raw => {
    const user = store.mapJobDivaUser(raw);
    return user && /^\d+$/.test(user.jobdivaUserId) && user.jobdivaUserId === initialAdminId;
  });
  if (!containsInitialAdmin) throw new Error(`Configured initial admin USERID ${initialAdminId} is missing or invalid in data/users.seed.json.`);

  await store.connect();
  const passwordHash = await store.hashPassword(process.env.SANDBOX_DEFAULT_PASSWORD);
  const result = await store.seedUsers(sourceUsers, initialAdminId, passwordHash);
  console.log(`Seed source users: ${result.sourceUsers}`);
  console.log(`Imported/updated: ${result.importedUpdated}`);
  console.log(`Skipped invalid: ${result.skippedInvalid}`);
  console.log(`Admins: ${result.admins}`);
  console.log(`Recruiters: ${result.recruiters}`);
  console.log(`Unassigned non-recruiters: ${result.unassigned}`);
  console.log(`Inactive: ${result.inactive}`);
}

main()
  .catch(error => { console.error(`[seed:users] ${error.message}`); process.exitCode = 1; })
  .finally(() => store.close().catch(error => { console.error(`[seed:users] MongoDB close failed: ${error.message}`); process.exitCode = 1; }));
