require('dotenv').config();
const dns = require('dns');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const store = require('../server/services/recruiter.store');

if (process.env.MONGODB_URI?.startsWith('mongodb+srv://')) {
  const servers = (process.env.MONGODB_DNS_SERVERS || '1.1.1.1,8.8.8.8')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  dns.setServers(servers);
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  const users = db.collection('users');

  const targetEmail = 'mohammedim@aditiconsulting.com';
  const targetJobDivaUserId = '1404778';
  const targetName = 'Mohammed Imran';
  const firstName = 'Mohammed';
  const lastName = 'Imran';

  // 1. Demote any current ADMIN to RECRUITER (except the target user)
  const demoteResult = await users.updateMany(
    {
      role: 'ADMIN',
      email: { $ne: targetEmail },
      jobdivaUserId: { $ne: targetJobDivaUserId }
    },
    {
      $set: {
        role: 'RECRUITER',
        updatedAt: new Date()
      }
    }
  );
  console.log(`Demoted previous admin(s) to RECRUITER: ${demoteResult.modifiedCount}`);

  // 2. Find if target user already exists by email or jobdivaUserId
  const existingUser = await users.findOne({
    $or: [
      { email: targetEmail },
      { jobdivaUserId: targetJobDivaUserId }
    ]
  });

  const now = new Date();
  if (existingUser) {
    await users.updateOne(
      { _id: existingUser._id },
      {
        $set: {
          jobdivaUserId: targetJobDivaUserId,
          name: targetName,
          firstName,
          lastName,
          email: targetEmail,
          role: 'ADMIN',
          active: true,
          jobdivaActive: true,
          recruiterFlag: true,
          updatedAt: now
        }
      }
    );
    console.log(`Updated existing user (${existingUser.email} / ID ${existingUser.jobdivaUserId}) to ADMIN with jobdivaUserId: ${targetJobDivaUserId}`);
  } else {
    const passwordHash = await store.hashPassword(process.env.SANDBOX_DEFAULT_PASSWORD || 'newPassword@123');
    await users.insertOne({
      id: crypto.randomUUID(),
      jobdivaUserId: targetJobDivaUserId,
      firstName,
      lastName,
      name: targetName,
      email: targetEmail,
      title: 'Director - Talent Management',
      division: '',
      divisionId: '',
      city: 'Bellevue',
      state: 'WA',
      timezone: 'America/Chicago',
      role: 'ADMIN',
      active: true,
      jobdivaActive: true,
      recruiterFlag: true,
      salesFlag: false,
      recruitingManagerFlag: false,
      teamLeaderFlag: false,
      superUserFlag: false,
      source: 'jobdiva-sandbox',
      passwordHash,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null
    });
    console.log(`Inserted new ADMIN user ${targetName} (${targetJobDivaUserId})`);
  }

  // Verification
  const admins = await users.find({ role: 'ADMIN' }).toArray();
  console.log('\n--- VERIFICATION: CURRENT ADMIN(S) ---');
  admins.forEach(admin => {
    console.log(`Name: ${admin.name} | Email: ${admin.email} | JobDivaUserId: ${admin.jobdivaUserId} | Role: ${admin.role} | Active: ${admin.active}`);
  });

  const demoted = await users.find({ email: 'shashwats@aditiconsulting.com' }).toArray();
  console.log('\n--- VERIFICATION: PREVIOUS ADMIN ---');
  demoted.forEach(u => {
    console.log(`Name: ${u.name} | Email: ${u.email} | JobDivaUserId: ${u.jobdivaUserId} | Role: ${u.role} | Active: ${u.active}`);
  });

  await client.close();
}

main().catch(err => {
  console.error('Failed to update admin user:', err);
  process.exit(1);
});
