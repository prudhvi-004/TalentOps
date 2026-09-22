/**
 * ============================================================
 * JOBDIVA AI APPLICANTS / AI CANDIDATES
 * COMPLETE API DIAGNOSTIC
 * ============================================================
 *
 * PURPOSE
 * -------
 * Determine exactly where the JobDiva application gets:
 *
 *   1. Job information
 *   2. Candidate information
 *   3. Candidate <-> Job relationship
 *   4. Applicant / Candidate classification
 *   5. Candidate UDFs
 *   6. Job UDFs
 *   7. Application records
 *   8. Submittal records
 *
 * IMPORTANT
 * ---------
 * This script is READ-ONLY.
 *
 * It does NOT:
 *
 *   - create candidates
 *   - update candidates
 *   - create jobs
 *   - update jobs
 *   - create notes
 *   - update notes
 *
 * ============================================================
 */


/* ============================================================
 * NODE MODULES
 * ============================================================
 */

const https = require('https');


/* ============================================================
 * CONFIGURATION
 * ============================================================
 *
 * OPTION 1 — use environment variables
 *
 *   JOBDIVA_BASE_URL
 *   JOBDIVA_CLIENT_ID
 *   JOBDIVA_USERNAME
 *   JOBDIVA_PASSWORD
 *   JOBDIVA_TEST_JOB_ID
 *   JOBDIVA_TEST_CANDIDATE_ID
 *
 *
 * OPTION 2 — temporarily put values directly below.
 *
 * NEVER send credentials back to me.
 *
 * ============================================================
 */

const CONFIG = {

  /*
   * IMPORTANT:
   *
   * Use the SAME base URL used by your existing application.
   *
   * Example:
   *
   * https://api.jobdiva.com
   */

  baseUrl:
    process.env.JOBDIVA_BASE_URL ||
    'https://api.jobdiva.com',


  /*
   * JobDiva Client ID.
   */

  clientId:
    process.env.JOBDIVA_CLIENT_ID ||
    '',


  /*
   * JobDiva username.
   */

  username:
    process.env.JOBDIVA_USERNAME ||
    '',


  /*
   * JobDiva password.
   */

  password:
    process.env.JOBDIVA_PASSWORD ||
    '',


  /*
   * ----------------------------------------------------------
   * TEST JOB
   * ----------------------------------------------------------
   *
   * IMPORTANT:
   *
   * 25-00011 looks like it may be a JobDiva REFERENCE NUMBER
   * rather than the internal numeric Job ID.
   *
   * We therefore use it first in quickJobSearch.
   *
   * If your existing UI is using another job, replace this
   * with that job's value.
   */

  jobId:
    process.env.JOBDIVA_TEST_JOB_ID ||
    '25-00011',


  /*
   * Optional known candidate.
   *
   * If you know a candidate associated with the test job,
   * put the candidate ID here.
   *
   * Otherwise leave blank.
   */

  candidateId:
    process.env.JOBDIVA_TEST_CANDIDATE_ID ||
    '',


  /*
   * Maximum number of records to request.
   */

  maxReturned: 100

};


/* ============================================================
 * AUTH TOKEN
 * ============================================================
 */

let authToken = null;


/* ============================================================
 * RESULT OBJECT
 * ============================================================
 */

const result = {

  diagnostic:
    'JobDiva AI Applicants/Candidates complete diagnostic',

  timestamp:
    new Date().toISOString(),

  configuration: {

    baseUrl:
      CONFIG.baseUrl,

    testJobValue:
      CONFIG.jobId,

    candidateIdProvided:
      Boolean(
        CONFIG.candidateId
      )

  },

  authentication: {

    attempted:
      false,

    successful:
      false

  },

  tests: [],

  discoveries: {

    quickJobSearch: [],

    userfields: [],

    jobDetails: [],

    candidateDetails: [],

    applications: [],

    submittals: [],

    candidateProfiles: []

  },

  conclusions: []

};


/* ============================================================
 * SANITIZE OUTPUT
 * ============================================================
 *
 * Never expose credentials or authentication tokens.
 * ============================================================
 */

