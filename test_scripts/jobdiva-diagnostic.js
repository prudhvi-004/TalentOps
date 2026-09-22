/**
 * JobDiva API Diagnostic
 *
 * PURPOSE:
 *   Read-only diagnostic for inspecting the actual JobDiva V2
 *   responses returned by your tenant.
 *
 * DOES NOT:
 *   - modify JobDiva data
 *   - create notes
 *   - update jobs
 *   - update candidates
 *
 * REQUIREMENTS:
 *   Node.js 18+
 *   .env containing:
 *
 *   JOBDIVA_BASE_URL=https://api.jobdiva.com
 *   JOBDIVA_CLIENT_ID=...
 *   JOBDIVA_USERNAME=...
 *   JOBDIVA_PASSWORD=...
 *   JOBDIVA_RECRUITER_ID=...
 *
 * RUN:
 *   node jobdiva-diagnostic.js
 *
 * OUTPUT:
 *   jobdiva-diagnostic-results.json
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

const RESULTS_FILE = "jobdiva-diagnostic-results.json";

const results = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  recruiterId: RECRUITER_ID || null,
  authentication: null,
  tests: [],
};

function printHeader(text) {
  console.log("\n" + "=".repeat(75));
  console.log(text);
  console.log("=".repeat(75));
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function recordTest(name, method, url, status, data, error = null) {
  const result = {
    name,
    method,
    url,
    status,
    success: status >= 200 && status < 300,
    response: safeJson(data),
    error,
  };

  results.tests.push(result);

  console.log(
    `${result.success ? "✅" : "❌"} ${name} -> ${status || "ERROR"}`
  );

  return result;
}

async function request(method, path, options = {}) {
  const url = `${BASE_URL}${path}`;

  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    method,
    headers,
    body: options.body,
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    url,
    status: response.status,
    data,
  };
}

/**
 * ------------------------------------------------------------
 * 1. AUTHENTICATION
 * ------------------------------------------------------------
 */

async function authenticate() {
  printHeader("1. AUTHENTICATION");

  if (!CLIENT_ID || !USERNAME || !PASSWORD) {
    throw new Error(
      "Missing JOBDIVA_CLIENT_ID, JOBDIVA_USERNAME or JOBDIVA_PASSWORD in .env"
    );
  }

  const params = new URLSearchParams({
    clientid: CLIENT_ID,
    username: USERNAME,
    password: PASSWORD,
  });

  const result = await request(
    "GET",
    `/apiv2/v2/authenticate?${params.toString()}`
  );

  results.authentication = {
    status: result.status,
    success: result.status >= 200 && result.status < 300,
  };

  if (result.status < 200 || result.status >= 300) {
    recordTest(
      "Authentication",
      "GET",
      result.url,
      result.status,
      result.data
    );

    throw new Error(
      `Authentication failed with HTTP ${result.status}`
    );
  }

  /**
   * JobDiva responses can vary.
   * Try common token shapes.
   */
  const token =
    result.data?.token ||
    result.data?.access_token ||
    result.data?.accessToken ||
    result.data?.data?.token ||
    result.data?.data?.access_token ||
    (typeof result.data === "string" ? result.data : null);

  if (!token) {
    console.log("⚠️ Authentication succeeded but token shape was not recognized.");
    console.log("Raw authentication response:");
    console.dir(result.data, { depth: null });

    throw new Error(
      "Authentication response did not contain a recognizable token."
    );
  }

  recordTest(
    "Authentication",
    "GET",
    result.url,
    result.status,
    {
      /**
       * Don't save the actual token.
       */
      tokenPresent: true,
      tokenLength: String(token).length,
      responseShape: describeShape(result.data),
    }
  );

  return token;
}

/**
 * ------------------------------------------------------------
 * Generic GET tester
 * ------------------------------------------------------------
 */

async function testGet(name, path, token) {
  try {
    const result = await request("GET", path, {
      headers: {
        Authorization: token,
      },
    });

    return recordTest(
      name,
      "GET",
      result.url,
      result.status,
      result.data
    );
  } catch (error) {
    return recordTest(
      name,
      "GET",
      `${BASE_URL}${path}`,
      null,
      null,
      error.message
    );
  }
}

