/**
 * JobDiva Applicant Diagnostic
 *
 * Purpose:
 *   1. Authenticate with JobDiva.
 *   2. Fetch all jobs for JOBDIVA_RECRUITER_ID using JobsListByUser.
 *   3. Extract ALL job IDs returned.
 *   4. Call JobApplicantsDetail for EVERY returned job.
 *   5. Save raw applicant responses + a concise summary.
 *
 * READ-ONLY:
 *   This script does NOT create/update jobs, candidates, notes, etc.
 *
 * Requirements:
 *   Node.js 18+
 *
 * .env expected:
 *
 *   JOBDIVA_BASE_URL=https://api.jobdiva.com
 *   JOBDIVA_CLIENT_ID=...
 *   JOBDIVA_USERNAME=...
 *   JOBDIVA_PASSWORD=...
 *   JOBDIVA_RECRUITER_ID=1605363
 *
 * Run:
 *
 *   node jobdiva-applicants-diagnostic.js
 *
 * Output:
 *
 *   jobdiva-applicants-diagnostic.json
 */

require("dotenv").config();

const fs = require("fs");

const BASE_URL = (
  process.env.JOBDIVA_BASE_URL ||
  "https://api.jobdiva.com"
).replace(/\/+$/, "");

const CLIENT_ID = process.env.JOBDIVA_CLIENT_ID;
const USERNAME = process.env.JOBDIVA_USERNAME;
const PASSWORD = process.env.JOBDIVA_PASSWORD;
const RECRUITER_ID = process.env.JOBDIVA_RECRUITER_ID;

const OUTPUT = "jobdiva-applicants-diagnostic.json";

const results = {
  generatedAt: new Date().toISOString(),

  baseUrl: BASE_URL,

  recruiterId: RECRUITER_ID || null,

  authentication: null,

  jobsList: null,

  jobs: [],

  summary: {
    jobsReturned: 0,

    applicantRequestsSucceeded: 0,

    applicantRequestsFailed: 0,

    jobsWithApplicants: 0,

    jobsWithoutApplicants: 0,

    totalApplicantRecords: 0,

    uniqueCandidateIds: [],
  },
};


/**
 * Print something to console.
 */
function log(message = "") {
  console.log(message);
}


/**
 * Print a section heading.
 */
function header(message) {
  console.log("\n" + "=".repeat(78));

  console.log(message);

  console.log("=".repeat(78));
}


/**
 * Generic GET request.
 *
 * This function does not log credentials or tokens.
 */
async function getJson(path, token = null) {

  const headers = {
    Accept: "application/json",
  };

  if (token) {
    headers.Authorization = token;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "GET",

    headers,
  });

  const text = await response.text();

  let data;

  try {

    data = JSON.parse(text);

  } catch {

    data = text;

  }

  return {
    status: response.status,

    data,
  };
}


/**
 * Extract authentication token from common
 * JobDiva response structures.
 */
