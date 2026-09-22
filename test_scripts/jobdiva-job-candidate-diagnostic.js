/**
 * JobDiva Job -> Candidate Relationship Diagnostic
 *
 * READ ONLY
 *
 * Tests the three JobDiva endpoints that can potentially
 * establish the relationship:
 *
 *   JOB
 *    |
 *    +--> JobsApplicantsDetail
 *    |
 *    +--> JobsSubmittalsDetail
 *    |
 *    +--> InterestedCandidateInJobs
 *
 * The script:
 *
 *   1. Authenticates
 *   2. Gets recruiter-scoped jobs
 *   3. Extracts all job IDs
 *   4. Tests all 3 endpoints against ALL jobs
 *   5. Extracts possible candidate IDs
 *   6. Saves raw responses
 *
 * Output:
 *
 *   jobdiva-job-candidate-diagnostic.json
 *
 * Run:
 *
 *   node jobdiva-job-candidate-diagnostic.js
 */

require("dotenv").config();

const fs = require("fs");


// ============================================================
// CONFIGURATION
// ============================================================

const BASE_URL = (
  process.env.JOBDIVA_BASE_URL ||
  "https://api.jobdiva.com"
).replace(/\/+$/, "");

const CLIENT_ID =
  process.env.JOBDIVA_CLIENT_ID;

const USERNAME =
  process.env.JOBDIVA_USERNAME;

const PASSWORD =
  process.env.JOBDIVA_PASSWORD;

const RECRUITER_ID =
  process.env.JOBDIVA_RECRUITER_ID;

const OUTPUT =
  "jobdiva-job-candidate-diagnostic.json";


// ============================================================
// RESULT OBJECT
// ============================================================

const results = {

  generatedAt:
    new Date().toISOString(),

  recruiterId:
    RECRUITER_ID || null,

  authentication: null,

  jobsList: null,

  endpoints: {

    JobsApplicantsDetail: [],

    JobsSubmittalsDetail: [],

    InterestedCandidateInJobs: []

  },

  summary: {

    jobsReturned: 0,

    endpointResults: {}

  }

};


// ============================================================
// LOGGING
// ============================================================

function log(message = "") {

  console.log(message);

}


function header(message) {

  console.log(
    "\n" +
    "=".repeat(80)
  );

  console.log(message);

  console.log(
    "=".repeat(80)
  );

}


// ============================================================
// HTTP
// ============================================================

async function getJson(
  path,
  token
) {

  const headers = {

    Accept:
      "application/json"

  };


  if (token) {

    headers.Authorization =
      token;

  }


  const response =
    await fetch(

      `${BASE_URL}${path}`,

      {

        method: "GET",

        headers

      }

    );


  const text =
    await response.text();


  let data;


  try {

    data =
      JSON.parse(text);

  }

  catch {

    data =
      text;

  }


  return {

    status:
      response.status,

    data

  };

}


// ============================================================
// TOKEN EXTRACTION
// ============================================================

function extractToken(data) {

  if (
    typeof data === "string"
  ) {

    return data;

  }


  if (
    !data ||
    typeof data !== "object"
  ) {

    return null;

  }


  return (

    data.token ||

    data.access_token ||

    data.accessToken ||

    data.data?.token ||

    data.data?.access_token ||

    data.data?.accessToken ||

    null

  );

}


// ============================================================
// AUTHENTICATION
// ============================================================

async function authenticate() {

  header(
    "1. AUTHENTICATION"
  );


  if (
    !CLIENT_ID ||
    !USERNAME ||
    !PASSWORD
  ) {

    throw new Error(

      "Missing JOBDIVA_CLIENT_ID, " +
      "JOBDIVA_USERNAME or " +
      "JOBDIVA_PASSWORD in .env"

    );

  }


  const params =
    new URLSearchParams({

      clientid:
        CLIENT_ID,

      username:
        USERNAME,

      password:
        PASSWORD

    });


  const path =
    `/apiv2/v2/authenticate?${params}`;


  const response =
    await getJson(
      path,
      null
    );


  const token =
    extractToken(
      response.data
    );


  results.authentication = {

    status:
      response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    tokenPresent:
      Boolean(token)

  };


  log(
    `Authentication HTTP ${response.status}`
  );


  if (!token) {

    throw new Error(

      "No authentication token returned."

    );

  }


  return token;

}


// ============================================================
// RECURSIVE OBJECT WALKER
// ============================================================

function walk(
  value,
  callback
) {

  if (
    Array.isArray(value)
  ) {

    for (
      const item of value
    ) {

      walk(
        item,
        callback
      );

    }

    return;

  }


  if (
    !value ||
    typeof value !== "object"
  ) {

    return;

  }


  callback(value);


  for (
    const child
    of Object.values(value)
  ) {

    walk(
      child,
      callback
    );

  }

}


