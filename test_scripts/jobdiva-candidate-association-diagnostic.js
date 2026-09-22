/**
 * JobDiva Candidate / Submittal Diagnostic
 *
 * READ ONLY.
 *
 * Purpose:
 *   1. Authenticate.
 *   2. Fetch recruiter-scoped jobs.
 *   3. For every job, test:
 *
 *        /apiv2/bi/CandidatesSubmittalsDetail
 *
 *   4. Record the complete raw response.
 *   5. Detect candidate IDs.
 *
 * Run:
 *
 *   node jobdiva-candidate-association-diagnostic.js
 *
 * Output:
 *
 *   jobdiva-candidate-association-diagnostic.json
 */

require("dotenv").config();

const fs = require("fs");

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
  "jobdiva-candidate-association-diagnostic.json";


const results = {

  generatedAt:
    new Date().toISOString(),

  recruiterId:
    RECRUITER_ID || null,

  authentication: null,

  jobsList: null,

  jobs: [],

  summary: {

    jobsReturned: 0,

    requestsSucceeded: 0,

    requestsFailed: 0,

    jobsWithCandidates: 0,

    jobsWithoutCandidates: 0,

    totalRecords: 0,

    uniqueCandidateIds: []

  }

};


/* -----------------------------------------------------------
   Utility
----------------------------------------------------------- */

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


/* -----------------------------------------------------------
   HTTP
----------------------------------------------------------- */

async function getJson(
  path,
  token = null
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


/* -----------------------------------------------------------
   Authentication
----------------------------------------------------------- */

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
      "Missing JobDiva credentials in .env"
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
    await getJson(path);


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
      "Authentication response did not contain a token."
    );

  }


  return token;

}


/* -----------------------------------------------------------
   Recursive response walker
----------------------------------------------------------- */

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
    const child of Object.values(value)
  ) {

    walk(
      child,
      callback
    );

  }

}


/* -----------------------------------------------------------
   Extract job IDs
----------------------------------------------------------- */

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
            "job_id",
            "id"

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


/* -----------------------------------------------------------
   Extract candidate IDs
----------------------------------------------------------- */

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


/* -----------------------------------------------------------
   Fetch recruiter jobs
----------------------------------------------------------- */

async function fetchJobs(
  token
) {

  header(
    "2. FETCH RECRUITER JOBS"
  );


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
    `Jobs discovered: ${jobIds.length}`
  );


  for (
    const id of jobIds
  ) {

    log(
      `  ${id}`
    );

  }


  return jobIds;

}


/* -----------------------------------------------------------
   Test CandidatesSubmittalsDetail
----------------------------------------------------------- */

async function testJob(
  token,
  jobId,
  index,
  total
) {

  log(
    `\n[${index}/${total}] Testing Job ${jobId}`
  );


  const path =
    `/apiv2/bi/CandidatesSubmittalsDetail?jobId=` +
    encodeURIComponent(
      jobId
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

      jobId,

      endpoint:
        "/apiv2/bi/CandidatesSubmittalsDetail",

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


    results.jobs.push(
      result
    );


    if (
      result.success
    ) {

      results.summary
        .requestsSucceeded++;


      if (
        recordCount > 0
      ) {

        results.summary
          .jobsWithCandidates++;


        results.summary
          .totalRecords +=
            recordCount;


        log(
          `  HTTP ${response.status}`
        );


        log(
          `  Records: ${recordCount}`
        );


        if (
          candidateIds.length
        ) {

          log(
            `  Candidate IDs: ${
              candidateIds.join(", ")
            }`
          );

        }

      }

      else {

        results.summary
          .jobsWithoutCandidates++;


        log(
          `  HTTP ${response.status}`
        );


        log(
          `  Records: 0`
        );

      }

    }

    else {

      results.summary
        .requestsFailed++;


      log(
        `  HTTP ${response.status}`
      );

    }


  }

  catch (error) {

    results.summary
      .requestsFailed++;


    results.jobs.push({

      jobId,

      endpoint:
        "/apiv2/bi/CandidatesSubmittalsDetail",

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

    });


    log(
      `  ERROR: ${error.message}`
    );

  }

}


/* -----------------------------------------------------------
   Main
----------------------------------------------------------- */

async function main() {

  console.log(`

╔════════════════════════════════════════════════════════════════════════════╗
║             JOBDIVA CANDIDATE / SUBMITTAL DIAGNOSTIC                     ║
║                              READ ONLY                                    ║
╚════════════════════════════════════════════════════════════════════════════╝

`);


  log(
    `Recruiter ID: ${RECRUITER_ID}`
  );


  try {

    /*
     * Authenticate
     */

    const token =
      await authenticate();


    /*
     * Get recruiter jobs
     */

    const jobIds =
      await fetchJobs(
        token
      );


    /*
     * Test every job
     */

    header(
      "3. CandidatesSubmittalsDetail"
    );


    for (
      let i = 0;

      i < jobIds.length;

      i++
    ) {

      await testJob(

        token,

        jobIds[i],

        i + 1,

        jobIds.length

      );

    }


    /*
     * Unique candidate IDs
     */

    const unique =
      new Set();


    for (
      const job
      of results.jobs
    ) {

      for (
        const candidateId
        of job.candidateIds || []
      ) {

        unique.add(
          candidateId
        );

      }

    }


    results.summary
      .uniqueCandidateIds =
      [...unique];


    /*
     * Save
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
     * Summary
     */

    header(
      "4. SUMMARY"
    );


    log(
      `Jobs returned:             ${
        results.summary.jobsReturned
      }`
    );


    log(
      `Requests succeeded:       ${
        results.summary.requestsSucceeded
      }`
    );


    log(
      `Requests failed:          ${
        results.summary.requestsFailed
      }`
    );


    log(
      `Jobs with candidates:     ${
        results.summary.jobsWithCandidates
      }`
    );


    log(
      `Jobs without candidates:  ${
        results.summary.jobsWithoutCandidates
      }`
    );


    log(
      `Total records:            ${
        results.summary.totalRecords
      }`
    );


    log(
      `Unique candidate IDs:     ${
        results.summary.uniqueCandidateIds.length
      }`
    );


    if (
      results.summary.uniqueCandidateIds.length
    ) {

      log(
        `\nCandidate IDs:\n` +

        results.summary
          .uniqueCandidateIds
          .map(
            id => `  ${id}`
          )
          .join("\n")
      );

    }


    log(
      `\nSaved to:\n${OUTPUT}`
    );


    console.log(`

NEXT STEP
---------

Upload:

  ${OUTPUT}

That response will tell us whether
CandidatesSubmittalsDetail is the correct
source for:

    Job
      ↓
    Assigned Candidates
      ↓
    Candidate ID
      ↓
    Candidate Detail

We will then test CandidateDetail for the
actual candidate IDs returned.

`);

  }

  catch (error) {

    console.error(
      "\nDIAGNOSTIC FAILED:"
    );

    console.error(
      error.message
    );


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