/**
 * ------------------------------------------------------------
 * Utility: describe response structure
 * ------------------------------------------------------------
 */

function describeShape(value, depth = 0) {
  if (depth > 3) return "...";

  if (value === null) return "null";

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      firstItem:
        value.length > 0
          ? describeShape(value[0], depth + 1)
          : null,
    };
  }

  if (typeof value === "object") {
    const output = {};

    for (const key of Object.keys(value)) {
      output[key] = describeShape(value[key], depth + 1);
    }

    return output;
  }

  return typeof value;
}

/**
 * ------------------------------------------------------------
 * Utility: recursively find likely ID fields
 * ------------------------------------------------------------
 */

function findIds(value, found = [], path = "") {
  if (found.length >= 50) return found;

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findIds(item, found, `${path}[${index}]`);
    });

    return found;
  }

  if (!value || typeof value !== "object") {
    return found;
  }

  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();

    if (
      (
        lower === "jobid" ||
        lower === "job_id" ||
        lower === "candidateid" ||
        lower === "candidate_id" ||
        lower === "id"
      ) &&
      (typeof val === "string" || typeof val === "number")
    ) {
      found.push({
        key,
        value: String(val),
        path: path ? `${path}.${key}` : key,
      });
    }

    findIds(val, found, path ? `${path}.${key}` : key);
  }

  return found;
}

/**
 * ------------------------------------------------------------
 * Utility: extract first matching ID
 * ------------------------------------------------------------
 */

function findFirstId(value, possibleNames) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstId(item, possibleNames);
      if (found) return found;
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, val] of Object.entries(value)) {
    const normalized = key.toLowerCase();

    if (
      possibleNames.includes(normalized) &&
      (typeof val === "string" || typeof val === "number")
    ) {
      return String(val);
    }

    const found = findFirstId(val, possibleNames);

    if (found) return found;
  }

  return null;
}

/**
 * ------------------------------------------------------------
 * 2. RECRUITER -> JOBS
 * ------------------------------------------------------------
 */

async function getJobs(token) {
  printHeader("2. RECRUITER -> JOBS");

  if (!RECRUITER_ID) {
    console.log("⚠️ JOBDIVA_RECRUITER_ID is not configured.");
    return null;
  }

  const result = await testGet(
    "JobsListByUser",
    `/apiv2/bi/JobsListByUser?recruiterId=${encodeURIComponent(
      RECRUITER_ID
    )}`,
    token
  );

  return result;
}

