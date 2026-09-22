# TalentOps Demo — Setup Guide

Recruitment operations platform demo connecting to ATS sandbox APIs.

---

## Prerequisites

- Node.js v16 or higher
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

## JobDiva integration flow

When `ATS_PROVIDER=jobdiva`, the application uses the recruiter ID in
`JOBDIVA_RECRUITER_ID` as the server-side scope for jobs. It does not fetch all
JobDiva jobs and filter them in the browser.

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
