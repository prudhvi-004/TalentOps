// =============================================================
// ATS SERVICE — ats.service.js
// =============================================================
// JobDiva integration uses the documented Swagger V2 contracts.
// Verified contracts used here:
//   GET  /apiv2/v2/authenticate
//   GET  /apiv2/jobdiva/quickJobSearch
//   POST /apiv2/jobdiva/SearchJob
//   GET  /apiv2/bi/JobsDetail
//   GET  /apiv2/bi/JobDetail
//   GET  /apiv2/bi/CandidateResumesDetail
//   GET  /apiv2/bi/ResumesTextDetail
//   GET  /apiv2/bi/CandidateAttachmentList
//   GET  /apiv2/bi/CandidateNotesListDetail
//   GET  /apiv2/bi/CandidateDetail
//   GET  /apiv2/jobdiva/quickCandidateProfileSearch
//   POST /apiv2/jobdiva/searchCandidateProfile
//   GET  /apiv2/jobdiva/CandidateApplicationsList
//   GET  /apiv2/jobdiva/CandidatesApplicationsList
//   GET  /apiv2/bi/JobsSubmittalsDetail
//   POST /apiv2/jobdiva/createCandidateNote
//   POST /apiv2/jobdiva/addCandidateNoteAction
//
// CandidateActionsUsingGET is a Version 1 DataRetrieval operation.
// The public Swagger shell exposes the operation name, but the exact
// generated parameter contract is not exposed by the static HTML/web
// index we can retrieve. It is therefore NOT guessed here.
// =============================================================

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { active: config, provider } = require('../config/ats.config');
const requestContext = require('./request-context');

function currentJobDivaUserId() {
  const user = requestContext.currentUser();
  const id = user && user.jobdivaUserId;
  if (!id || !/^\d+$/.test(String(id))) throw new Error('The authenticated TalentOps user is missing a valid JobDiva USERID.');
  return Number(id);
}

function loadMockData(filename) {
  const filePath = path.join(__dirname, '../../data', filename);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`⚠️ Mock data file not found: ${filename}. Returning empty array.`);
    return [];
  }
}

let authToken = null;
let tokenExpiry = 0;
const jobActivityCache = new Map();
const JOB_ACTIVITY_CACHE_MS = 60 * 1000;

function requireJobDivaConfig() {
  if (!config.baseUrl || !config.clientId || !config.username || !config.password) {
    throw new Error('JobDiva requires JOBDIVA_BASE_URL, JOBDIVA_CLIENT_ID, JOBDIVA_USERNAME and JOBDIVA_PASSWORD');
  }
}

function apiBase(pathname) {
  return `${config.baseUrl.replace(/\/$/, '')}${pathname}`;
}

function withQuery(pathname, params = {}) {
  const url = new URL(apiBase(pathname));
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(v => url.searchParams.append(key, v));
    } else {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function unwrap(data) {
  if (data == null) return data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.Result)) return data.Result;
  if (data.Result !== undefined) return data.Result;
  if (Array.isArray(data.result)) return data.result;
  if (data.result !== undefined) return data.result;
  if (Array.isArray(data.data)) return data.data;
  if (data.data !== undefined) return data.data;
  return data;
}

/*
 * JobDiva's BI/Data APIs can return tabular data in this form:
 *
 *   data: [
 *     ["id", "jobTitle", "companyName", ...],
 *     [123, "Engineer", "Acme", ...],
 *     ...
 *   ]
 *
 * The first row is the column/header row.  The old implementation
 * passed those arrays directly into normalizeJob(), which meant
 * raw.jobTitle, raw.companyName, etc. were undefined.  That is the
 * reason the Jobs screen displayed "UNDEFINED".
 *
 * This helper converts both tabular and object responses into objects.
 */
function rowsToObjects(value) {
  if (!Array.isArray(value) || value.length === 0) return value;

  // Already an array of objects.
  if (!Array.isArray(value[0])) return value;

  const headers = value[0].map(h => String(h ?? '').trim());
  if (!headers.some(Boolean)) return value;

  return value.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      if (header) obj[header] = row[index];
    });
    return obj;
  });
}

function getRows(data) {
  return rowsToObjects(unwrap(data));
}