/**
 * ------------------------------------------------------------
 * Main
 * ------------------------------------------------------------
 */

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                         JOBDIVA API DIAGNOSTIC                            ║
║                              READ ONLY                                    ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

  console.log(`Base URL     : ${BASE_URL}`);
  console.log(`Recruiter ID : ${RECRUITER_ID || "(not configured)"}`);

  try {
    /**
     * --------------------------------------------------------
     * Authenticate
     * --------------------------------------------------------
     */

    const token = await authenticate();

    /**
     * --------------------------------------------------------
     * Recruiter -> Jobs
     * --------------------------------------------------------
     */

    const jobsResult = await getJobs(token);

    let jobId = null;

    if (jobsResult) {
      jobId = findFirstId(jobsResult.response, [
        "jobid",
        "job_id",
      ]);
    }

    console.log(`\nSelected Job ID: ${jobId || "(not found)"}`);

    /**
     * --------------------------------------------------------
     * Job endpoints
     * --------------------------------------------------------
     */

    if (jobId) {
      printHeader(`3. JOB DETAILS — JOB ID ${jobId}`);

      await testGet(
        "JobDetail",
        `/apiv2/bi/JobDetail?jobId=${encodeURIComponent(jobId)}`,
        token
      );

      await testGet(
        "JobsDetail",
        `/apiv2/bi/JobsDetail?jobIds=${encodeURIComponent(jobId)}`,
        token
      );

      printHeader("4. JOB CONTACTS — HIRING MANAGER");

      await testGet(
        "JobsContacts",
        `/apiv2/bi/JobsContacts?jobIds=${encodeURIComponent(jobId)}`,
        token
      );

      printHeader("5. JOB INTERNAL USERS — PRIMARY RECRUITER");

      await testGet(
        "JobsInternalUsersDetail",
        `/apiv2/bi/JobsInternalUsersDetail?jobIds=${encodeURIComponent(
          jobId
        )}`,
        token
      );

      printHeader("6. JOB APPLICANTS — ASSIGNED CANDIDATES");

      const applicantsResult = await testGet(
        "JobApplicantsDetail",
        `/apiv2/bi/JobApplicantsDetail?jobId=${encodeURIComponent(
          jobId
        )}`,
        token
      );

      /**
       * ------------------------------------------------------
       * Candidate ID
       * ------------------------------------------------------
       */

      let candidateId = null;

      if (applicantsResult) {
        candidateId = findFirstId(applicantsResult.response, [
          "candidateid",
          "candidate_id",
        ]);
      }

      console.log(
        `\nSelected Candidate ID: ${candidateId || "(not found)"}`
      );

      /**
       * ------------------------------------------------------
       * Candidate endpoints
       * ------------------------------------------------------
       */

      if (candidateId) {
        printHeader(`7. CANDIDATE DETAIL — ${candidateId}`);

        await testGet(
          "CandidateDetail",
          `/apiv2/bi/CandidateDetail?candidateId=${encodeURIComponent(
            candidateId
          )}`,
          token
        );

        printHeader("8. CANDIDATE PARSED PROFILE");

        await testGet(
          "CandidatesProfileDetail",
          `/apiv2/bi/CandidatesProfileDetail?candidateIds=${encodeURIComponent(
            candidateId
          )}`,
          token
        );

        printHeader("9. CANDIDATE RESUMES");

        await testGet(
          "CandidatesResumesDetail",
          `/apiv2/bi/CandidatesResumesDetail?candidateIds=${encodeURIComponent(
            candidateId
          )}`,
          token
        );

        printHeader("10. CANDIDATE NOTES");

        await testGet(
          "CandidateNotesListDetail",
          `/apiv2/bi/CandidateNotesListDetail?candidateIds=${encodeURIComponent(
            candidateId
          )}`,
          token
        );
      } else {
        console.log(
          "\n⚠️ No candidate ID was found in JobApplicantsDetail."
        );
      }
    } else {
      console.log(
        "\n⚠️ No job ID was found in JobsListByUser."
      );
    }

    /**
     * --------------------------------------------------------
     * Add a field inventory to every response.
     * --------------------------------------------------------
     */

    for (const test of results.tests) {
      if (test.response !== undefined) {
        test.responseShape = describeShape(test.response);
        test.discoveredIds = findIds(test.response);
      }
    }

    /**
     * --------------------------------------------------------
     * Save results
     * --------------------------------------------------------
     */

    fs.writeFileSync(
      RESULTS_FILE,
      JSON.stringify(results, null, 2),
      "utf8"
    );

    printHeader("DIAGNOSTIC COMPLETE");

    console.log(`Results saved to: ${RESULTS_FILE}`);

    console.log("\nSummary:");

    for (const test of results.tests) {
      console.log(
        `${test.success ? "✅" : "❌"} ${test.name} (${test.status || "ERROR"})`
      );
    }

    console.log(`
Next step:
Upload "${RESULTS_FILE}" here.

It contains the raw JobDiva responses and field structure
needed to correctly map:

  Job
  ├── Hiring Manager
  ├── Primary Recruiter
  ├── Salary
  ├── Requirements
  ├── Description
  └── Other fields

  Job
  └── Applicants
       └── Candidate
            ├── Profile
            ├── Resume
            └── Notes
`);
  } catch (error) {
    console.error("\n❌ Diagnostic stopped:");
    console.error(error.message);

    /**
     * Still save whatever we managed to collect.
     */
    fs.writeFileSync(
      RESULTS_FILE,
      JSON.stringify(results, null, 2),
      "utf8"
    );

    console.log(`\nPartial results saved to: ${RESULTS_FILE}`);
    process.exitCode = 1;
  }
}

main();