function sanitize(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return value;

  }


  if (
    typeof value === 'string'
  ) {

    return value;

  }


  if (
    Array.isArray(value)
  ) {

    return value.map(
      sanitize
    );

  }


  if (
    typeof value === 'object'
  ) {

    const output = {};


    for (
      const [
        key,
        item
      ]
      of Object.entries(value)
    ) {

      const lower =
        String(key)
          .toLowerCase();


      if (

        lower.includes('password') ||

        lower.includes('authorization') ||

        lower.includes('access_token') ||

        lower === 'token' ||

        lower === 'clientsecret' ||

        lower === 'secret'

      ) {

        output[key] =
          '[REDACTED]';

      }

      else {

        output[key] =
          sanitize(item);

      }

    }


    return output;

  }


  return value;

}


/* ============================================================
 * GENERIC HTTPS REQUEST
 * ============================================================
 */

function request({

  method = 'GET',

  path,

  query = {},

  body = null,

  headers = {}

}) {

  return new Promise(
    (resolve, reject) => {

      const base =
        CONFIG.baseUrl
          .replace(/\/+$/, '');


      const url =
        new URL(
          base + path
        );


      /*
       * Add query parameters.
       */

      for (
        const [
          key,
          value
        ]
        of Object.entries(query)
      ) {

        if (
          value === undefined ||
          value === null ||
          value === ''
        ) {

          continue;

        }


        /*
         * Support arrays:
         *
         * jobIds=123
         * jobIds=456
         */

        if (
          Array.isArray(value)
        ) {

          for (
            const item
            of value
          ) {

            url.searchParams.append(
              key,
              item
            );

          }

        }

        else {

          url.searchParams.append(
            key,
            value
          );

        }

      }


      const payload =
        body === null
          ? null
          : JSON.stringify(body);


      const req =
        https.request(

          url,

          {

            method,

            headers: {

              Accept:
                'application/json',

              'Content-Type':
                'application/json',

              ...headers

            }

          },

          response => {

            let raw = '';


            response.on(
              'data',
              chunk => {

                raw += chunk;

              }
            );


            response.on(
              'end',
              () => {

                let parsed;


                try {

                  parsed =
                    raw
                      ? JSON.parse(raw)
                      : null;

                }

                catch {

                  parsed =
                    raw;

                }


                resolve({

                  status:
                    response.statusCode,

                  headers:
                    response.headers,

                  data:
                    parsed

                });

              }
            );

          }

        );


      req.on(
        'error',
        reject
      );


      if (
        payload
      ) {

        req.write(
          payload
        );

      }


      req.end();

    }
  );

}


/* ============================================================
 * JOBDIVA AUTHENTICATION
 * ============================================================
 *
 * JobDiva V2:
 *
 * GET /apiv2/v2/authenticate
 *
 * Parameters:
 *
 *   clientid
 *   username
 *   password
 *
 * ============================================================
 */