async function parseResponse(response) {
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* bare token/string */ }
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    const err = new Error(`JobDiva API ${response.status}: ${detail}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

async function getAuthToken(force = false) {
  if (provider === 'mock') return 'MOCK_TOKEN';
  if (provider !== 'jobdiva') return null;

  requireJobDivaConfig();
  if (!force && authToken && tokenExpiry && Date.now() < tokenExpiry) return authToken;

  const url = withQuery('/apiv2/v2/authenticate', {
    clientid: config.clientId,
    username: config.username,
    password: config.password,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: '*/*' },
  });

  const data = await parseResponse(response);
  const token = typeof data === 'string'
    ? data.trim()
    : (data?.token || data?.Token || data?.Result?.token || data?.Result);

  if (!token) {
    throw new Error('JobDiva authentication succeeded but no token was returned');
  }

  authToken = token;
  tokenExpiry = Date.now() + (30 * 60 * 1000);
  return authToken;
}

async function requestJobDiva(pathname, options = {}, retry = true) {
  const token = await getAuthToken();
  const headers = {
    Accept: 'application/json',
    Authorization: token,
    ...(options.headers || {}),
  };

  const response = await fetch(apiBase(pathname), { ...options, headers });

  if ((response.status === 401 || response.status === 403) && retry) {
    authToken = null;
    tokenExpiry = 0;
    return requestJobDiva(pathname, options, false);
  }

  return parseResponse(response);
}

async function requestJobDivaGet(pathname, params = {}) {
  const token = await getAuthToken();
  const url = withQuery(pathname, params);
  let response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: token },
  });

  if (response.status === 401 || response.status === 403) {
    authToken = null;
    tokenExpiry = 0;
    const freshToken = await getAuthToken(true);
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: freshToken },
    });
  }

  return parseResponse(response);
}

function firstDefined(raw, keys, fallback = undefined) {
  for (const key of keys) {
    if (raw && raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
      return raw[key];
    }
  }
  return fallback;
}

function normalizeStatus(value) {
  if (value === undefined || value === null || value === '') return 'open';

  const numeric = Number(value);
  if (Number.isInteger(numeric)) {
    return ({
      0: 'open',
      1: 'onhold',
      2: 'filled',
      3: 'closed',
      4: 'closed',
      5: 'closed',
      6: 'closed',
    })[numeric] || String(value).toLowerCase();
  }

  const text = String(value).trim().toLowerCase();
  if (text.includes('hold')) return 'onhold';
  if (text.includes('fill')) return 'filled';
  if (text.includes('cancel') || text.includes('close') || text.includes('expire')) return 'closed';
  return 'open';
}

function normalizePriority(value) {
  if (value === undefined || value === null || value === '') return 'medium';

  const text = String(value).trim().toLowerCase();
  if (text === 'a' || text === 'high' || text === '1') return 'high';
  if (text === 'd' || text === 'low' || text === '4') return 'low';
  return 'medium';
}

function buildLocation(raw) {
  const explicit = firstDefined(raw, [
    'location', 'LOCATION', 'combinedLocation', 'CombinedLocation'
  ]);
  if (explicit) return String(explicit);

  return [
    firstDefined(raw, ['city', 'CITY', 'postingCity', 'POSTINGCITY']),
    firstDefined(raw, ['state', 'STATE', 'postingState', 'POSTINGSTATE']),
    firstDefined(raw, ['zipCode', 'zipcode', 'ZIPCODE', 'postingZipCode', 'POSTINGZIPCODE']),
    firstDefined(raw, ['country', 'COUNTRY', 'postingCountry', 'POSTINGCOUNTRY']),
  ].filter(Boolean).join(', ');
}

function buildSalary(raw) {
  const explicit = firstDefined(raw, [
    'salary', 'SALARY', 'salaryRange', 'SALARYRANGE',
    'payRate', 'PAYRATE', 'billRate', 'BILLRATE'
  ]);
  if (explicit) return String(explicit);

  const min = firstDefined(raw, [
    'payRateMin', 'payratemin', 'PAYRATEMIN',
    'requiredPayRangeFrom', 'REQUIREDPAYRANGEFROM',
    'billRateMin', 'billratemin', 'BILLRATEMIN'
  ]);
  const max = firstDefined(raw, [
    'payRateMax', 'payratemax', 'PAYRATEMAX',
    'requiredPayRangeTo', 'REQUIREDPAYRANGETO',
    'billRateMax', 'billratemax', 'BILLRATEMAX'
  ]);
  const unit = firstDefined(raw, [
    'payRatePer', 'payrateper', 'PAYRATEPER',
    'requiredPayRangePer', 'REQUIREDPAYRANGEPER',
    'billRatePer', 'billrateper', 'BILLRATEPER'
  ]);
  const currency = firstDefined(raw, [
    'payRateCurrency', 'payratecurrency', 'PAYRATECURRENCY',
    'billRateCurrency', 'billratecurrency', 'BILLRATECURRENCY'
  ]);

  const numericMin = min !== undefined && min !== null && min !== '' ? Number(min) : null;
  const numericMax = max !== undefined && max !== null && max !== '' ? Number(max) : null;
  const bothZero = numericMin === 0 && numericMax === 0;
  if (bothZero) return '';

  const suffix = [currency, unit].filter(Boolean).join(' / ');
  if (min !== undefined && max !== undefined) {
    return `${min}–${max}${suffix ? ` / ${suffix}` : ''}`;
  }
  if (min !== undefined) return `${min}${suffix ? ` / ${suffix}` : ''}`;
  return '';
}

function splitList(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (item == null) return [];
      if (typeof item === 'object') {
        const v = firstDefined(item, ['name', 'skillName', 'skill', 'value', 'label', 'text']);
        return v ? splitList(v) : [];
      }
      return splitList(String(item));
    });
  }

  return String(value)
    .split(/[,;|\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/~~.*$/, '').trim())
    .filter(Boolean)
    .filter(v => !['null', 'n/a', 'na', 'none'].includes(String(v).trim().toLowerCase()));
}

function unique(values) {
  return [...new Set(values.filter(v => v !== undefined && v !== null && String(v).trim() !== '').map(v => String(v).trim()))];
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function extractRequirementBullets(description) {
  const html = String(description || '');
  if (!html) return [];

  const requirements = [];
  const sectionPattern = /(Technical Requirements|Professional Requirements|Requirements|Qualifications)\s*:?([\s\S]*?)(?=<br\s*\/?\s*>\s*<strong|<strong|$)/gi;
  let match;
  while ((match = sectionPattern.exec(html))) {
    const section = match[2] || '';
    const liMatches = section.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    liMatches.forEach(li => {
      const text = stripHtml(li.replace(/^<li[^>]*>/i, '').replace(/<\/li>$/i, ''));
      if (text) requirements.push(text);
    });
  }

  // Some JobDiva descriptions put requirement bullets in plain text.
  if (!requirements.length) {
    const plain = stripHtml(html);
    const lines = plain.split('\n').map(v => v.trim()).filter(Boolean);
    const start = lines.findIndex(v => /^(technical |professional )?requirements\s*:??$/i.test(v));
    if (start >= 0) {
      for (const line of lines.slice(start + 1)) {
        if (/^(responsibilities|summary|pay transparency|consent to communication)/i.test(line)) break;
        if (/^(?:[-•*]|\d+[.)])\s+/.test(line)) requirements.push(line.replace(/^(?:[-•*]|\d+[.)])\s+/, '').trim());
      }
    }
  }

  return unique(requirements);
}

function buildRequirements(raw) {
  const skills = splitList(firstDefined(raw, [
    'skills', 'SKILLS', 'skillNames', 'SKILLNAMES',
    'requiredSkills', 'REQUIREDSKILLS'
  ]));

  const degree = firstDefined(raw, [
    'requiredDegree', 'REQUIREDDEGREE', 'REQUIRED_DEGREE',
    'criteriaDegree', 'CRITERIADEGREE', 'CRITERIA_DEGREE',
    'degree', 'DEGREE'
  ]);
  const major = firstDefined(raw, [
    'requiredMajor', 'REQUIREDMAJOR', 'REQUIRED_MAJOR',
    'major', 'MAJOR'
  ]);
  const experience = firstDefined(raw, [
    'experience', 'EXPERIENCE', 'experienceLevel', 'EXPERIENCELEVEL',
    'requiredExperience', 'REQUIREDEXPERIENCE'
  ]);
  const certifications = splitList(firstDefined(raw, [
    'certifications', 'CERTIFICATIONS'
  ]));
  const professionalSpecs = splitList(firstDefined(raw, [
    'generalProfSpec', 'GENERAL_PROF_SPEC'
  ]));

  const requirements = [...skills];
  if (degree && String(degree).toLowerCase() !== 'null') requirements.push(`Degree: ${degree}`);
  if (major && String(major).toLowerCase() !== 'null') requirements.push(`Major: ${major}`);
  if (experience !== undefined && experience !== null && experience !== '' && String(experience).toLowerCase() !== 'null') {
    const n = Number(experience);
    requirements.push(Number.isFinite(n) ? `${n} years experience` : `Experience: ${experience}`);
  }
  certifications.forEach(cert => requirements.push(`Certification: ${cert}`));
  professionalSpecs.forEach(spec => requirements.push(spec));

  // In the live JobDiva schema, the actual technical/professional requirements
  // are embedded in JOBDESCRIPTION rather than a standalone requirements field.
  requirements.push(...extractRequirementBullets(firstDefined(raw, [
    'jobDescription', 'JOBDESCRIPTION', 'description', 'DESCRIPTION'
  ], '')));

  return unique(requirements);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function normalizeJob(raw = {}) {
  const id = firstDefined(raw, [
    'jobId', 'JOBID', 'jobID', 'id', 'ID'
  ]);

  const title = firstDefined(raw, [
    'jobTitle', 'JOBTITLE', 'jobtitle',
    'title', 'TITLE', 'postingTitle', 'POSTINGTITLE'
  ], '');

  const company = firstDefined(raw, [
    'companyName', 'COMPANYNAME',
    'companyname', 'company', 'COMPANY',
    'client', 'CLIENT', 'customerName', 'CUSTOMERNAME'
  ], '');

  const description = firstDefined(raw, [
    'jobDescription', 'JOBDESCRIPTION', 'jobdescription',
    'description', 'DESCRIPTION',
    'postingDescription', 'POSTINGDESCRIPTION'
  ], '');

  const postingDescription = firstDefined(raw, [
    'postingDescription', 'POSTINGDESCRIPTION',
    'jobDescription', 'JOBDESCRIPTION', 'description', 'DESCRIPTION'
  ], '');

  const ref = firstDefined(raw, [
    'jobDivaNo', 'JOBDIVANO',
    'jobdivaref', 'JOBDIVAREF',
    'refNo', 'REFNO',
    'optionalref', 'OPTIONALREF'
  ]);

  const postingDateRaw = firstDefined(raw, [
    'postingDate', 'POSTINGDATE',
    'datePosted', 'DATEPOSTED',
    'postDate', 'POSTDATE',
    'issuedDate', 'ISSUEDDATE',
    'dateIssued', 'DATEISSUED'
  ]);

  const createdAtRaw = firstDefined(raw, [
    'dateIssued', 'DATEISSUED',
    'issuedDate', 'ISSUEDDATE',
    'postingDate', 'POSTINGDATE',
    'datePosted', 'DATEPOSTED',
    'createdAt', 'CREATEDAT'
  ]);

  const recruiter = firstDefined(raw, [
    'primaryRecruiterName', 'PRIMARYRECRUITERNAME',
    'primaryRecruiter', 'PRIMARYRECRUITER',
    'recruiter', 'RECRUITER',
    'owner', 'OWNER'
  ], '');

  const requirements = buildRequirements(raw);
  const location = buildLocation(raw);

  return {
    // Canonical fields consumed by the existing frontend.
    id: id !== undefined && id !== null ? String(id) : '',
    atsId: ref ? String(ref) : (id !== undefined && id !== null ? String(id) : ''),
    title: String(title || ''),
    client: String(company || ''),
    industry: firstDefined(raw, [
      'jobCategory', 'JOBCATEGORY', 'JOB_CATEGORY', 'industry', 'INDUSTRY',
      'division', 'DIVISION', 'DIVISIONNAME', 'department', 'DEPARTMENT'
    ], ''),
    location,
    status: normalizeStatus(firstDefined(raw, [
      'jobStatus', 'JOBSTATUS', 'jobstatus',
      'status', 'STATUS'
    ])),
    priority: normalizePriority(firstDefined(raw, [
      'priority', 'PRIORITY', 'jobPriority', 'JOBPRIORITY'
    ])),
    salary: buildSalary(raw),
    hiringManager: firstDefined(raw, [
      'hiringManager', 'HIRINGMANAGER',
      'contactName', 'CONTACTNAME',
      'primaryContactName', 'PRIMARYCONTACTNAME'
    ], '') || [
      firstDefined(raw, ['contactFirstName', 'CONTACTFIRSTNAME'], ''),
      firstDefined(raw, ['contactLastName', 'CONTACTLASTNAME'], '')
    ].filter(Boolean).join(' '),
    description: String(description || ''),
    postingDescription: String(postingDescription || ''),
    requirements,
    primaryRecruiter: recruiter || '',
    createdAt: formatDate(createdAtRaw),
    postingDate: formatDate(postingDateRaw || createdAtRaw),
    postingDateRaw: postingDateRaw || createdAtRaw || '',

    // Additional JobDiva-native information that the UI can use later.
    city: firstDefined(raw, ['city', 'CITY', 'postingCity', 'POSTINGCITY'], ''),
    state: firstDefined(raw, ['state', 'STATE', 'postingState', 'POSTINGSTATE'], ''),
    country: firstDefined(raw, ['country', 'COUNTRY', 'postingCountry', 'POSTINGCOUNTRY'], ''),
    zipCode: firstDefined(raw, ['zipCode', 'zipcode', 'ZIPCODE', 'postingZipCode', 'POSTINGZIPCODE'], ''),
    address1: firstDefined(raw, ['address1', 'ADDRESS1'], ''),
    address2: firstDefined(raw, ['address2', 'ADDRESS2'], ''),
    startDate: firstDefined(raw, ['startDate', 'STARTDATE', 'startdate'], ''),
    endDate: firstDefined(raw, ['endDate', 'ENDDATE', 'enddate'], ''),
    jobType: firstDefined(raw, ['positionType', 'POSITIONTYPE', 'jobType', 'JOBTYPE', 'jobtype'], ''),
    openings: firstDefined(raw, ['positions', 'POSITIONS', 'openings', 'OPENINGS'], ''),
    fills: firstDefined(raw, ['fills', 'FILLS'], ''),
    maxAllowedSubmittals: firstDefined(raw, ['maxAllowedSubmittals', 'MAXALLOWEDSUBMITTALS'], ''),
    remarks: firstDefined(raw, ['remarks', 'REMARKS'], ''),
    submittalInstruction: firstDefined(raw, ['submittalInstruction', 'SUBMITTALINSTRUCTION'], ''),
    dateUpdated: firstDefined(raw, ['dateUpdated', 'DATEUPDATED'], ''),
    createdAtRaw: createdAtRaw || '',
    billRateMin: firstDefined(raw, ['billRateMin', 'BILLRATEMIN'], ''),
    billRateMax: firstDefined(raw, ['billRateMax', 'BILLRATEMAX'], ''),
    billRatePer: firstDefined(raw, ['billRatePer', 'BILLRATEPER', 'BILLFREQUENCY'], ''),
    payRateMin: firstDefined(raw, ['payRateMin', 'PAYRATEMIN'], ''),
    payRateMax: firstDefined(raw, ['payRateMax', 'PAYRATEMAX'], ''),
    payRatePer: firstDefined(raw, ['payRatePer', 'PAYRATEPER', 'PAYFREQUENCY'], ''),
    submittalDue: firstDefined(raw, ['submittalDue', 'SUBMITTAL_DUE'], ''),
    onsiteRemote: firstDefined(raw, ['onsiteRemote', 'ONSITE_REMOTE'], ''),
    remotePercentage: firstDefined(raw, ['remotePercentage', 'REMOTE_PERCENTAGE'], ''),
    maxAllowedSubmittals: firstDefined(raw, ['maxAllowedSubmittals', 'MAXALLOWEDSUBMITTALS'], ''),
    requiredCountry: firstDefined(raw, ['requiredCountry', 'REQUIRED_COUNTRY'], ''),
    requiredState: firstDefined(raw, ['requiredState', 'REQUIRED_STATE'], ''),
    requiredAreaCodes: firstDefined(raw, ['requiredAreaCodes', 'REQUIRED_AREACODES'], ''),
    requiredZipCode: firstDefined(raw, ['requiredZipCode', 'REQUIRED_ZIPCODE'], ''),
    requiredWithin: firstDefined(raw, ['requiredWithin', 'REQUIRED_WITHIN'], ''),
    requiredPayRangeFrom: firstDefined(raw, ['requiredPayRangeFrom', 'REQUIRED_PAYRANGE_FROM'], ''),
    requiredPayRangeTo: firstDefined(raw, ['requiredPayRangeTo', 'REQUIRED_PAYRANGE_TO'], ''),
    requiredPayRangePer: firstDefined(raw, ['requiredPayRangePer', 'REQUIRED_PAYRANGE_PER'], ''),
    requiredMajor: firstDefined(raw, ['requiredMajor', 'REQUIRED_MAJOR'], ''),
    requiredDegree: firstDefined(raw, ['requiredDegree', 'REQUIRED_DEGREE'], ''),
    criteriaDegree: firstDefined(raw, ['criteriaDegree', 'CRITERIA_DEGREE'], ''),
    certifications: splitList(firstDefined(raw, ['certifications', 'CERTIFICATIONS'], [])),
    jobCategory: firstDefined(raw, ['jobCategory', 'JOB_CATEGORY'], ''),
    compliance: {
      references: firstDefined(raw, ['references', 'REFERENCES'], ''),
      travel: firstDefined(raw, ['travel', 'TRAVEL'], ''),
      drugTest: firstDefined(raw, ['drugTest', 'DRUG_TEST'], ''),
      backgroundCheck: firstDefined(raw, ['backgroundCheck', 'BACKGROUND_CHECK'], ''),
      securityClearance: firstDefined(raw, ['securityClearance', 'SECURITY_CLEARANCE'], ''),
      onsiteFlexibility: firstDefined(raw, ['onsiteFlexibility', 'ONSITE_FLEXIBILITY'], ''),
    },
    raw,
  };
}

function normalizeCandidate(raw = {}, jobId = null) {
  const first = firstDefined(raw, ['firstName', 'firstname', 'FIRSTNAME'], '');
  const last = firstDefined(raw, ['lastName', 'lastname', 'LASTNAME'], '');
  const name = firstDefined(raw, ['name', 'NAME', 'candidateName', 'CANDIDATENAME'], [first, last].filter(Boolean).join(' '));
  const skills = splitList(firstDefined(raw, ['skills', 'SKILLS', 'skillNames', 'SKILLNAMES', 'primarySkills']));
  const city = firstDefined(raw, ['city', 'CITY'], '');
  const state = firstDefined(raw, ['state', 'STATE'], '');
  const country = firstDefined(raw, ['country', 'COUNTRY'], '');
  const profile = firstDefined(raw, [
    'profile', 'PROFILE', 'summary', 'SUMMARY', 'description', 'DESCRIPTION',
    'professionalSummary', 'PROFESSIONALSUMMARY'
  ], '');
  const education = firstDefined(raw, [
    'education', 'EDUCATION', 'educationSummary', 'EDUCATIONSUMMARY',
    'degree', 'DEGREE'
  ], '');
  const certifications = splitList(firstDefined(raw, [
    'certifications', 'CERTIFICATIONS', 'certificationNames', 'CERTIFICATIONNAMES'
  ]));
  const experience = firstDefined(raw, [
    'experience', 'EXPERIENCE', 'yearsExperience', 'YEARSEXPERIENCE',
    'totalExperience', 'TOTALEXPERIENCE'
  ], '');
  const resume = firstDefined(raw, [
    'resume', 'RESUME', 'resumeText', 'RESUMETEXT', 'parsedResume', 'PARSEDRESUME'
  ], '');

  return {
    id: firstDefined(raw, ['candidateId', 'candidateID', 'candidateid', 'id', 'ID']),
    jobId: jobId != null ? String(jobId) : firstDefined(raw, ['jobId', 'JOBID', 'jobID']),
    firstName: first,
    lastName: last,
    name: name || 'Unknown Candidate',
    email: firstDefined(raw, ['email', 'EMAIL', 'emailAddress', 'EMAILADDRESS'], ''),
    phone: firstDefined(raw, ['phoneCell', 'PHONECELL', 'cellPhone', 'CELLPHONE', 'phone', 'PHONE', 'homePhone', 'HOMEPHONE', 'workPhone', 'WORKPHONE'], ''),
    title: firstDefined(raw, ['title', 'TITLE', 'jobTitle', 'JOBTITLE'], ''),
    company: firstDefined(raw, ['company', 'COMPANY', 'companyName', 'COMPANYNAME'], ''),
    city,
    state,
    country,
    zipCode: firstDefined(raw, ['zipCode', 'zipcode', 'ZIPCODE', 'zip', 'ZIP'], ''),
    location: [city, state, country].filter(Boolean).join(', '),
    skills,
    status: firstDefined(raw, ['status', 'STATUS', 'candidateStatus', 'CANDIDATESTATUS'], ''),
    experience,
    education: typeof education === 'string' ? education : JSON.stringify(education || ''),
    certifications,
    profile: typeof profile === 'string' ? profile : JSON.stringify(profile || ''),
    resume: typeof resume === 'string' ? resume : JSON.stringify(resume || ''),
    aiJobId: firstDefined(raw, ['aiJobId', 'AIJOBID']),
    aiCategory: firstDefined(raw, ['aiCategory', 'AICATEGORY']),
    aiStage: firstDefined(raw, ['aiStage', 'AISTAGE']),
    aiStageLabel: firstDefined(raw, ['aiStageLabel', 'AISTAGELABEL']),
    aiHistory: [],
    type: firstDefined(raw, ['type', 'TYPE'], 'pipeline'),
    raw,
  };
}

function extractId(raw, keys) {
  const direct = firstDefined(raw, keys);
  if (direct !== undefined && direct !== null && direct !== '') return direct;
  const nested = firstDefined(raw, ['candidate', 'CANDIDATE', 'candidateRecord', 'CANDIDATERECORD']);
  if (nested && typeof nested === 'object') return firstDefined(nested, ['candidateId', 'candidateID', 'id', 'ID']);
  return undefined;
}

function chunk(array, size = 50) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

function indexById(rows, idKeys) {
  const map = new Map();
  for (const row of rows || []) {
    const id = extractId(row, idKeys);
    if (id !== undefined && id !== null && id !== '') map.set(String(id), row);
  }
  return map;
}

async function safeGet(pathname, params) {
  try {
    return await requestJobDivaGet(pathname, params);
  } catch (error) {
    // Enrichment endpoints can be permission-scoped independently in JobDiva.
    // Do not make the entire job/candidate page fail if optional enrichment is unavailable.
    console.warn(`[JobDiva] Optional endpoint ${pathname} unavailable: ${error.message}`);
    return null;
  }
}

// ----------------------------------------------------------
// JOBS
// ----------------------------------------------------------
async function getJobs() {
  if (provider === 'mock') return loadMockData('jobs.json');
  if (provider !== 'jobdiva') throw new Error(`getJobs is not implemented for provider: ${provider}`);

  const recruiterId = currentJobDivaUserId();

  // JobDiva has an exact recruiter filter: JobsListByUser(recruiterId).
  // This is preferable to fetching every open job and filtering locally.
  const listData = await requestJobDivaGet(config.endpoints.jobsListByUser, {
    recruiterId,
  });
  const listRows = getRows(listData) || [];
  const jobIds = unique((Array.isArray(listRows) ? listRows : [listRows]).map(row => extractId(row, [
    'jobId', 'JOBID', 'jobID', 'id', 'ID'
  ])).filter(v => v !== undefined && v !== null && v !== '').map(String));

  if (jobIds.length === 0) return [];

  const jobs = [];
  for (const ids of chunk(jobIds, 50)) {
    const detailData = await requestJobDivaGet(config.endpoints.jobsDetail, { jobIds: ids });
    const detailRows = getRows(detailData) || [];
    jobs.push(...(Array.isArray(detailRows) ? detailRows : [detailRows]));
  }

  // Optional enrichment: contacts and internal users are the JobDiva-native
  // sources for the people attached to a job. They fill the application's
  // "Hiring Manager" and "Primary Recruiter" concepts when those names are
  // not present in JobsDetail itself.
  const [contactsData, usersData] = await Promise.all([
    safeGet(config.endpoints.jobsContacts, { jobIds }),
    safeGet(config.endpoints.jobsInternalUsers, { jobIds }),
  ]);
  const contacts = getRows(contactsData) || [];
  const users = getRows(usersData) || [];
  const contactsByJob = new Map();
  const usersByJob = new Map();

  for (const row of Array.isArray(contacts) ? contacts : [contacts]) {
    const jobId = extractId(row, ['jobId', 'JOBID', 'jobID', 'id', 'ID']);
    if (jobId == null) continue;
    if (!contactsByJob.has(String(jobId))) contactsByJob.set(String(jobId), []);
    contactsByJob.get(String(jobId)).push(row);
  }
  for (const row of Array.isArray(users) ? users : [users]) {
    const jobId = extractId(row, ['jobId', 'JOBID', 'jobID', 'id', 'ID']);
    if (jobId == null) continue;
    if (!usersByJob.has(String(jobId))) usersByJob.set(String(jobId), []);
    usersByJob.get(String(jobId)).push(row);
  }

  const normalizedJobs = jobs.map(raw => {
    const id = extractId(raw, ['jobId', 'JOBID', 'jobID', 'id', 'ID']);
    const job = normalizeJob(raw);
    const jobContacts = contactsByJob.get(String(id)) || [];
    const jobUsers = usersByJob.get(String(id)) || [];

    const contactName = jobContacts.map(c => firstDefined(c, [
      'contactName', 'CONTACTNAME', 'name', 'NAME',
      'fullName', 'FULLNAME'
    ])).find(Boolean);

    const primaryUser = jobUsers.find(u => {
      const role = String(firstDefined(u, ['role', 'ROLE', 'userRole', 'USERROLE'], '')).toLowerCase();
      return role.includes('primary recruit') || role.includes('primary sales');
    }) || jobUsers[0];

    const recruiterName = primaryUser && firstDefined(primaryUser, [
      'userName', 'USERNAME', 'name', 'NAME', 'fullName', 'FULLNAME'
    ]);

    return {
  ...job,

  hiringManager: [
    firstDefined(raw, [
      'CANDIDATEFIRSTNAME',
      'candidateFirstName',
    ]),
    firstDefined(raw, [
      'CANDIDATELASTNAME',
      'candidateLastName',
    ]),
  ]
    .filter(Boolean)
    .join(' '),

  primaryRecruiter: job.primaryRecruiter || recruiterName || '',

  recruiterId:
    primaryUser &&
    firstDefined(
      primaryUser,
      ['userId', 'USERID', 'id', 'ID']
    ),

  contacts: jobContacts,

  assignedUsers: jobUsers,
};
  });

  // The recruiter scope is the authoritative filter. Keep all statuses so
  // the UI's status filter can work with the complete recruiter job set.
  return normalizedJobs;
}

async function getJobById(id) {
  if (provider === 'mock') {
    const jobs = loadMockData('jobs.json');
    return jobs.find(j => String(j.id) === String(id)) || null;
  }
  if (provider !== 'jobdiva') throw new Error(`getJobById is not implemented for provider: ${provider}`);

  const recruiterId = currentJobDivaUserId();

  // Enforce the same recruiter scope on direct job-detail URLs.
  // Otherwise a user could bypass the list filter by typing another Job ID.
  const scopedJobs = await requestJobDivaGet(config.endpoints.jobsListByUser, {
    recruiterId,
  });
  const scopedRows = getRows(scopedJobs) || [];
  const scopedIds = new Set((Array.isArray(scopedRows) ? scopedRows : [scopedRows])
    .map(row => extractId(row, ['jobId', 'JOBID', 'jobID', 'id', 'ID']))
    .filter(v => v !== undefined && v !== null && v !== '')
    .map(String));

  if (!scopedIds.has(String(id))) return null;

  const data = await requestJobDivaGet(config.endpoints.jobDetail, { jobId: Number(id) });
  const rows = getRows(data) || [];
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;

  const job = normalizeJob(row);

  const [contactsData, usersData] = await Promise.all([
    safeGet(config.endpoints.jobsContacts, { jobIds: [id] }),
    safeGet(config.endpoints.jobsInternalUsers, { jobIds: [id] }),
  ]);
  const contacts = getRows(contactsData) || [];
  const users = getRows(usersData) || [];
  const contactRows = Array.isArray(contacts) ? contacts : [contacts];
  const userRows = Array.isArray(users) ? users : [users];
  const contactName = contactRows.map(c => firstDefined(c, ['contactName', 'CONTACTNAME', 'name', 'NAME', 'fullName', 'FULLNAME'])).find(Boolean);
  const primaryUser = userRows.find(u => String(firstDefined(u, ['role', 'ROLE', 'userRole', 'USERROLE'], '')).toLowerCase().includes('primary recruit')) || userRows[0];
  const recruiterName = primaryUser && firstDefined(primaryUser, ['userName', 'USERNAME', 'name', 'NAME', 'fullName', 'FULLNAME']);

  return {
    ...job,
    hiringManager: job.hiringManager || contactName || '',
    primaryRecruiter: job.primaryRecruiter || recruiterName || '',
    recruiterId: primaryUser && firstDefined(primaryUser, ['userId', 'USERID', 'id', 'ID']),
    contacts: contactRows,
    assignedUsers: userRows,
  };
}


// ----------------------------------------------------------
// JOB ACTIVITY / AUDIT TIMELINE
// ----------------------------------------------------------
// JobDiva's BI activity feeds accept a maximum 14-day date range.
// The activity endpoint therefore walks from the job posting date to
// today in <=14-day windows, combines the feeds, and normalizes them
// into a small UI-safe event contract.
function parseActivityDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatJobDivaDate(date) {
  const pad = value => String(value).padStart(2, '0');
  return [
    `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

function activityWindows(startDate, endDate) {
  const windows = [];
  const maxMs = (14 * 24 * 60 * 60 * 1000) - 1000;
  let cursor = new Date(startDate.getTime());

  while (cursor < endDate) {
    const windowEnd = new Date(Math.min(cursor.getTime() + maxMs, endDate.getTime()));
    windows.push({
      fromDate: formatJobDivaDate(cursor),
      toDate: formatJobDivaDate(windowEnd),
    });
    cursor = new Date(windowEnd.getTime() + 1000);
  }

  return windows;
}

function activityRows(data) {
  const rows = getRows(data);
  if (rows == null) return [];
  return Array.isArray(rows) ? rows : [rows];
}

function activityJobId(row) {
  return extractId(row, ['jobId', 'JOBID', 'jobID', 'JOB_ID', 'id', 'ID']);
}

function activityTimestamp(row, keys) {
  return firstDefined(row, keys, '');
}

function activityDisplayName(row) {
  const direct = firstDefined(row, [
    'userName', 'USERNAME', 'fullName', 'FULLNAME', 'name', 'NAME',
    'actorName', 'ACTORNAME', 'changedByName', 'CHANGEDBYNAME'
  ]);
  if (direct) return String(direct);

  const name = [
    firstDefined(row, ['firstName', 'FIRSTNAME']),
    firstDefined(row, ['lastName', 'LASTNAME']),
  ].filter(Boolean).join(' ');
  return name || '';
}

function activityActorId(row) {
  return firstDefined(row, [
    'updatedBy', 'UPDATEDBY', 'changedBy', 'CHANGEDBY',
    'userId', 'USERID', 'actorId', 'ACTORID'
  ]);
}

function resolveActivityUser(row, userById) {
  const direct = activityDisplayName(row);
  if (direct) return direct;

  const actorId = activityActorId(row);
  if (actorId != null && userById.has(String(actorId))) {
    return userById.get(String(actorId));
  }

  return actorId != null && String(actorId).trim() ? `User ${actorId}` : '';
}

function displayStatus(value) {
  if (value == null || value === '') return '';
  const text = String(value).trim().toLowerCase();
  const labels = {
    open: 'Open',
    onhold: 'On Hold',
    'on hold': 'On Hold',
    filled: 'Filled',
    closed: 'Closed',
    cancelled: 'Cancelled',
    canceled: 'Cancelled',
    expired: 'Expired',
    ignored: 'Ignored',
  };
  return labels[text] || String(value).trim();
}

function statusIsOpen(value) {
  return normalizeStatus(value) === 'open';
}

function statusIsClosedOrHold(value) {
  const normalized = normalizeStatus(value);
  return normalized === 'closed' || normalized === 'onhold';
}

function normalizeActivityEvent(event) {
  return {
    id: event.id || `${event.type}:${event.timestamp}:${event.user || ''}:${event.from || ''}:${event.to || ''}`,
    type: event.type,
    label: event.label,
    timestamp: event.timestamp,
    user: event.user || '',
    from: event.from || '',
    to: event.to || '',
    detail: event.detail || '',
  };
}

function dedupeActivityEvents(events) {
  const seen = new Set();
  return events.filter(event => {
    const key = [
      event.type,
      event.timestamp,
      event.user,
      event.from,
      event.to,
      event.detail,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getPagedJobUpdates(fromDate, toDate) {
  const rows = [];
  const pageSize = 100;
  let pageNumber = 1;

  while (pageNumber <= 100) {
    const data = await requestJobDivaGet(config.endpoints.newUpdatedJobRecords, {
      fromDate,
      toDate,
      pageNumber,
      pageSize,
    });
    const pageRows = activityRows(data);
    rows.push(...pageRows);

    if (pageRows.length < pageSize) break;
    pageNumber += 1;
  }

  return rows;
}

// Fetch activity windows in small parallel batches. A job can be open for
// months/years, and JobDiva limits these BI feeds to 14-day ranges. Sequential
// requests make the modal feel unnecessarily slow, while firing every window
// at once can overwhelm the ATS or hit rate limits.
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function getJobActivity(id) {
  if (provider === 'mock') {
    const jobs = loadMockData('jobs.json');
    const job = jobs.find(j => String(j.id) === String(id));
    if (!job) return null;

    const start = parseActivityDate(job.postingDateRaw || job.postingDate || job.createdAt);
    const log = Array.isArray(job.versionLog) ? job.versionLog : [];
    const events = log
      .filter(item => {
        const time = parseActivityDate(item.time);
        return time && (!start || time >= start);
      })
      .map(item => normalizeActivityEvent({
        type: item.type || 'job_updated',
        label: item.action || 'Job updated',
        timestamp: item.time,
        user: item.user || '',
        from: item.from || '',
        to: item.to || '',
        detail: item.detail || '',
      }));

    return {
      jobId: String(id),
      postingDate: start ? start.toISOString() : '',
      events: events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
    };
  }

  if (provider !== 'jobdiva') {
    throw new Error(`getJobActivity is not implemented for provider: ${provider}`);
  }

  const cacheKey = String(id);
  const cached = jobActivityCache.get(cacheKey);
  if (cached && (Date.now() - cached.createdAt) < JOB_ACTIVITY_CACHE_MS) {
    return cached.data;
  }

  // Reuse the same recruiter scope/security check as job detail.
  const job = await getJobById(id);
  if (!job) return null;

  const postingDate = parseActivityDate(job.postingDateRaw || job.createdAtRaw);
  if (!postingDate) {
    throw new Error('Job posting date is unavailable; cannot build job activity history.');
  }

  const now = new Date();
  if (postingDate > now) {
    return { jobId: String(id), postingDate: postingDate.toISOString(), events: [] };
  }

  const windows = activityWindows(postingDate, now);
  // JobDiva limits each BI feed to 14 days. Fetch a few windows concurrently
  // so long-lived jobs load quickly without creating a huge request burst.
  const windowResults = await mapWithConcurrency(windows, 4, async (window) => {
    const [jobUpdatesData, statusData, userData] = await Promise.all([
      getPagedJobUpdates(window.fromDate, window.toDate),
      requestJobDivaGet(config.endpoints.jobsStatusHistory, {
        fromDate: window.fromDate,
        toDate: window.toDate,
      }),
      requestJobDivaGet(config.endpoints.newUpdatedJobUserRecords, {
        fromDate: window.fromDate,
        toDate: window.toDate,
      }),
    ]);

    return {
      jobUpdates: jobUpdatesData,
      statusHistory: activityRows(statusData),
      userRecords: activityRows(userData),
    };
  });

  const allJobUpdates = windowResults.flatMap(result => result.jobUpdates);
  const allStatusHistory = windowResults.flatMap(result => result.statusHistory);
  const allUserRecords = windowResults.flatMap(result => result.userRecords);

  const matchingJobUpdates = allJobUpdates.filter(row => String(activityJobId(row)) === String(id));
  // JobsStatusHistory returns one row per job with a nested STATUS_HISTORY array.
  // Keep the job row whose ID matches — we will unpack the nested array below.
  const matchingStatusHistoryRows = allStatusHistory.filter(row => String(firstDefined(row, ['ID', 'id', 'JOBID', 'jobId'], '')) === String(id));
  const matchingUserRecords = allUserRecords.filter(row => String(activityJobId(row)) === String(id));

  // Build a name lookup from the job's assigned users and user-feed records.
  const userById = new Map();
  for (const row of [...(job.assignedUsers || []), ...matchingUserRecords]) {
    const userId = firstDefined(row, ['userId', 'USERID', 'id', 'ID']);
    const name = activityDisplayName(row);
    if (userId != null && name) userById.set(String(userId), name);
  }

  const events = [];

  // ── 1. Job Posted ───────────────────────────────────────────────────────────
  // Anchor event. We do not fabricate a creator name.
  events.push(normalizeActivityEvent({
    type: 'job_posted',
    label: 'Job Posted',
    timestamp: postingDate.toISOString(),
    user: '',
    detail: 'Job posting created',
  }));

  // ── 2. Status history ───────────────────────────────────────────────────────
  // JobsStatusHistory returns one top-level row per job with a nested
  // STATUS_HISTORY array. Each nested entry has:
  //   UPDATE_DATE      — when the transition happened
  //   ORIGINAL_STATUS  — status before the change
  //   NEW_STATUS       — status after the change
  //   DURATION_MINUTES — time spent in the previous status (informational)
  //
  // We also keep a fallback: if the dedicated STATUS_HISTORY array is empty
  // but NewUpdatedJobRecords shows a DATESTATUSUPDATED, we emit a status event
  // from that snapshot so nothing is silently dropped.
  const statusEventsEmitted = new Set(); // key = `${timestamp_ms}|${to}` to guard duplicates

  for (const jobRow of matchingStatusHistoryRows) {
    const nestedHistory = Array.isArray(jobRow.STATUS_HISTORY) ? jobRow.STATUS_HISTORY : [];
    for (const entry of nestedHistory) {
      const timestamp = parseActivityDate(entry.UPDATE_DATE || entry.update_date);
      if (!timestamp || timestamp < postingDate || timestamp > now) continue;

      const from = displayStatus(entry.ORIGINAL_STATUS || entry.original_status);
      const to   = displayStatus(entry.NEW_STATUS      || entry.new_status);
      if (!to) continue;

      const reopened = from && statusIsClosedOrHold(from) && statusIsOpen(to);

      const dedupKey = `${timestamp.getTime()}|${to}`;
      if (statusEventsEmitted.has(dedupKey)) continue;
      statusEventsEmitted.add(dedupKey);

      // Duration in the previous status (round to nearest hour for display)
      const durationMin = Number(entry.DURATION_MINUTES || entry.duration_minutes || 0);
      let durationDetail = '';
      if (durationMin > 0) {
        if (durationMin < 60) {
          durationDetail = `Previous status held for ${Math.round(durationMin)} min`;
        } else {
          const hours = Math.round(durationMin / 60);
          durationDetail = `Previous status held for ${hours} hr${hours !== 1 ? 's' : ''}`;
        }
      }

      events.push(normalizeActivityEvent({
        type:   reopened ? 'job_reopened' : 'job_status_changed',
        label:  reopened ? 'Job Reopened' : 'Status Changed',
        timestamp: timestamp.toISOString(),
        user:   '',            // JobDiva does not expose actor in STATUS_HISTORY
        from,
        to,
        detail: durationDetail,
      }));
    }
  }

  // ── 3. Job snapshots (NewUpdatedJobRecords) ─────────────────────────────────
  // Each snapshot is a full job record at the moment of a save.
  // Comparing successive snapshots surfaces field-level changes:
  //   • Title
  //   • Priority
  //   • Pay rate (min/max)
  //   • Bill rate (min/max)
  //   • Start / end date
  //   • Openings count
  //
  // DATESTATUSUPDATED on a snapshot acts as a fallback status-change signal
  // when the JobsStatusHistory nested array is empty for that window.
  const snapshots = matchingJobUpdates
    .map(row => ({
      row,
      timestamp: parseActivityDate(firstDefined(row, ['DATEUPDATED', 'dateUpdated'])),
    }))
    .filter(item => item.timestamp && item.timestamp >= postingDate && item.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Helper: produce a concise "before → after" display value for numeric fields
  function rateDetail(label, prev, curr) {
    const p = String(prev ?? '').trim();
    const c = String(curr ?? '').trim();
    if (!p && !c) return null;
    if (!p) return { label, from: '', to: c };
    if (!c) return null;
    if (p === c) return null;
    return { label, from: p, to: c };
  }

  let previousSnapshot = null;
  for (const current of snapshots) {
    const r     = current.row;
    const actor = resolveActivityUser(r, userById);

    // ── 3a. Field-level changes compared to the prior snapshot ──────────────
    if (previousSnapshot) {
      const p = previousSnapshot.row;

      // Title
      const prevTitle = String(firstDefined(p, ['TITLE', 'title', 'JOBTITLE', 'jobTitle'], '') || '');
      const currTitle = String(firstDefined(r, ['TITLE', 'title', 'JOBTITLE', 'jobTitle'], '') || '');
      if (currTitle && prevTitle !== currTitle) {
        events.push(normalizeActivityEvent({
          type: 'job_title_changed', label: 'Title Changed',
          timestamp: current.timestamp.toISOString(), user: actor,
          from: prevTitle, to: currTitle,
        }));
      }

      // Priority  (JobDiva stores "1"=High, "2"=Medium, "3/4"=Low numerically)
      const prevPriority = normalizePriority(firstDefined(p, ['PRIORITY', 'priority'], ''));
      const currPriority = normalizePriority(firstDefined(r, ['PRIORITY', 'priority'], ''));
      if (currPriority && prevPriority !== currPriority) {
        events.push(normalizeActivityEvent({
          type: 'job_priority_changed', label: 'Priority Changed',
          timestamp: current.timestamp.toISOString(), user: actor,
          from: prevPriority, to: currPriority,
        }));
      }

      // Pay rate
      const payMin = rateDetail('Pay Rate Min',
        firstDefined(p, ['PAYRATEMIN', 'payRateMin']),
        firstDefined(r, ['PAYRATEMIN', 'payRateMin']));
      const payMax = rateDetail('Pay Rate Max',
        firstDefined(p, ['PAYRATEMAX', 'payRateMax']),
        firstDefined(r, ['PAYRATEMAX', 'payRateMax']));

      // Bill rate
      const billMin = rateDetail('Bill Rate Min',
        firstDefined(p, ['BILLRATEMIN', 'billRateMin']),
        firstDefined(r, ['BILLRATEMIN', 'billRateMin']));
      const billMax = rateDetail('Bill Rate Max',
        firstDefined(p, ['BILLRATEMAX', 'billRateMax']),
        firstDefined(r, ['BILLRATEMAX', 'billRateMax']));

      // Emit a single "Rate Updated" event per snapshot if any rate changed
      const rateChanges = [payMin, payMax, billMin, billMax].filter(Boolean);
      if (rateChanges.length > 0) {
        // Summarise into a readable detail string, e.g. "Pay $29→$32/hr · Bill $60→$65/hr"
        const summary = rateChanges
          .map(rc => `${rc.label}: ${rc.from ? `$${rc.from} → ` : ''}$${rc.to}`)
          .join(' · ');
        events.push(normalizeActivityEvent({
          type: 'job_rate_changed', label: 'Rate Updated',
          timestamp: current.timestamp.toISOString(), user: actor,
          detail: summary,
        }));
      }

      // Openings count
      const prevOpenings = String(firstDefined(p, ['OPENINGS', 'openings', 'POSITIONS', 'positions'], '') || '');
      const currOpenings = String(firstDefined(r, ['OPENINGS', 'openings', 'POSITIONS', 'positions'], '') || '');
      if (currOpenings && prevOpenings !== currOpenings) {
        events.push(normalizeActivityEvent({
          type: 'job_openings_changed', label: 'Openings Updated',
          timestamp: current.timestamp.toISOString(), user: actor,
          from: prevOpenings, to: currOpenings,
        }));
      }

      // Start date
      const prevStart = String(firstDefined(p, ['STARTDATE', 'startDate'], '') || '');
      const currStart = String(firstDefined(r, ['STARTDATE', 'startDate'], '') || '');
      if (currStart && prevStart !== currStart) {
        events.push(normalizeActivityEvent({
          type: 'job_dates_changed', label: 'Start Date Changed',
          timestamp: current.timestamp.toISOString(), user: actor,
          from: formatDate(prevStart), to: formatDate(currStart),
        }));
      }

      // End date
      const prevEnd = String(firstDefined(p, ['ENDDATE', 'endDate'], '') || '');
      const currEnd = String(firstDefined(r, ['ENDDATE', 'endDate'], '') || '');
      if (currEnd && prevEnd !== currEnd) {
        events.push(normalizeActivityEvent({
          type: 'job_dates_changed', label: 'End Date Changed',
          timestamp: current.timestamp.toISOString(), user: actor,
          from: formatDate(prevEnd), to: formatDate(currEnd),
        }));
      }
    }

    // ── 3b. DATESTATUSUPDATED fallback ───────────────────────────────────────
    // When JobsStatusHistory has no nested entry for this window but the
    // snapshot shows DATESTATUSUPDATED has changed, emit a status event so
    // the transition is not silently lost.
    const statusTs = parseActivityDate(firstDefined(r, ['DATESTATUSUPDATED', 'dateStatusUpdated']));
    const statusVal = displayStatus(firstDefined(r, ['JOBSTATUS', 'jobStatus', 'STATUS', 'status']));
    if (statusTs && statusTs >= postingDate && statusTs <= now && statusVal) {
      const dedupKey = `${statusTs.getTime()}|${statusVal}`;
      if (!statusEventsEmitted.has(dedupKey)) {
        statusEventsEmitted.add(dedupKey);
        const prevStatusVal = previousSnapshot
          ? displayStatus(firstDefined(previousSnapshot.row, ['JOBSTATUS', 'jobStatus', 'STATUS', 'status']))
          : '';
        const reopened = prevStatusVal && statusIsClosedOrHold(prevStatusVal) && statusIsOpen(statusVal);
        events.push(normalizeActivityEvent({
          type:  reopened ? 'job_reopened' : 'job_status_changed',
          label: reopened ? 'Job Reopened'  : 'Status Changed',
          timestamp: statusTs.toISOString(), user: actor,
          from: prevStatusVal, to: statusVal,
        }));
      }
    }

    previousSnapshot = current;
  }

  // ── 4. Recruiter assignments (NewUpdatedJobUserRecords) ─────────────────────
  // The feed returns one row per assigned user.  DATELASTASSIGNED is the
  // timestamp of the most-recent assignment action for that user on this job.
  // PRIMARYRECRUITER=1 marks the primary recruiter role.
  // SALES=1 / PRIMARYSALES=1 marks the sales/account-manager role.
  // Additional role flags ("Account Manager", "Delivery manager",
  // "Recruitment Manager") are also present in the live data.
  //
  // We surface:
  //   • Primary Recruiter assigned / changed
  //   • Non-primary Recruiter assigned
  //   • Sales / Primary Sales assigned
  //   • Named role assigned (Account Manager, Delivery manager, etc.)
  const assignmentRows = matchingUserRecords
    .map(row => {
      const assignedAt = parseActivityDate(firstDefined(row, ['DATELASTASSIGNED', 'dateLastAssigned']));
      const first = firstDefined(row, ['FIRSTNAME', 'firstName'], '');
      const last  = firstDefined(row, ['LASTNAME',  'lastName'],  '');
      const name  = [first, last].filter(Boolean).join(' ') || activityDisplayName(row);
      return {
        row,
        assignedAt,
        name,
        isPrimaryRecruiter: String(firstDefined(row, ['PRIMARYRECRUITER', 'primaryRecruiter'], '0')) === '1',
        isRecruiter:        String(firstDefined(row, ['RECRUITER',        'recruiter'],        '0')) === '1',
        isPrimarySales:     String(firstDefined(row, ['PRIMARYSALES',     'primarySales'],     '0')) === '1',
        isSales:            String(firstDefined(row, ['SALES',            'sales'],            '0')) === '1',
        isAccountManager:   String(firstDefined(row, ['Account Manager'], '0')) === '1',
        isDeliveryManager:  String(firstDefined(row, ['Delivery manager'], '0')) === '1',
        isRecruitmentManager: String(firstDefined(row, ['Recruitment Manager'], '0')) === '1',
      };
    })
    .filter(item => item.assignedAt && item.assignedAt >= postingDate && item.assignedAt <= now && item.name)
    .sort((a, b) => a.assignedAt - b.assignedAt);

  // Track previous primary recruiter so we can detect a handoff
  let previousPrimaryRecruiter = '';
  const seenAssignmentKeys = new Set();

  for (const item of assignmentRows) {
    const { assignedAt, name, isPrimaryRecruiter, isRecruiter,
            isPrimarySales, isSales,
            isAccountManager, isDeliveryManager, isRecruitmentManager } = item;

    // ── Primary Recruiter ─────────────────────────────────────────────────
    if (isPrimaryRecruiter) {
      const key = `primary_recruiter|${name}|${assignedAt.getTime()}`;
      if (!seenAssignmentKeys.has(key)) {
        seenAssignmentKeys.add(key);
        const changed = previousPrimaryRecruiter && previousPrimaryRecruiter !== name;
        events.push(normalizeActivityEvent({
          type:  changed ? 'job_primary_recruiter_changed' : 'job_primary_recruiter_assigned',
          label: changed ? 'Primary Recruiter Changed'     : 'Primary Recruiter Assigned',
          timestamp: assignedAt.toISOString(),
          from: changed ? previousPrimaryRecruiter : '',
          to:   name,
        }));
        previousPrimaryRecruiter = name;
      }
    }

    // ── Non-primary Recruiter ────────────────────────────────────────────
    if (isRecruiter && !isPrimaryRecruiter) {
      const key = `recruiter|${name}|${assignedAt.getTime()}`;
      if (!seenAssignmentKeys.has(key)) {
        seenAssignmentKeys.add(key);
        events.push(normalizeActivityEvent({
          type: 'job_recruiter_assigned', label: 'Recruiter Assigned',
          timestamp: assignedAt.toISOString(),
          to: name,
        }));
      }
    }

    // ── Primary Sales ────────────────────────────────────────────────────
    if (isPrimarySales) {
      const key = `primary_sales|${name}|${assignedAt.getTime()}`;
      if (!seenAssignmentKeys.has(key)) {
        seenAssignmentKeys.add(key);
        events.push(normalizeActivityEvent({
          type: 'job_sales_assigned', label: 'Primary Sales Assigned',
          timestamp: assignedAt.toISOString(),
          to: name,
        }));
      }
    } else if (isSales && !isPrimarySales) {
      const key = `sales|${name}|${assignedAt.getTime()}`;
      if (!seenAssignmentKeys.has(key)) {
        seenAssignmentKeys.add(key);
        events.push(normalizeActivityEvent({
          type: 'job_sales_assigned', label: 'Sales Assigned',
          timestamp: assignedAt.toISOString(),
          to: name,
        }));
      }
    }

    // ── Named role assignments ────────────────────────────────────────────
    const namedRoles = [
      isAccountManager    && 'Account Manager',
      isDeliveryManager   && 'Delivery Manager',
      isRecruitmentManager && 'Recruitment Manager',
    ].filter(Boolean);

    for (const role of namedRoles) {
      const key = `role|${role}|${name}|${assignedAt.getTime()}`;
      if (!seenAssignmentKeys.has(key)) {
        seenAssignmentKeys.add(key);
        events.push(normalizeActivityEvent({
          type: 'job_role_assigned', label: `${role} Assigned`,
          timestamp: assignedAt.toISOString(),
          to: name,
          detail: role,
        }));
      }
    }
  }

  // ── Final: filter, dedupe, sort ──────────────────────────────────────────────
  const filtered = events.filter(event => {
    const timestamp = parseActivityDate(event.timestamp);
    return timestamp && timestamp >= postingDate && timestamp <= now;
  });

  const result = {
    jobId: String(id),
    postingDate: postingDate.toISOString(),
    events: dedupeActivityEvents(filtered)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
  };

  jobActivityCache.set(cacheKey, { createdAt: Date.now(), data: result });
  return result;
}

// ----------------------------------------------------------
// CANDIDATES
// ----------------------------------------------------------
async function getCandidateById(id) {
  if (provider === 'mock') {
    const pipeline = loadMockData('candidates.json');
    const aiEngaged = loadMockData('ai-engaged.json');
    return [...pipeline, ...aiEngaged].find(c => String(c.id) === String(id)) || null;
  }
  if (provider !== 'jobdiva') throw new Error(`getCandidateById is not implemented for provider: ${provider}`);

  const [detailData, profileData, resumeData, notesData, attachmentData] = await Promise.all([
    requestJobDivaGet('/apiv2/bi/CandidateDetail', { candidateId: Number(id) }),
    safeGet(config.endpoints.candidatesProfileDetail, { candidateIds: [id], extendExperience: true }),
    safeGet(config.endpoints.candidateResumesDetail, { candidateId: Number(id) }),
    safeGet(config.endpoints.candidateNotes, { candidateIds: [id] }),
    safeGet(config.endpoints.candidateAttachments, { candidateId: Number(id) }),
  ]);

  const detailRows = getRows(detailData) || [];
  const profileRows = getRows(profileData) || [];
  const resumeRows = getRows(resumeData) || [];
  const base = Array.isArray(detailRows) ? detailRows[0] || {} : detailRows || {};
  const profile = Array.isArray(profileRows) ? profileRows[0] || {} : profileRows || {};
  const resumeRecords = Array.isArray(resumeRows) ? resumeRows : [resumeRows];

  const merged = { ...base, ...profile };
  const candidate = normalizeCandidate(merged);

  // CandidateResumesDetail returns metadata only. Fetch actual text using the
  // RESUMEID values returned by that endpoint.
  const sortedResumes = resumeRecords
    .filter(Boolean)
    .sort((a, b) => new Date(firstDefined(b, ['DATEUPDATED', 'DATECREATED'], 0)) - new Date(firstDefined(a, ['DATEUPDATED', 'DATECREATED'], 0)));
  const resumeIds = unique(sortedResumes.map(r => firstDefined(r, ['RESUMEID', 'resumeId'], '')).filter(Boolean));

  let resumeTexts = [];
  if (resumeIds.length) {
    const textData = await safeGet('/apiv2/bi/ResumesTextDetail', { resumeIds });
    const textRows = getRows(textData) || [];
    resumeTexts = (Array.isArray(textRows) ? textRows : [textRows]).filter(Boolean);
  }

  const textById = new Map(resumeTexts.map(r => [
    String(firstDefined(r, ['GLOBAL_ID', 'RESUMEID', 'resumeId'], '')),
    firstDefined(r, ['PLAINTEXT', 'plainText', 'resumeText', 'RESUMETEXT'], '')
  ]));

  candidate.resumes = sortedResumes.map(record => {
    const resumeId = firstDefined(record, ['RESUMEID', 'resumeId'], '');
    return {
      id: resumeId,
      createdAt: firstDefined(record, ['DATECREATED', 'dateCreated'], ''),
      updatedAt: firstDefined(record, ['DATEUPDATED', 'dateUpdated'], ''),
      firstDownloadedAt: firstDefined(record, ['DATEFIRSTDOWNLOADED', 'dateFirstDownloaded'], ''),
      lastDownloadedAt: firstDefined(record, ['DATELASTDOWNLOADED', 'dateLastDownloaded'], ''),
      text: textById.get(String(resumeId)) || '',
    };
  });

  const latestResume = candidate.resumes.find(r => r.text) || candidate.resumes[0];
  candidate.resume = latestResume?.text || '';
  candidate.resumeId = latestResume?.id || '';

  if (!candidate.profile) {
    candidate.profile = firstDefined(profile, [
      'profile', 'PROFILE', 'summary', 'SUMMARY', 'professionalSummary', 'PROFESSIONALSUMMARY'
    ], '');
  }
  if (!candidate.skills.length) {
    candidate.skills = splitList(firstDefined(profile, ['skills', 'SKILLS', 'skillNames', 'SKILLNAMES']));
  }
  if (!candidate.experience) {
    candidate.experience = firstDefined(profile, ['experience', 'EXPERIENCE', 'yearsExperience', 'YEARSEXPERIENCE'], '');
  }

  // CandidateNotesListDetail returns an object keyed by candidate ID.
  // Some JobDiva environments use a numeric key while others serialize it
  // as a string, so support both forms and also tolerate tabular responses.
  const notesRoot = notesData?.data;
  let notePayload = [];

  if (notesRoot && typeof notesRoot === 'object' && !Array.isArray(notesRoot)) {
    notePayload =
      notesRoot[String(id)] ??
      notesRoot[id] ??
      [];
  } else {
    notePayload = getRows(notesData) || [];
  }

  const noteRows = getRows(notePayload);
  candidate.notes = Array.isArray(noteRows)
    ? noteRows.filter(Boolean)
    : [];

  candidate.notes.sort((a, b) => {
    const dateA = firstDefined(a, ['ACTIONDATE', 'CREATEDATE', 'createdAt', 'DATEUPDATED'], 0);
    const dateB = firstDefined(b, ['ACTIONDATE', 'CREATEDATE', 'createdAt', 'DATEUPDATED'], 0);
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  console.log(`[JobDiva] Candidate ${id}: loaded ${candidate.notes.length} notes`);

  const attachments = getRows(attachmentData) || [];
  candidate.attachments = (Array.isArray(attachments) ? attachments : [attachments]).filter(Boolean);

  candidate.contact = {
    email: candidate.email,
    alternateEmail: firstDefined(base, ['ALTERNATEEMAIL'], ''),
    phones: unique([
      firstDefined(base, ['CELLPHONE'], ''),
      firstDefined(base, ['WORKPHONE'], ''),
      firstDefined(base, ['HOMEPHONE'], ''),
      firstDefined(base, ['PHONE1'], ''),
      firstDefined(base, ['PHONE2'], ''),
      firstDefined(base, ['PHONE3'], ''),
      firstDefined(base, ['PHONE4'], ''),
    ]),
  };

  candidate.salaryDetails = {
    current: firstDefined(base, ['CURRENTSALARY'], ''),
    currentPer: firstDefined(base, ['CURRENTSALARYPER'], ''),
    preferredMinimum: firstDefined(base, ['PREFERREDSALARYMIN'], ''),
    preferredPer: firstDefined(base, ['PREFERREDSALARYPER'], ''),
  };

  candidate.social = {
    linkedin: firstDefined(base, ['LINKEDIN'], ''),
    github: firstDefined(base, ['GITHUB'], ''),
    facebook: firstDefined(base, ['FACEBOOK'], ''),
    twitter: firstDefined(base, ['TWITTER'], ''),
    instagram: firstDefined(base, ['INSTAGRAM'], ''),
    youtube: firstDefined(base, ['YOUTUBE'], ''),
    stackoverflow: firstDefined(base, ['STACKOVERFLOW'], ''),
    professionalWebsite: firstDefined(base, ['PROFESSIONAL_WEBSITE'], ''),
  };

  candidate.type = 'pipeline';
  return candidate;
}

async function searchCandidates(criteria = {}) {
  if (provider === 'mock') return loadMockData('candidates.json');
  if (provider !== 'jobdiva') throw new Error(`searchCandidates is not implemented for provider: ${provider}`);

  const data = await requestJobDiva('/apiv2/jobdiva/searchCandidateProfile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(criteria),
  });
  const rows = getRows(data) || [];
  return (Array.isArray(rows) ? rows : [rows]).map(normalizeCandidate);
}

async function quickSearchCandidates(value, maxReturned = 100) {
  if (provider === 'mock') return loadMockData('candidates.json');
  const data = await requestJobDivaGet('/apiv2/jobdiva/quickCandidateProfileSearch', { value, maxReturned });
  const rows = getRows(data) || [];
  return (Array.isArray(rows) ? rows : [rows]).map(normalizeCandidate);
}

/**
 * Global application search.
 * Searches jobs and candidates without exposing ATS credentials to the browser.
 * Results are intentionally small because this powers the top-bar search UI.
 */
async function searchAll(query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { jobs: [], candidates: [] };

  if (provider === 'mock') {
    const jobs = loadMockData('jobs.json');
    const candidates = loadMockData('candidates.json');
    return {
      jobs: jobs.filter(j => [j.id, j.atsId, j.title, j.client, j.location]
        .some(v => String(v || '').toLowerCase().includes(q))).slice(0, limit),
      candidates: candidates.filter(c => [c.id, c.name, c.email, c.title, c.company, c.location]
        .some(v => String(v || '').toLowerCase().includes(q))).slice(0, limit),
    };
  }

  if (provider !== 'jobdiva') {
    throw new Error(`searchAll is not implemented for provider: ${provider}`);
  }

  const [jobsResult, candidatesResult] = await Promise.allSettled([
    getJobs(),
    quickSearchCandidates(query, Math.max(limit, 8)),
  ]);

  const jobs = jobsResult.status === 'fulfilled'
    ? jobsResult.value.filter(j => [j.id, j.atsId, j.title, j.client, j.location]
        .some(v => String(v || '').toLowerCase().includes(q))).slice(0, limit)
    : [];

  const candidates = candidatesResult.status === 'fulfilled'
    ? candidatesResult.value.slice(0, limit)
    : [];

  return { jobs, candidates };
}

async function getCandidatesForJob(jobId) {
  if (provider === 'mock') {
    return loadMockData('candidates.json').filter(c => String(c.jobId) === String(jobId));
  }
  if (provider !== 'jobdiva') throw new Error(`getCandidatesForJob is not implemented for provider: ${provider}`);

  // JobDiva's live sandbox does not populate JobsApplicantsDetail for these
  // postings. The tested source of the job -> candidate relationship is
  // JobsSubmittalsDetail, keyed by JOBID and CANDIDATEID.
  const submittalsData = await requestJobDivaGet(config.endpoints.jobSubmittals, {
    jobIds: [String(jobId)],
  });
  const submittalRows = getRows(submittalsData) || [];
  const rows = Array.isArray(submittalRows) ? submittalRows : [submittalRows];

  const candidateIds = unique(rows
    .filter(row => String(firstDefined(row, ['JOBID', 'jobId', 'jobID', 'id', 'ID'], '')) === String(jobId))
    .map(row => extractId(row, ['candidateId', 'candidateID', 'candidateid', 'CANDIDATEID']))
    .filter(v => v !== undefined && v !== null && v !== '')
    .map(String));

  if (!candidateIds.length) return [];

  // Keep one canonical candidate card per candidate while preserving every
  // submittal for that candidate so the profile can show application history.
  const submissionsByCandidate = new Map();
  for (const row of rows) {
    const cid = extractId(row, ['candidateId', 'candidateID', 'candidateid', 'CANDIDATEID']);
    if (cid == null || String(firstDefined(row, ['JOBID', 'jobId', 'jobID'], '')) !== String(jobId)) continue;
    const key = String(cid);
    if (!submissionsByCandidate.has(key)) submissionsByCandidate.set(key, []);
    submissionsByCandidate.get(key).push(row);
  }

  const candidates = [];
  for (const ids of chunk(candidateIds, 25)) {
    const details = await Promise.all(ids.map(async candidateId => {
      const [detailData, profileData] = await Promise.all([
        requestJobDivaGet('/apiv2/bi/CandidateDetail', { candidateId: Number(candidateId) }),
        safeGet(config.endpoints.candidatesProfileDetail, {
          candidateIds: [candidateId],
          extendExperience: true,
        }),
      ]);
      const detailRows = getRows(detailData) || [];
      const profileRows = getRows(profileData) || [];
      const detail = Array.isArray(detailRows) ? detailRows[0] || {} : detailRows || {};
      const profile = Array.isArray(profileRows) ? profileRows[0] || {} : profileRows || {};
      return { ...detail, ...profile };
    }));
    candidates.push(...details);
  }

  return candidates.map(raw => {
    const candidateId = extractId(raw, ['candidateId', 'candidateID', 'candidateid', 'id', 'ID']);
    const submissions = submissionsByCandidate.get(String(candidateId)) || [];
    const latest = [...submissions].sort((a, b) =>
      new Date(firstDefined(b, ['DATEUPDATED', 'DATECREATED'], 0)) -
      new Date(firstDefined(a, ['DATEUPDATED', 'DATECREATED'], 0))
    )[0] || {};

    return {
      ...normalizeCandidate(raw, jobId),
      applicationStatus: firstDefined(latest, ['status', 'STATUS', 'applicationStatus', 'APPLICATIONSTATUS', 'submissionStatus', 'SUBMISSIONSTATUS', 'START_STATUS'], ''),
      applicationDate: firstDefined(latest, ['SUBMITTALDATE', 'applicationDate', 'APPLICATIONDATE', 'dateApplied', 'DATEAPPLIED', 'dateSubmitted', 'DATESUBMITTED'], ''),
      submittedBy: firstDefined(latest, ['PRIMARYRECRUITERNAME', 'recruiterName', 'RECRUITERNAME', 'submittedBy', 'SUBMITTEDBY'], ''),
      submittal: normalizeSubmittal(latest),
      submissions: submissions.map(normalizeSubmittal),
      type: 'pipeline',
    };
  });
}

function normalizeSubmittal(raw = {}) {
  const managerFirst = firstDefined(raw, ['MANAGERFIRSTNAME', 'managerFirstName'], '');
  const managerLast = firstDefined(raw, ['MANAGERLASTNAME', 'managerLastName'], '');
  return {
    id: firstDefined(raw, ['ID', 'id'], ''),
    jobId: firstDefined(raw, ['JOBID', 'jobId'], ''),
    candidateId: firstDefined(raw, ['CANDIDATEID', 'candidateId'], ''),
    submittalDate: firstDefined(raw, ['SUBMITTALDATE', 'submittalDate'], ''),
    interviewScheduleDate: firstDefined(raw, ['INTERVIEWSCHEDULEDATE', 'interviewScheduleDate'], ''),
    interviewDate: firstDefined(raw, ['DATEINTERVIEW', 'interviewDate'], ''),
    interviewTimezone: firstDefined(raw, ['INTERVIEW_TIMEZONEID', 'interviewTimezone'], ''),
    placementDate: firstDefined(raw, ['PLACEMENTDATE', 'placementDate'], ''),
    startDate: firstDefined(raw, ['STARTDATE', 'startDate'], ''),
    endDate: firstDefined(raw, ['ENDDATE', 'endDate'], ''),
    hireFlag: firstDefined(raw, ['HIREFLAG', 'hireFlag'], ''),
    startStatus: firstDefined(raw, ['START_STATUS', 'startStatus'], ''),
    rejectionDate: firstDefined(raw, ['REJECTIONDATE', 'rejectionDate'], ''),
    rejectReason: firstDefined(raw, ['REJECTREASON', 'rejectReason'], ''),
    recruiterId: firstDefined(raw, ['PRIMARYRECRUITERID', 'recruiterId'], ''),
    recruiterName: firstDefined(raw, ['PRIMARYRECRUITERNAME', 'recruiterName'], ''),
    salesName: firstDefined(raw, ['PRIMARYSALES', 'salesName'], ''),
    hiringManager: [managerFirst, managerLast].filter(Boolean).join(' '),
    billRate: firstDefined(raw, ['AGREEDBILLRATE', 'billRate'], ''),
    billFrequency: firstDefined(raw, ['BILLFREQUENCY', 'billFrequency'], ''),
    payRate: firstDefined(raw, ['AGREEDPAYRATE', 'payRate'], ''),
    payFrequency: firstDefined(raw, ['PAYFREQUENCY', 'payFrequency'], ''),
    currency: firstDefined(raw, ['CURRENCY', 'currency'], ''),
    interviewType: firstDefined(raw, ['INTERVIEW_TYPE', 'interviewType'], ''),
    notes: firstDefined(raw, ['NOTES', 'notes'], ''),
  };
}

async function getCandidateApplications(candidateId) {
  const data = await requestJobDivaGet('/apiv2/jobdiva/CandidateApplicationsList', { candidateId: Number(candidateId) });
  return getRows(data) || [];
}

async function getCandidatesApplications(candidateIds) {
  const data = await requestJobDivaGet('/apiv2/jobdiva/CandidatesApplicationsList', { candidateIds });
  return getRows(data) || [];
}

async function getCandidatesSubmittals(candidateIds, userFieldsName = []) {
  const data = await requestJobDivaGet('/apiv2/bi/CandidatesSubmittalsDetail', {
    candidateIds,
    userFieldsName,
  });
  return getRows(data) || [];
}

// CandidateActionsUsingGET is a V1 DataRetrieval operation. Keep it
// configurable because the public static Swagger index does not expose
// the generated parameter contract reliably.
async function getCandidateActions(params = {}) {
  if (provider === 'mock') return [];
  if (provider !== 'jobdiva') throw new Error(`getCandidateActions is not implemented for provider: ${provider}`);
  const endpoint = config.endpoints?.candidateActions;
  if (!endpoint) {
    throw new Error('CandidateActionsUsingGET is not configured. Set JOBDIVA_CANDIDATE_ACTIONS_ENDPOINT only after confirming the V1 parameter contract.');
  }
  return requestJobDivaGet(endpoint, params);
}

// ----------------------------------------------------------
// AI ENGAGED
// ----------------------------------------------------------
async function getAIEngagedForJob(jobId) {
  if (provider === 'mock') {
    const aiData = loadMockData('ai-engaged.json');
    const forJob = aiData.filter(c => String(c.aiJobId) === String(jobId));
    return {
      applicants: forJob.filter(c => c.aiCategory === 'Applicant'),
      candidates: forJob.filter(c => c.aiCategory === 'Candidate'),
    };
  }
  // JobDiva UDF search is supported by searchCandidateProfile. The exact
  // UDF names are account-specific and remain configurable.
  const jobField = config.fields.aiJobIdUdf;
  const typeField = config.fields.aiTypeUdf;
  const candidates = await searchCandidates({
    searchForUdfs: [{ udfName: jobField, udfValue: String(jobId) }],
    includeUdfs: [jobField, typeField],
    maxreturned: 100,
    offset: 0,
  });
  return {
    applicants: candidates.filter(c => c.raw?.[typeField] === 'Applicant'),
    candidates: candidates.filter(c => c.raw?.[typeField] === 'Candidate'),
  };
}

// ----------------------------------------------------------
// NOTES
// ----------------------------------------------------------
async function writeNote({
  jobId,
  candidateId,
  noteActionType,
  composedNote
}) {
  if (provider === 'mock') {
    await new Promise(r => setTimeout(r, 100));

    return {
      success: true
    };
  }

  if (provider !== 'jobdiva') {
    throw new Error(
      `writeNote is not implemented for provider: ${provider}`
    );
  }

  /*
   * JobDiva's createCandidateNote `action` value is not an
   * arbitrary string. It must already exist as a Candidate Note
   * Action in the JobDiva account.
   *
   * Our UI action types (for example `Rec – Sense AI`) are intended
   * to become real JobDiva note action types so that the action is
   * stored in ACTIONTYPE and is displayed by JobDiva as the note
   * heading.
   *
   * Register the selected action first. The endpoint is idempotent
   * for our purposes: if the action already exists, JobDiva may
   * return an error such as duplicate/already-exists. In that case
   * we continue and let createCandidateNote use the existing action.
   *
   * This fixes the previous failure where createCandidateNote was
   * called directly with an action that had never been registered,
   * producing:
   *   Invalid Action Type(Rec – Sense AI)
   */
  const cleanActionType = String(noteActionType || '').trim();

  if (cleanActionType) {
    try {
      // JobDiva documents `typeName` as a QUERY parameter for
      // addCandidateNoteAction, not as a JSON request body.
      // IMPORTANT: requestJobDiva() accepts an API *path*, not the
      // absolute URL returned by withQuery(). Passing the latter would
      // cause apiBase() to prepend JOBDIVA_BASE_URL a second time, so
      // the action-registration request never reached JobDiva.
      //
      // Keep this as a relative API path and let encodeURIComponent()
      // safely carry spaces / the en-dash in action names such as
      // "Rec – Sense AI".
      const actionRegistrationPath =
        '/apiv2/jobdiva/addCandidateNoteAction?typeName=' +
        encodeURIComponent(cleanActionType);

      await requestJobDiva(
        actionRegistrationPath,
        {
          method: 'POST'
        }
      );

      console.log(
        `[JobDiva] Candidate note action ensured: ${cleanActionType}`
      );
    } catch (actionErr) {
      // The action may already exist. Do not turn an idempotent
      // ensure operation into a write failure. The subsequent
      // createCandidateNote call is the authoritative check.
      console.warn(
        `[JobDiva] Could not register note action \"${cleanActionType}\": ${actionErr.message}. ` +
        'Continuing with createCandidateNote.'
      );
    }
  }

  const payload = {
    candidateid: Number(candidateId),

    note: composedNote,

    // Must match a registered JobDiva Candidate Note Action.
    action: cleanActionType || undefined,

    recruiterid: currentJobDivaUserId(),

    link2AnOpenJob:
      jobId
        ? Number(jobId)
        : undefined,

    setAsAuto: false,
  };

  /*
   * Remove undefined properties before sending to JobDiva.
   */
  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  console.log(
    '[JobDiva] Creating candidate note:',
    {
      candidateId,
      jobId,
      noteActionType,
      payload: {
        ...payload,
        note: '[note text present]'
      }
    }
  );

  const data =
    await requestJobDiva(
      '/apiv2/jobdiva/createCandidateNote',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body:
          JSON.stringify(payload),
      }
    );

  return {
    success: true,
    data
  };
}

module.exports = {
  getAuthToken,
  getJobs,
  getJobById,
  getJobActivity,
  getCandidatesForJob,
  getCandidateById,
  searchCandidates,
  quickSearchCandidates,
  searchAll,
  getCandidateApplications,
  getCandidatesApplications,
  getCandidatesSubmittals,
  getCandidateActions,
  getAIEngagedForJob,
  writeNote,
};


