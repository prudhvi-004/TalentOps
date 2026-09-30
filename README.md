# TalentOps Demo — Setup Guide

Recruitment operations platform demo connecting to ATS sandbox APIs.

---

## Prerequisites

- Node.js v20 or higher
- npm v8 or higher
- A modern browser (Chrome / Edge recommended)

---

## Quick Start

### Step 1 — Clone or download the project

```bash
cd Desktop
# If using git:
git clone <your-repo-url> talentops-demo
# Or just have the folder ready from setup
cd talentops-demo
```

## Sandbox authentication setup

TalentOps sandbox login uses its own MongoDB-backed account and password. It
does not use JobDiva credentials. Local authentication is intentionally blocked
when `NODE_ENV=production`.

1. Start MongoDB Atlas or a local MongoDB server.
2. Configure `MONGODB_URI`, `MONGODB_DB`, `SANDBOX_DEFAULT_PASSWORD`, and
   `SANDBOX_INITIAL_ADMIN_JOBDIVA_USER_ID` in `.env`. Set the last value to a
   USERID from `data/users.seed.json`.
3. Run `npm install`, then run `npm run seed:users` to import the seed file.
   The repeatable import does not call JobDiva and refreshes seeded password
   hashes from the shared sandbox password.
4. Run `npm start` and open `http://localhost:3000/auth/login`.

An ADMIN adds a recruiter by searching the MongoDB TalentOps user directory and
selecting a seeded, unassigned user. The user must be active in JobDiva; adding
sets the TalentOps role to RECRUITER and activates TalentOps access. Deactivation
preserves the MongoDB and JobDiva identities. At least one active ADMIN is
required, and admins cannot deactivate or demote themselves.

Sessions and role checks are shared across providers. `AUTH_PROVIDER=local`
selects this sandbox login; the existing OIDC provider module remains separate
for a future provider switch.

## JobDiva integration flow

When `ATS_PROVIDER=jobdiva`, the application scopes recruiter-specific calls
with the authenticated TalentOps user's provisioned JobDiva `USERID`. It does
not use one global recruiter ID for all TalentOps users or filter all jobs in
the browser.

### Job flow

1. `JobsListByUser(recruiterId)` obtains the jobs visible to the configured recruiter.
2. `JobsDetail(jobId)` obtains the complete job record.
3. Hiring-manager/contact fields are mapped from JobDiva's contact fields when the generic hiring-manager field is absent.
4. Requirements are built from JobDiva's required degree/major/certifications plus technical/professional requirement bullets embedded in `JOBDESCRIPTION`.

### Assigned candidates flow

JobDiva's tested `JobsApplicantsDetail` endpoint returned zero records in the supplied sandbox diagnostic. The application therefore uses the verified relationship endpoint:

`GET /apiv2/bi/JobsSubmittalsDetail?jobIds=<jobId>`

Each submittal contains `JOBID` and `CANDIDATEID`. The server de-duplicates candidates per job while retaining all submittal history.

### Candidate profile flow

For a selected candidate the server combines:

- `CandidateDetail` — identity/contact/salary/social fields
- `CandidatesProfileDetail` — extended profile fields where available
- `CandidateResumesDetail` — resume metadata
- `ResumesTextDetail` — actual resume text
- `CandidateAttachmentList` — candidate attachments
- `CandidateNotesListDetail` — existing JobDiva notes

The newest resume with available text is exposed as `candidate.resume`, while all resume records are available under `candidate.resumes`.

### Notes

The existing note form posts through the server to:

`POST /apiv2/jobdiva/createCandidateNote`

The browser never receives the JobDiva credentials.
