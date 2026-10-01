// =============================================================
// ATS CONFIGURATION — ats.config.js
// =============================================================
// Purpose:
//   Central configuration file for all ATS providers.
//   The app reads ATS_PROVIDER from .env and uses the
//   matching config block below to know which endpoints
//   and credentials to use.
//
// How to add a new ATS provider:
//   1. Add a new block below following the same pattern.
//   2. Add the credentials to .env
//   3. Set ATS_PROVIDER=yournewprovider in .env
// =============================================================

require('dotenv').config();

const ATS_CONFIGS = {

  // -----------------------------------------------------------
  // MOCK — Runs entirely on local dummy data.
  // Use this when no ATS credentials are available.
  // All API calls will return data from /data/mock/*.json
  // -----------------------------------------------------------
  mock: {
    name: 'Mock ATS (Demo Mode)',
    baseUrl: null,
    authType: 'none',
    // No credentials needed for mock mode
  },

  // -----------------------------------------------------------
  // BULLHORN
  // Auth: OAuth 2.0 (get token first, then use REST API)
  // Docs: https://bullhorn.github.io/rest-api-docs/
  //
  // Flow:
  //   Step 1: POST to AUTH_URL with client credentials
  //   Step 2: Exchange code for access token at TOKEN_URL
  //   Step 3: Use token + REST_URL for all data requests
  //
  // Key endpoints you will use:
  //   GET  {REST_URL}/search/JobOrder    → Jobs list
  //   GET  {REST_URL}/search/Candidate   → Candidates
  //   GET  {REST_URL}/entity/JobOrder/ID → Single job
  //   POST {REST_URL}/entity/Note        → Write note back
  // -----------------------------------------------------------
  bullhorn: {
    name: 'Bullhorn',
    authUrl: process.env.BULLHORN_AUTH_URL,
    tokenUrl: process.env.BULLHORN_TOKEN_URL,
    baseUrl: process.env.BULLHORN_REST_URL,
    clientId: process.env.BULLHORN_CLIENT_ID,
    clientSecret: process.env.BULLHORN_CLIENT_SECRET,
    username: process.env.BULLHORN_USERNAME,
    password: process.env.BULLHORN_PASSWORD,
    authType: 'oauth2',

    // Field mappings — map ATS field names to our app field names
    // Change these if your Bullhorn instance uses different fields
    fields: {
      jobId: 'id',
      jobTitle: 'title',
      jobStatus: 'status',
      jobClient: 'clientCorporation',
      jobLocation: 'address',
      candidateId: 'id',
      candidateName: 'name',
      candidateEmail: 'email',
      candidatePhone: 'phone',
      // UDF field name that stores JobID on AI Engaged candidates
      // Change customText1 to whatever your Bullhorn admin named it
      aiJobIdUdf: process.env.AI_ENGAGED_JOB_UDF_FIELD || 'customText1',
      // UDF field name that stores Applicant or Candidate category
      aiTypeUdf: process.env.AI_ENGAGED_TYPE_FIELD || 'customText2',
    },
  },

  // -----------------------------------------------------------
  // CEIPAL
  // Auth: API Key in header
  // Docs: https://developer.ceipal.com
  //
  // Flow:
  //   Include header: Authorization: Bearer YOUR_API_KEY
  //   All requests go to CEIPAL_BASE_URL
  //
  // Key endpoints you will use:
  //   GET  /jobs          → Jobs list
  //   GET  /candidates    → Candidates
  //   POST /notes         → Write note back
  // -----------------------------------------------------------
  ceipal: {
    name: 'Ceipal',
    baseUrl: process.env.CEIPAL_BASE_URL,
    apiKey: process.env.CEIPAL_API_KEY,
    authType: 'apikey',
    fields: {
      jobId: 'job_id',
      jobTitle: 'job_title',
      jobStatus: 'job_status',
      jobClient: 'client_name',
      candidateId: 'candidate_id',
      candidateName: 'candidate_name',
      candidateEmail: 'email_id',
      candidatePhone: 'phone_number',
      aiJobIdUdf: process.env.AI_ENGAGED_JOB_UDF_FIELD || 'custom_field_1',
      aiTypeUdf: process.env.AI_ENGAGED_TYPE_FIELD || 'custom_field_2',
    },
  },

  // -----------------------------------------------------------
  // JOBDIVA
  // JobDiva V2 Swagger contracts verified against the published
  // API documentation.
  // -----------------------------------------------------------
  jobdiva: {
    name: 'JobDiva',
    baseUrl: process.env.JOBDIVA_BASE_URL || 'https://api.jobdiva.com',
    clientId: process.env.JOBDIVA_CLIENT_ID,
    username: process.env.JOBDIVA_USERNAME,
    password: process.env.JOBDIVA_PASSWORD,
    authType: 'jobdiva-v2',
    endpoints: {
      // CandidateActionsUsingGET belongs to V1 DataRetrieval.
      // Leave unset until the V1 Swagger parameter schema is exported.
      candidateActions: process.env.JOBDIVA_CANDIDATE_ACTIONS_ENDPOINT,
      jobsListByUser: '/apiv2/bi/JobsListByUser',
      jobsDetail: '/apiv2/bi/JobsDetail',
      jobDetail: '/apiv2/bi/JobDetail',
      jobsContacts: '/apiv2/bi/JobsContacts',
      jobsInternalUsers: '/apiv2/bi/JobsInternalUsersDetail',
      newUpdatedJobRecords: '/apiv2/bi/NewUpdatedJobRecords',
      jobsStatusHistory: '/apiv2/bi/JobsStatusHistory',
      newUpdatedJobUserRecords: '/apiv2/bi/NewUpdatedJobUserRecords',
      jobSubmittals: '/apiv2/bi/JobsSubmittalsDetail',
      candidatesDetail: '/apiv2/bi/CandidatesDetail',
      candidatesProfileDetail: '/apiv2/bi/CandidatesProfileDetail',
      candidateResumesDetail: '/apiv2/bi/CandidateResumesDetail',
      candidateNotes: '/apiv2/bi/CandidateNotesListDetail',
      candidateAttachments: '/apiv2/bi/CandidateAttachmentList',
    },
    fields: {
      jobId: 'jobId',
      jobTitle: 'jobTitle',
      jobStatus: 'jobStatus',
      jobClient: 'companyName',
      jobDescription: 'jobDescription',
      jobPostingDescription: 'postingDescription',
      jobSkills: 'skills',
      jobPriority: 'priority',
      jobType: 'positionType',
      jobStartDate: 'startDate',
      jobEndDate: 'endDate',
      jobOpenings: 'positions',
      jobPayRateMin: 'payRateMin',
      jobPayRateMax: 'payRateMax',
      jobPayRatePer: 'payRatePer',
      jobRequiredDegree: 'requiredDegree',
      jobRequiredMajor: 'requiredMajor',
      jobExperience: 'experience',
      candidateId: 'candidateId',
      candidateName: 'name',
      candidateEmail: 'email',
      candidatePhone: 'phoneCell',
      candidateTitle: 'title',
      candidateCompany: 'companyName',
      candidateSkills: 'skills',
      aiJobIdUdf: process.env.AI_ENGAGED_JOB_UDF_FIELD || 'CUSTOMFIELD1',
      aiTypeUdf: process.env.AI_ENGAGED_TYPE_FIELD || 'CUSTOMFIELD2',
    },
  },

  // -----------------------------------------------------------
  // LEVER
  // Auth: Basic Auth with API key as username, empty password
  // Docs: https://hire.lever.co/developer/documentation
  //
  // Flow:
  //   Use Basic Auth: btoa(API_KEY + ':')
  //   All requests go to LEVER_BASE_URL
  //
  // Key endpoints you will use:
  //   GET  /postings      → Jobs list
  //   GET  /candidates    → Candidates
  //   POST /notes         → Write note back
  // -----------------------------------------------------------
  lever: {
    name: 'Lever',
    baseUrl: process.env.LEVER_BASE_URL,
    apiKey: process.env.LEVER_API_KEY,
    authType: 'basic',
    fields: {
      jobId: 'id',
      jobTitle: 'text',
      jobStatus: 'state',
      jobClient: 'team',
      candidateId: 'id',
      candidateName: 'name',
      candidateEmail: 'emails',
      candidatePhone: 'phones',
      aiJobIdUdf: process.env.AI_ENGAGED_JOB_UDF_FIELD || 'customField1',
      aiTypeUdf: process.env.AI_ENGAGED_TYPE_FIELD || 'customField2',
    },
  },
};

// Export the active ATS config based on .env setting
const activeProvider = (process.env.ATS_PROVIDER || 'mock').trim().toLowerCase()
const activeConfig = ATS_CONFIGS[activeProvider];

if (!activeConfig) {
  console.error(`❌ Unknown ATS_PROVIDER: "${activeProvider}". Check .env file.`);
  process.exit(1);
}

console.log(`✅ ATS Provider: ${activeConfig.name}`);

module.exports = {
  active: activeConfig,
  provider: activeProvider,
  all: ATS_CONFIGS,
};