async function authenticate() {

  console.log(
    '\n[AUTH] Authenticating with JobDiva...'
  );


  result.authentication.attempted =
    true;


  /*
   * Validate credentials before making request.
   */

  if (
    !CONFIG.clientId ||
    !CONFIG.username ||
    !CONFIG.password
  ) {

    throw new Error(

      [
        'Missing JobDiva credentials.',
        '',
        'Required environment variables:',
        '',
        'JOBDIVA_CLIENT_ID',
        'JOBDIVA_USERNAME',
        'JOBDIVA_PASSWORD',
        '',
        'OR put the credentials directly into CONFIG.'

      ].join('\n')

    );

  }


  /*
   * Authentication request.
   */

  const response =
    await request({

      method:
        'GET',

      path:
        '/apiv2/v2/authenticate',

      query: {

        clientid:
          CONFIG.clientId,

        username:
          CONFIG.username,

        password:
          CONFIG.password

      }

    });


  if (
    response.status !== 200
  ) {

    throw new Error(

      [
        'JobDiva authentication failed.',

        `HTTP status: ${response.status}`,

        `Response: ${JSON.stringify(
          sanitize(
            response.data
          ),
          null,
          2
        )}`

      ].join('\n')

    );

  }


  /*
   * JobDiva may return the authentication value either as
   * a raw response value or as an object.
   */

  if (
    typeof response.data === 'string'
  ) {

    authToken =
      response.data
        .trim();

  }

  else if (
    response.data &&
    typeof response.data === 'object'
  ) {

    authToken =

      response.data.token ||

      response.data.access_token ||

      response.data.accessToken ||

      response.data.authentication ||

      response.data.Authorization ||

      response.data.authorization;

  }


  /*
   * If the authentication response is still not recognized,
   * keep the raw sanitized response in the diagnostic.
   */

  if (
    !authToken
  ) {

    result.authentication.response =
      sanitize(
        response.data
      );


    throw new Error(

      [
        'JobDiva authentication returned HTTP 200,',
        'but the script could not identify the authentication token.',
        '',
        'Sanitized authentication response:',
        JSON.stringify(
          sanitize(
            response.data
          ),
          null,
          2
        )

      ].join('\n')

    );

  }


  /*
   * Remove accidental quotes.
   */

  authToken =
    String(authToken)
      .trim()
      .replace(
        /^["']|["']$/g,
        ''
      );


  result.authentication.successful =
    true;


  console.log(
    '[AUTH] Authentication successful.'
  );

}


/* ============================================================
 * AUTHENTICATED REQUEST
 * ============================================================
 */

async function jdRequest(options) {

  if (
    !authToken
  ) {

    throw new Error(
      'No JobDiva authentication token is available.'
    );

  }


  return request({

    ...options,

    headers: {

      ...(options.headers || {}),

      /*
       * JobDiva authenticated V2 request.
       */

      Authorization:
        authToken

    }

  });

}


/* ============================================================
 * EXTRACT ROWS
 * ============================================================
 */

function extractRows(data) {

  if (!data) {

    return [];

  }


  if (
    Array.isArray(data)
  ) {

    return data;

  }


  if (
    Array.isArray(data.data)
  ) {

    return data.data;

  }


  if (
    Array.isArray(data.rows)
  ) {

    return data.rows;

  }


  if (
    Array.isArray(data.results)
  ) {

    return data.results;

  }


  if (
    Array.isArray(data.items)
  ) {

    return data.items;

  }


  if (
    data.data &&
    typeof data.data === 'object'
  ) {

    return [
      data.data
    ];

  }


  if (
    typeof data === 'object'
  ) {

    return [
      data
    ];

  }


  return [];

}


/* ============================================================
 * GET ALL KEYS
 * ============================================================
 */

function keysOfRows(rows) {

  const keys =
    new Set();


  for (
    const row
    of rows
  ) {

    if (
      row &&
      typeof row === 'object'
    ) {

      Object.keys(row)
        .forEach(
          key =>
            keys.add(key)
        );

    }

  }


  return [
    ...keys
  ];

}


/* ============================================================
 * FIND INTERESTING KEYS
 * ============================================================
 */

function interestingKeys(rows) {

  const keys =
    keysOfRows(rows);


  return keys.filter(
    key => {

      const lower =
        String(key)
          .toLowerCase();


      return (

        lower.includes('ai') ||

        lower.includes('job') ||

        lower.includes('candidate') ||

        lower.includes('applicant') ||

        lower.includes('application') ||

        lower.includes('submitt') ||

        lower.includes('status') ||

        lower.includes('stage') ||

        lower.includes('userfield') ||

        lower.includes('udf') ||

        lower.includes('recruit') ||

        lower.includes('userid') ||

        lower.includes('user_id') ||

        lower.includes('owner') ||

        lower.includes('assigned')

      );

    }
  );

}


/* ============================================================
 * RECORD TEST RESULT
 * ============================================================
 */

function recordTest(
  name,
  response,
  extra = {}
) {

  const rows =
    extractRows(
      response?.data
    );


  result.tests.push({

    test:
      name,

    status:
      response?.status ??
      null,

    rowCount:
      rows.length,

    ...extra,

    keys:
      keysOfRows(rows),

    interestingKeys:
      interestingKeys(rows),

    response:
      sanitize(
        response?.data
      )

  });


  return rows;

}


/* ============================================================
 * TEST 1
 *
 * QUICK JOB SEARCH
 *
 * This is particularly important because:
 *
 * 25-00011
 *
 * may be a JobDiva reference number rather than an internal
 * Job ID.
 *
 * ============================================================
 */

async function testQuickJobSearch() {

  console.log(
    '[1] quickJobSearch...'
  );


  const variants = [

    {

      name:
        'quickJobSearch_value',

      query: {

        value:
          CONFIG.jobId,

        maxReturned:
          10

      }

    },

    {

      name:
        'quickJobSearch_jobDivaRef',

      query: {

        jobdivaref:
          CONFIG.jobId,

        maxReturned:
          10

      }

    },

    {

      name:
        'quickJobSearch_jobDivaRefs',

      query: {

        jobdivarefs:
          CONFIG.jobId,

        maxReturned:
          10

      }

    }

  ];


  for (
    const variant
    of variants
  ) {

    try {

      const response =
        await jdRequest({

          method:
            'GET',

          path:
            '/apiv2/jobdiva/quickJobSearch',

          query:
            variant.query

        });


      const rows =
        recordTest(

          variant.name,

          response,

          {

            request:
              variant.query

          }

        );


      if (
        rows.length
      ) {

        result.discoveries.quickJobSearch.push(
          ...rows
        );

      }

    }

    catch (error) {

      result.tests.push({

        test:
          variant.name,

        error:
          String(
            error.message ||
            error
          )

      });

    }

  }

}


/* ============================================================
 * TEST 2
 *
 * USERFIELDSLIST
 * ============================================================
 */

async function testUserfieldsList() {

  console.log(
    '[2] UserfieldsList...'
  );


  const variants = [

    {

      name:
        'UserfieldsList',

      query: {}

    },

    {

      name:
        'UserfieldsList_Candidate',

      query: {

        objectType:
          'Candidate'

      }

    },

    {

      name:
        'UserfieldsList_Candidate_lowercase',

      query: {

        objecttype:
          'Candidate'

      }

    },

    {

      name:
        'UserfieldsList_entityCandidate',

      query: {

        entity:
          'Candidate'

      }

    }

  ];


  let foundRows = [];


  for (
    const variant
    of variants
  ) {

    try {

      const response =
        await jdRequest({

          method:
            'GET',

          path:
            '/apiv2/bi/UserfieldsList',

          query:
            variant.query

        });


      const rows =
        recordTest(

          variant.name,

          response,

          {

            request:
              variant.query

          }

        );


      if (
        rows.length &&
        !foundRows.length
      ) {

        foundRows =
          rows;

      }

    }

    catch (error) {

      result.tests.push({

        test:
          variant.name,

        error:
          String(
            error.message ||
            error
          )

      });

    }

  }


  result.discoveries.userfields =
    foundRows;


  return foundRows;

}


/* ============================================================
 * TEST 3
 *
 * JOB DETAIL
 *
 * Uses jobIds.
 * ============================================================
 */

async function testJobsDetail() {

  console.log(
    '[3] JobsDetail...'
  );


  const response =
    await jdRequest({

      method:
        'GET',

      path:
        '/apiv2/bi/JobsDetail',

      query: {

        jobIds:
          CONFIG.jobId

      }

    });


  const rows =
    recordTest(

      'JobsDetail',

      response,

      {

        request: {

          jobIds:
            CONFIG.jobId

        }

      }

    );


  result.discoveries.jobDetails =
    rows;


  return rows;

}


/* ============================================================
 * TEST 4
 *
 * JOB DETAIL WITH UDF NAMES
 *
 * We extract recognizable names from UserfieldsList and
 * request them through JobsDetail.
 * ============================================================
 */

function getUdfNames(
  rows
) {

  const names = [];


  const possibleKeys = [

    'USERFIELDNAME',

    'userFieldName',

    'USER_FIELD_NAME',

    'FIELDNAME',

    'fieldName',

    'FIELD_NAME',

    'NAME',

    'name',

    'LABEL',

    'label',

    'DISPLAYNAME',

    'displayName'

  ];


  for (
    const row
    of rows
  ) {

    if (
      !row ||
      typeof row !== 'object'
    ) {

      continue;

    }


    for (
      const key
      of possibleKeys
    ) {

      if (

        row[key] !== undefined &&

        row[key] !== null &&

        String(
          row[key]
        ).trim()

      ) {

        names.push(
          String(
            row[key]
          ).trim()
        );


        break;

      }

    }

  }


  /*
   * Remove duplicates.
   */

  return [
    ...new Set(names)
  ];

}


async function testJobsDetailWithUdfs(
  userfields
) {

  console.log(
    '[4] JobsDetail with discovered UDFs...'
  );


  const udfNames =
    getUdfNames(
      userfields
    );


  if (
    !udfNames.length
  ) {

    result.tests.push({

      test:
        'JobsDetailWithDiscoveredUdfs',

      skipped:
        true,

      reason:
        'UserfieldsList did not expose a recognizable UDF name field.'

    });


    return;

  }


  /*
   * Keep the request manageable.
   */

  const requestedUdfs =
    udfNames.slice(
      0,
      100
    );


  const response =
    await jdRequest({

      method:
        'GET',

      path:
        '/apiv2/bi/JobsDetail',

      query: {

        jobIds:
          CONFIG.jobId,

        userFieldsName:
          requestedUdfs

      }

    });


  const rows =
    recordTest(

      'JobsDetailWithDiscoveredUdfs',

      response,

      {

        request: {

          jobIds:
            CONFIG.jobId,

          userFieldsName:
            requestedUdfs

        }

      }

    );


  result.discoveries.jobDetails =
    rows;


  return rows;

}


/* ============================================================
 * TEST 5
 *
 * CANDIDATESDETAIL
 * ============================================================
 */

async function testCandidatesDetail() {

  console.log(
    '[5] CandidatesDetail...'
  );


  const response =
    await jdRequest({

      method:
        'GET',

      path:
        '/apiv2/bi/CandidatesDetail',

      query: {

        udfName:
          '*'

      }

    });


  const rows =
    recordTest(

      'CandidatesDetailWildcard',

      response,

      {

        request: {

          udfName:
            '*'

        }

      }

    );


  result.discoveries.candidateDetails =
    rows;


  return rows;

}


/* ============================================================
 * TEST 6
 *
 * CANDIDATE APPLICATIONS
 * ============================================================
 */

async function testCandidateApplications() {

  console.log(
    '[6] CandidateApplicationsList...'
  );


  const variants = [

    {

      name:
        'CandidateApplicationsList_jobId',

      path:
        '/apiv2/jobdiva/CandidateApplicationsList',

      query: {

        jobId:
          CONFIG.jobId,

        maxReturned:
          CONFIG.maxReturned

      }

    },

    {

      name:
        'CandidateApplicationsList_jobID',

      path:
        '/apiv2/jobdiva/CandidateApplicationsList',

      query: {

        jobID:
          CONFIG.jobId,

        maxReturned:
          CONFIG.maxReturned

      }

    },

    {

      name:
        'CandidateApplicationsList_jobIds',

      path:
        '/apiv2/jobdiva/CandidateApplicationsList',

      query: {

        jobIds:
          CONFIG.jobId,

        maxReturned:
          CONFIG.maxReturned

      }

    }

  ];


  for (
    const variant
    of variants
  ) {

    try {

      const response =
        await jdRequest({

          method:
            'GET',

          path:
            variant.path,

          query:
            variant.query

        });


      const rows =
        recordTest(

          variant.name,

          response,

          {

            request:
              variant.query

          }

        );


      if (
        rows.length
      ) {

        result.discoveries.applications.push(
          ...rows
        );

      }

    }

    catch (error) {

      result.tests.push({

        test:
          variant.name,

        error:
          String(
            error.message ||
            error
          )

      });

    }

  }

}


/* ============================================================
 * TEST 7
 *
 * CANDIDATES APPLICATIONS
 * ============================================================
 */

async function testCandidatesApplications() {

  console.log(
    '[7] CandidatesApplicationsList...'
  );


  const variants = [

    {

      name:
        'CandidatesApplicationsList_jobId',

      query: {

        jobId:
          CONFIG.jobId,

        maxReturned:
          CONFIG.maxReturned

      }

    },

    {

      name:
        'CandidatesApplicationsList_jobID',

      query: {

        jobID:
          CONFIG.jobId,

        maxReturned:
          CONFIG.maxReturned

      }

    },

    {

      name:
        'CandidatesApplicationsList_jobIds',

      query: {

        jobIds:
          CONFIG.jobId,

        maxReturned:
          CONFIG.maxReturned

      }

    }

  ];


  for (
    const variant
    of variants
  ) {

    try {

      const response =
        await jdRequest({

          method:
            'GET',

          path:
            '/apiv2/jobdiva/CandidatesApplicationsList',

          query:
            variant.query

        });


      const rows =
        recordTest(

          variant.name,

          response,

          {

            request:
              variant.query

          }

        );


      if (
        rows.length
      ) {

        result.discoveries.applications.push(
          ...rows
        );

      }

    }

    catch (error) {

      result.tests.push({

        test:
          variant.name,

        error:
          String(
            error.message ||
            error
          )

      });

    }

  }

}


/* ============================================================
 * TEST 8
 *
 * JOB SUBMITTALS
 * ============================================================
 */

async function testJobSubmittals() {

  console.log(
    '[8] JobsSubmittalsDetail...'
  );


  const variants = [

    {

      name:
        'JobsSubmittalsDetail_jobIds',

      query: {

        jobIds:
          CONFIG.jobId

      }

    },

    {

      name:
        'JobsSubmittalsDetail_jobId',

      query: {

        jobId:
          CONFIG.jobId

      }

    },

    {

      name:
        'JobsSubmittalsDetail_jobid',

      query: {

        jobid:
          CONFIG.jobId

      }

    }

  ];


  for (
    const variant
    of variants
  ) {

    try {

      const response =
        await jdRequest({

          method:
            'GET',

          path:
            '/apiv2/bi/JobsSubmittalsDetail',

          query:
            variant.query

        });


      const rows =
        recordTest(

          variant.name,

          response,

          {

            request:
              variant.query

          }

        );


      if (
        rows.length
      ) {

        result.discoveries.submittals.push(
          ...rows
        );

      }

    }

    catch (error) {

      result.tests.push({

        test:
          variant.name,

        error:
          String(
            error.message ||
            error
          )

      });

    }

  }

}


/* ============================================================
 * TEST 9
 *
 * CANDIDATE PROFILE
 * ============================================================
 */

async function testCandidateProfile() {

  console.log(
    '[9] searchCandidateProfile...'
  );


  if (
    !CONFIG.candidateId
  ) {

    result.tests.push({

      test:
        'searchCandidateProfile',

      skipped:
        true,

      reason:
        'No JOBDIVA_TEST_CANDIDATE_ID supplied.'

    });


    return;

  }


  const response =
    await jdRequest({

      method:
        'POST',

      path:
        '/apiv2/jobdiva/searchCandidateProfile',

      body: {

        searchForCandidateId:
          CONFIG.candidateId

      }

    });


  const rows =
    recordTest(

      'searchCandidateProfile',

      response,

      {

        request: {

          searchForCandidateId:
            CONFIG.candidateId

        }

      }

    );


  result.discoveries.candidateProfiles =
    rows;


  return rows;

}


/* ============================================================
 * TEST 10
 *
 * CANDIDATE APPLICATION HISTORY
 * ============================================================
 */

async function testCandidateApplicationHistory() {

  console.log(
    '[10] Candidate application history...'
  );


  if (
    !CONFIG.candidateId
  ) {

    result.tests.push({

      test:
        'CandidateApplications_candidateId',

      skipped:
        true,

      reason:
        'No JOBDIVA_TEST_CANDIDATE_ID supplied.'

    });


    return;

  }


  const variants = [

    {

      name:
        'CandidateApplications_candidateId',

      query: {

        candidateId:
          CONFIG.candidateId

      }

    },

    {

      name:
        'CandidateApplications_candidateID',

      query: {

        candidateID:
          CONFIG.candidateId

      }

    }

  ];


  for (
    const variant
    of variants
  ) {

    try {

      const response =
        await jdRequest({

          method:
            'GET',

          path:
            '/apiv2/jobdiva/CandidateApplicationsList',

          query:
            variant.query

        });


      const rows =
        recordTest(

          variant.name,

          response,

          {

            request:
              variant.query

          }

        );


      if (
        rows.length
      ) {

        result.discoveries.applications.push(
          ...rows
        );

      }

    }

    catch (error) {

      result.tests.push({

        test:
          variant.name,

        error:
          String(
            error.message ||
            error
          )

      });

    }

  }

}


/* ============================================================
 * FIND VALUE BY KEY PATTERN
 * ============================================================
 */

function findValuesByPattern(
  rows,
  patterns
) {

  const matches = [];


  for (
    const row
    of rows
  ) {

    if (
      !row ||
      typeof row !== 'object'
    ) {

      continue;

    }


    for (
      const [
        key,
        value
      ]
      of Object.entries(row)
    ) {

      const lowerKey =
        String(key)
          .toLowerCase();


      const matched =
        patterns.some(
          pattern =>
            lowerKey.includes(
              pattern
            )
        );


      if (
        matched
      ) {

        matches.push({

          key,

          value:
            sanitize(value)

        });

      }

    }

  }


  return matches;

}


/* ============================================================
 * ANALYSIS
 * ============================================================
 */

function analyze() {

  const applications =
    result.discoveries.applications;


  const submittals =
    result.discoveries.submittals;


  const userfields =
    result.discoveries.userfields;


  const jobDetails =
    result.discoveries.jobDetails;


  const candidateDetails =
    result.discoveries.candidateDetails;


  const quickJobs =
    result.discoveries.quickJobSearch;


  /*
   * ----------------------------------------------------------
   * JOB SEARCH
   * ----------------------------------------------------------
   */

  if (
    quickJobs.length
  ) {

    result.conclusions.push({

      finding:
        'JOB_FOUND_BY_QUICK_SEARCH',

      count:
        quickJobs.length,

      possibleJobIdFields:
        findValuesByPattern(

          quickJobs,

          [
            'jobid',
            'job_id',
            'jobdiva',
            'id'
          ]

        ),

      possibleReferenceFields:
        findValuesByPattern(

          quickJobs,

          [
            'ref',
            'reference'
          ]

        )

    });

  }


  /*
   * ----------------------------------------------------------
   * USERFIELDS
   * ----------------------------------------------------------
   */

  if (
    userfields.length
  ) {

    result.conclusions.push({

      finding:
        'USERFIELDS_AVAILABLE',

      count:
        userfields.length,

      names:
        getUdfNames(
          userfields
        )

    });

  }

  else {

    result.conclusions.push({

      finding:
        'USERFIELDS_NOT_DISCOVERED',

      explanation:
        'UserfieldsList did not return recognizable UDF metadata.'

    });

  }


  /*
   * ----------------------------------------------------------
   * JOB DETAIL
   * ----------------------------------------------------------
   */

  if (
    jobDetails.length
  ) {

    result.conclusions.push({

      finding:
        'JOB_DETAIL_AVAILABLE',

      count:
        jobDetails.length,

      interestingValues:
        findValuesByPattern(

          jobDetails,

          [

            'ai',
            'userfield',
            'udf',
            'recruit',
            'assigned',
            'owner',
            'candidate',
            'applicant'

          ]

        )

    });

  }


  /*
   * ----------------------------------------------------------
   * CANDIDATE DETAIL
   * ----------------------------------------------------------
   */

  if (
    candidateDetails.length
  ) {

    result.conclusions.push({

      finding:
        'CANDIDATE_DETAIL_AVAILABLE',

      count:
        candidateDetails.length,

      interestingValues:
        findValuesByPattern(

          candidateDetails,

          [

            'ai',
            'userfield',
            'udf',
            'job',
            'candidate',
            'applicant',
            'application',
            'status',
            'stage'

          ]

        )

    });

  }


  /*
   * ----------------------------------------------------------
   * APPLICATIONS
   * ----------------------------------------------------------
   */

  if (
    applications.length
  ) {

    result.conclusions.push({

      finding:
        'APPLICATION_RECORDS_FOUND',

      count:
        applications.length,

      interestingValues:
        findValuesByPattern(

          applications,

          [

            'candidate',
            'job',
            'application',
            'applicant',
            'status',
            'stage',
            'applied',
            'recruit'

          ]

        ),

      recommendation:
        'Investigate application records as the primary Candidate <-> Job relationship.'

    });

  }


  /*
   * ----------------------------------------------------------
   * SUBMITTALS
   * ----------------------------------------------------------
   */

  if (
    submittals.length
  ) {

    result.conclusions.push({

      finding:
        'SUBMITTAL_RECORDS_FOUND',

      count:
        submittals.length,

      interestingValues:
        findValuesByPattern(

          submittals,

          [

            'candidate',
            'job',
            'submit',
            'status',
            'stage',
            'recruit'

          ]

        ),

      recommendation:
        'Inspect submittal records to determine whether they represent the required assigned-candidate relationship.'

    });

  }


  /*
   * ----------------------------------------------------------
   * FINAL DECISION
   * ----------------------------------------------------------
   */

  if (
    applications.length
  ) {

    result.conclusions.push({

      decision:
        'PRIMARY_SOURCE_CANDIDATE_APPLICATIONS',

      reason:
        'Application records were returned. These should be investigated first because they directly represent a candidate/job relationship.'

    });

  }

  else if (
    submittals.length
  ) {

    result.conclusions.push({

      decision:
        'PRIMARY_SOURCE_JOB_SUBMITTALS',

      reason:
        'No application records were returned, but JobDiva returned submittal records for the job.'

    });

  }

  else if (
    userfields.length
  ) {

    result.conclusions.push({

      decision:
        'PRIMARY_SOURCE_CANDIDATE_OR_JOB_UDFS',

      reason:
        'No direct application/submittal relationship was found, so the UDF metadata needs to be inspected for the AI Applicant/Candidate mapping.'

    });

  }

  else {

    result.conclusions.push({

      decision:
        'NO_CONFIRMED_AI_SOURCE_YET',

      reason:
        'The tested endpoints did not expose a confirmed AI Applicant/Candidate relationship.'

    });

  }

}


/* ============================================================
 * MAIN
 * ============================================================
 */

async function main() {

  console.log(
    '\n============================================'
  );

  console.log(
    'JOBDIVA AI APPLICANTS / CANDIDATES'
  );

  console.log(
    'COMPLETE API DIAGNOSTIC'
  );

  console.log(
    '============================================\n'
  );


  console.log(
    `Base URL: ${CONFIG.baseUrl}`
  );


  console.log(
    `Test Job Value: ${CONFIG.jobId}`
  );


  console.log(
    `Candidate ID supplied: ${
      CONFIG.candidateId
        ? 'YES'
        : 'NO'
    }`
  );


  /*
   * ==========================================================
   * AUTHENTICATION
   * ==========================================================
   */

  try {

    await authenticate();

  }

  catch (error) {

    result.authentication.successful =
      false;

    result.authentication.error =
      String(
        error.message ||
        error
      );


    console.log(
      '\n============================================'
    );

    console.log(
      'AUTHENTICATION FAILED'
    );

    console.log(
      '============================================\n'
    );


    /*
     * IMPORTANT:
     *
     * Print sanitized output only.
     */

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );


    process.exit(
      1
    );

  }


  /*
   * ==========================================================
   * API TESTS
   * ==========================================================
   */

  try {

    /*
     * 1
     */
    await testQuickJobSearch();


    /*
     * 2
     */
    const userfields =
      await testUserfieldsList();


    /*
     * 3
     */
    await testJobsDetail();


    /*
     * 4
     */
    await testJobsDetailWithUdfs(
      userfields
    );


    /*
     * 5
     */
    await testCandidatesDetail();


    /*
     * 6
     */
    await testCandidateApplications();


    /*
     * 7
     */
    await testCandidatesApplications();


    /*
     * 8
     */
    await testJobSubmittals();


    /*
     * 9
     */
    await testCandidateProfile();


    /*
     * 10
     */
    await testCandidateApplicationHistory();


    /*
     * Analyze all results.
     */

    analyze();


    /*
     * ========================================================
     * FINAL JSON
     * ========================================================
     */

    console.log(
      '\n\n============================================'
    );

    console.log(
      'FINAL DIAGNOSTIC JSON'
    );

    console.log(
      '============================================\n'
    );


    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

  }

  catch (error) {

    result.conclusions.push({

      decision:
        'DIAGNOSTIC_EXECUTION_ERROR',

      error:
        String(
          error.stack ||
          error
        )

    });


    console.log(
      '\n============================================'
    );

    console.log(
      'DIAGNOSTIC ERROR'
    );

    console.log(
      '============================================\n'
    );


    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );


    process.exit(
      1
    );

  }

}


/* ============================================================
 * RUN
 * ============================================================
 */

main();