function extractToken(data) {

  if (typeof data === "string") {

    return data;

  }

  if (!data || typeof data !== "object") {

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


/**
 * Recursively walk through an API response.
 */
function walk(value, callback, path = "") {

  if (Array.isArray(value)) {

    value.forEach((item, index) => {

      walk(
        item,
        callback,
        `${path}[${index}]`
      );

    });

    return;
  }

  if (!value || typeof value !== "object") {

    return;

  }

  callback(value, path);

  for (const [key, child] of Object.entries(value)) {

    walk(
      child,
      callback,
      path
        ? `${path}.${key}`
        : key
    );

  }
}


/**
 * Extract all likely Job IDs from JobsListByUser.
 */
function extractJobIds(data) {

  const ids = new Set();

  walk(data, (obj) => {

    for (const [key, value] of Object.entries(obj)) {

      const normalizedKey = key.toLowerCase();

      if (

        [
          "jobid",

          "job_id",

          "id",
        ].includes(normalizedKey)

        &&

        (
          typeof value === "string" ||
          typeof value === "number"
        )

      ) {

        const id = String(value).trim();

        if (/^\d+$/.test(id)) {

          ids.add(id);

        }

      }

    }

  });

  return [...ids];
}


/**
 * Extract candidate IDs from JobApplicantsDetail.
 */
function extractCandidateIds(data) {

  const ids = new Set();

  walk(data, (obj) => {

    for (const [key, value] of Object.entries(obj)) {

      const normalizedKey = key.toLowerCase();

      if (

        [
          "candidateid",

          "candidate_id",
        ].includes(normalizedKey)

        &&

        (
          typeof value === "string" ||
          typeof value === "number"
        )

      ) {

        ids.add(String(value).trim());

      }

    }

  });

  return [...ids];
}


/**
 * Authenticate with JobDiva.
 */
async function authenticate() {

  header("1. AUTHENTICATION");

  if (
    !CLIENT_ID ||
    !USERNAME ||
    !PASSWORD
  ) {

    throw new Error(
      "Missing JOBDIVA_CLIENT_ID, JOBDIVA_USERNAME or JOBDIVA_PASSWORD in .env"
    );

  }


  const params = new URLSearchParams({

    clientid: CLIENT_ID,

    username: USERNAME,

    password: PASSWORD,

  });


  const path =
    `/apiv2/v2/authenticate?${params.toString()}`;


  try {

    const response =
      await getJson(path);


    const token =
      extractToken(response.data);


    results.authentication = {

      status: response.status,

      success:
        response.status >= 200 &&
        response.status < 300,

      tokenPresent:
        Boolean(token),

      /*
       * Do NOT save the token.
       *
       * Only save the shape of the response.
       */
      responseShape:

        response.data &&
        typeof response.data === "object"

          ? Object.keys(response.data)

          : typeof response.data,

    };


    if (
      response.status >= 200 &&
      response.status < 300
    ) {

      log(
        `OK: authentication HTTP ${response.status}`
      );

    } else {

      log(
        `FAILED: authentication HTTP ${response.status}`
      );

    }


    if (!token) {

      console.dir(
        response.data,
        {
          depth: null,
        }
      );


      throw new Error(
        "Authentication returned no recognizable token."
      );

    }


    return token;

  } catch (error) {

    results.authentication = {

      status: null,

      success: false,

      tokenPresent: false,

      error: error.message,

    };


    throw error;

  }
}


/**
 * Fetch recruiter-scoped jobs.
 */
async function fetchJobs(token) {

  header("2. RECRUITER-SCOPED JOBS");


  if (!RECRUITER_ID) {

    throw new Error(
      "JOBDIVA_RECRUITER_ID is missing from .env"
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

    status: response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    jobIds,

    rawResponse:
      response.data,

  };


  results.summary.jobsReturned =
    jobIds.length;


  log(
    `HTTP status: ${response.status}`
  );


  log(
    `Job IDs discovered: ${jobIds.length}`
  );


  if (jobIds.length > 0) {

    log(
      jobIds
        .map(
          (id) => `  - ${id}`
        )
        .join("\n")
    );

  }


  if (
    response.status < 200 ||
    response.status >= 300
  ) {

    throw new Error(
      `JobsListByUser failed with HTTP ${response.status}`
    );

  }


  if (!jobIds.length) {

    throw new Error(
      "JobsListByUser succeeded, but no numeric job IDs were discovered."
    );

  }


  return jobIds;
}


/**
 * Test JobApplicantsDetail for one job.
 */
async function testApplicantsForJob(
  token,
  jobId,
  index,
  total
) {

  const path =
    `/apiv2/bi/JobApplicantsDetail?jobId=` +

    encodeURIComponent(
      jobId
    );


  log(
    `\n[${index}/${total}] Job ${jobId}`
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


    const rawData =
      response.data;


    /*
     * Try to determine applicant count
     * without making assumptions about the
     * exact response wrapper.
     */
    let applicantCount = 0;


    if (Array.isArray(rawData)) {

      applicantCount =
        rawData.length;

    }

    else if (
      Array.isArray(
        rawData?.data
      )
    ) {

      applicantCount =
        rawData.data.length;

    }

    else {

      applicantCount =
        candidateIds.length;

    }


    const jobResult = {

      jobId,

      request: {

        method: "GET",

        endpoint:
          "/apiv2/bi/JobApplicantsDetail",

        query: {

          jobId,

        },

      },


      status:
        response.status,


      success:
        response.status >= 200 &&
        response.status < 300,


      applicantCount,


      candidateIds,


      rawResponse:
        rawData,

    };


    results.jobs.push(
      jobResult
    );


    if (
      jobResult.success
    ) {

      results.summary
        .applicantRequestsSucceeded++;


      if (
        jobResult.applicantCount > 0
      ) {

        results.summary
          .jobsWithApplicants++;


        results.summary
          .totalApplicantRecords +=
            jobResult.applicantCount;


        log(
          `  OK ${response.status} — applicants: ${jobResult.applicantCount}`
        );


        if (
          candidateIds.length
        ) {

          log(
            `  Candidate IDs: ${candidateIds.join(", ")}`
          );

        }

      }

      else {

        results.summary
          .jobsWithoutApplicants++;


        log(
          `  OK ${response.status} — applicants: 0`
        );

      }

    }

    else {

      results.summary
        .applicantRequestsFailed++;


      log(
        `  FAILED ${response.status}`
      );

    }


    return jobResult;

  } catch (error) {

    const jobResult = {

      jobId,

      request: {

        method: "GET",

        endpoint:
          "/apiv2/bi/JobApplicantsDetail",

        query: {

          jobId,

        },

      },


      status: null,

      success: false,

      applicantCount: 0,

      candidateIds: [],

      rawResponse: null,

      error: error.message,

    };


    results.jobs.push(
      jobResult
    );


    results.summary
      .applicantRequestsFailed++;


    log(
      `  ERROR — ${error.message}`
    );


    return jobResult;
  }
}


/**
 * Main program.
 */
async function main() {

  console.log(`

╔════════════════════════════════════════════════════════════════════════════╗
║                  JOBDIVA APPLICANT DIAGNOSTIC                             ║
║                              READ ONLY                                    ║
╚════════════════════════════════════════════════════════════════════════════╝

`);


  log(
    `Base URL     : ${BASE_URL}`
  );


  log(
    `Recruiter ID : ${
      RECRUITER_ID || "(missing)"
    }`
  );


  try {

    /*
     * --------------------------------------------------------
     * Step 1
     * Authenticate.
     * --------------------------------------------------------
     */

    const token =
      await authenticate();


    /*
     * --------------------------------------------------------
     * Step 2
     * Fetch all recruiter-scoped jobs.
     * --------------------------------------------------------
     */

    const jobIds =
      await fetchJobs(
        token
      );


    /*
     * --------------------------------------------------------
     * Step 3
     * Test applicants for EVERY job.
     * --------------------------------------------------------
     */

    header(
      "3. TEST JobApplicantsDetail FOR EVERY JOB"
    );


    for (
      let i = 0;

      i < jobIds.length;

      i++
    ) {

      await testApplicantsForJob(

        token,

        jobIds[i],

        i + 1,

        jobIds.length

      );

    }


    /*
     * --------------------------------------------------------
     * Step 4
     * Collect unique candidate IDs.
     * --------------------------------------------------------
     */

    const candidates =
      new Set();


    for (
      const job of results.jobs
    ) {

      for (
        const candidateId
        of job.candidateIds || []
      ) {

        candidates.add(
          candidateId
        );

      }

    }


    results.summary
      .uniqueCandidateIds =
      [...candidates];


    /*
     * --------------------------------------------------------
     * Step 5
     * Save results.
     * --------------------------------------------------------
     *
     * IMPORTANT:
     *
     * Authentication token is NOT stored.
     *
     * Password is NOT stored.
     *
     * Authentication URL is NOT stored.
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
     * Step 6
     * Print summary.
     * --------------------------------------------------------
     */

    header(
      "4. SUMMARY"
    );


    log(
      `Jobs returned:              ${
        results.summary.jobsReturned
      }`
    );


    log(
      `Applicant requests OK:      ${
        results.summary.applicantRequestsSucceeded
      }`
    );


    log(
      `Applicant requests failed:  ${
        results.summary.applicantRequestsFailed
      }`
    );


    log(
      `Jobs WITH applicants:       ${
        results.summary.jobsWithApplicants
      }`
    );


    log(
      `Jobs WITHOUT applicants:    ${
        results.summary.jobsWithoutApplicants
      }`
    );


    log(
      `Total applicant records:    ${
        results.summary.totalApplicantRecords
      }`
    );


    log(
      `Unique candidate IDs:       ${
        results.summary.uniqueCandidateIds.length
      }`
    );


    if (
      results.summary.uniqueCandidateIds.length
    ) {

      log(
        `Candidate IDs: ${
          results.summary.uniqueCandidateIds.join(", ")
        }`
      );

    }


    log(
      `\nResults saved to: ${OUTPUT}`
    );


    log(`

NEXT STEP:

Upload "${OUTPUT}" here.

I will use it to determine:

  1. Which jobs actually have applicants.
  2. The exact applicant response structure.
  3. The exact candidate ID field.
  4. Whether one candidate can belong to multiple jobs.
  5. Which candidate endpoints we need for the UI.

`);

  } catch (error) {

    /*
     * Save partial results even if something fails.
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
      "\nDIAGNOSTIC FAILED:"
    );


    console.error(
      error.message
    );


    console.error(
      `\nPartial results saved to: ${OUTPUT}`
    );


    process.exitCode = 1;

  }
}


/**
 * Start.
 */
main();