// ============================================================
// EXTRACT JOB IDs
// ============================================================

function extractJobIds(
  data
) {

  const ids =
    new Set();


  walk(

    data,

    (obj) => {

      for (
        const [key, value]
        of Object.entries(obj)
      ) {

        const k =
          key.toLowerCase();


        if (

          [

            "jobid",

            "job_id"

          ].includes(k)

          &&

          (

            typeof value === "string" ||

            typeof value === "number"

          )

        ) {

          const id =
            String(value)
              .trim();


          if (
            /^\d+$/.test(id)
          ) {

            ids.add(id);

          }

        }

      }

    }

  );


  return [
    ...ids
  ];

}


// ============================================================
// EXTRACT CANDIDATE IDS
// ============================================================

function extractCandidateIds(
  data
) {

  const ids =
    new Set();


  walk(

    data,

    (obj) => {

      for (
        const [key, value]
        of Object.entries(obj)
      ) {

        const k =
          key
            .toLowerCase();


        if (

          [

            "candidateid",

            "candidate_id",

            "candidate"

          ].includes(k)

          &&

          (

            typeof value === "string" ||

            typeof value === "number"

          )

        ) {

          const id =
            String(value)
              .trim();


          if (
            /^\d+$/.test(id)
          ) {

            ids.add(id);

          }

        }

      }

    }

  );


  return [
    ...ids
  ];

}


// ============================================================
// FETCH JOBS
// ============================================================

async function fetchJobs(
  token
) {

  header(
    "2. FETCH RECRUITER-SCOPED JOBS"
  );


  if (!RECRUITER_ID) {

    throw new Error(
      "JOBDIVA_RECRUITER_ID is missing."
    );

  }


  const path =
    `/apiv2/bi/JobsListByUser?recruiterId=` +

    encodeURIComponent(
      RECRUITER_ID
    );


  const response =
    await getJson(
      path,
      token
    );


  const jobIds =
    extractJobIds(
      response.data
    );


  results.jobsList = {

    status:
      response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    jobIds,

    rawResponse:
      response.data

  };


  results.summary.jobsReturned =
    jobIds.length;


  log(
    `HTTP ${response.status}`
  );


  log(
    `Jobs returned: ${jobIds.length}`
  );


  for (
    const jobId
    of jobIds
  ) {

    log(
      `  ${jobId}`
    );

  }


  if (!jobIds.length) {

    throw new Error(
      "No job IDs were discovered."
    );

  }


  return jobIds;

}


// ============================================================
// GENERIC ENDPOINT TEST
// ============================================================

async function testEndpoint(
  endpointName,
  endpointPath,
  jobIds,
  token
) {

  header(
    `TEST: ${endpointName}`
  );


  /*
   * JobDiva describes jobIds as an array.
   *
   * We first use repeated query parameters:
   *
   *   ?jobIds=123&jobIds=456
   *
   * This is the common Swagger/OpenAPI serialization
   * for an array query parameter.
   */

  const params =
    new URLSearchParams();


  for (
    const jobId
    of jobIds
  ) {

    params.append(
      "jobIds",
      jobId
    );

  }


  const path =
    `${endpointPath}?${params.toString()}`;


  log(
    `Endpoint: ${endpointPath}`
  );


  log(
    `Jobs tested: ${jobIds.length}`
  );


  try {

    const response =
      await getJson(
        path,
        token
      );


    const candidateIds =
      extractCandidateIds(
        response.data
      );


    let recordCount = 0;


    if (
      Array.isArray(
        response.data
      )
    ) {

      recordCount =
        response.data.length;

    }

    else if (
      Array.isArray(
        response.data?.data
      )
    ) {

      recordCount =
        response.data.data.length;

    }

    else if (
      candidateIds.length
    ) {

      recordCount =
        candidateIds.length;

    }


    const result = {

      endpoint:
        endpointPath,

      query: {

        jobIds

      },

      status:
        response.status,

      success:
        response.status >= 200 &&
        response.status < 300,

      recordCount,

      candidateIds,

      rawResponse:
        response.data

    };


    results.endpoints[
      endpointName
    ].push(result);


    results.summary.endpointResults[
      endpointName
    ] = {

      status:
        response.status,

      success:
        result.success,

      recordCount,

      candidateIds

    };


    log(
      `HTTP status: ${response.status}`
    );


    log(
      `Records: ${recordCount}`
    );


    log(
      `Candidate IDs detected: ${candidateIds.length}`
    );


    if (
      candidateIds.length
    ) {

      log(
        candidateIds
          .map(
            id => `  ${id}`
          )
          .join("\n")
      );

    }


    /*
     * Print a compact preview of the response.
     *
     * The full response is saved to JSON.
     */

    console.log(
      "\nResponse preview:"
    );


    console.dir(
      response.data,
      {
        depth: 4,
        maxArrayLength: 5
      }
    );


    return result;

  }

  catch (error) {

    const result = {

      endpoint:
        endpointPath,

      query: {

        jobIds

      },

      status:
        null,

      success:
        false,

      recordCount:
        0,

      candidateIds:
        [],

      rawResponse:
        null,

      error:
        error.message

    };


    results.endpoints[
      endpointName
    ].push(result);


    results.summary.endpointResults[
      endpointName
    ] = {

      status:
        null,

      success:
        false,

      recordCount:
        0,

      candidateIds:
        [],

      error:
        error.message

    };


    log(
      `ERROR: ${error.message}`
    );


    return result;

  }

}


// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log(`

╔════════════════════════════════════════════════════════════════════════════╗
║             JOBDIVA JOB → CANDIDATE DIAGNOSTIC                            ║
║                              READ ONLY                                    ║
╚════════════════════════════════════════════════════════════════════════════╝

`);


  log(
    `Base URL: ${BASE_URL}`
  );


  log(
    `Recruiter ID: ${RECRUITER_ID}`
  );


  try {

    /*
     * --------------------------------------------------------
     * 1. Authenticate
     * --------------------------------------------------------
     */

    const token =
      await authenticate();


    /*
     * --------------------------------------------------------
     * 2. Get recruiter jobs
     * --------------------------------------------------------
     */

    const jobIds =
      await fetchJobs(
        token
      );


    /*
     * --------------------------------------------------------
     * 3. JobsApplicantsDetail
     * --------------------------------------------------------
     *
     * Official schema:
     *
     * GET /apiv2/bi/JobsApplicantsDetail
     *
     * jobIds = required array
     */

    await testEndpoint(

      "JobsApplicantsDetail",

      "/apiv2/bi/JobsApplicantsDetail",

      jobIds,

      token

    );


    /*
     * --------------------------------------------------------
     * 4. JobsSubmittalsDetail
     * --------------------------------------------------------
     */

    await testEndpoint(

      "JobsSubmittalsDetail",

      "/apiv2/bi/JobsSubmittalsDetail",

      jobIds,

      token

    );


    /*
     * --------------------------------------------------------
     * 5. InterestedCandidateInJobs
     * --------------------------------------------------------
     */

    await testEndpoint(

      "InterestedCandidateInJobs",

      "/apiv2/bi/InterestedCandidateInJobs",

      jobIds,

      token

    );


    /*
     * --------------------------------------------------------
     * 6. Save
     * --------------------------------------------------------
     */

    fs.writeFileSync(

      OUTPUT,

      JSON.stringify(
        results,
        null,
        2
      ),

      "utf8"

    );


    /*
     * --------------------------------------------------------
     * 7. Final summary
     * --------------------------------------------------------
     */

    header(
      "FINAL SUMMARY"
    );


    for (
      const [
        endpoint,
        result
      ]
      of Object.entries(
        results.summary.endpointResults
      )
    ) {

      console.log(
        `\n${endpoint}`
      );


      console.log(
        `  HTTP: ${
          result.status
        }`
      );


      console.log(
        `  Success: ${
          result.success
        }`
      );


      console.log(
        `  Records: ${
          result.recordCount
        }`
      );


      console.log(
        `  Candidate IDs: ${
          result.candidateIds.length
        }`
      );


      if (
        result.candidateIds.length
      ) {

        console.log(
          `  IDs: ${
            result.candidateIds.join(", ")
          }`
        );

      }

    }


    console.log(`

══════════════════════════════════════════════════════════════════════════════

Results saved to:

  ${OUTPUT}

══════════════════════════════════════════════════════════════════════════════

Upload that JSON here.

The most important thing I will look for is which of these produces:

  JOBID
      +
  CANDIDATEID

and then we can immediately test:

  CandidateDetail
      ↓
  candidate profile
      ↓
  candidate notes

without guessing.

`);


  }

  catch (error) {

    console.error(
      "\nDIAGNOSTIC FAILED:"
    );


    console.error(
      error.message
    );


    /*
     * Save partial results.
     */

    fs.writeFileSync(

      OUTPUT,

      JSON.stringify(
        results,
        null,
        2
      ),

      "utf8"

    );


    console.error(
      `\nPartial results saved to ${OUTPUT}`
    );


    process.exitCode =
      1;

  }

}


main();