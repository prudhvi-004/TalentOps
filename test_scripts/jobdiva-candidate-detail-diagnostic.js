require("dotenv").config();

const fs = require("fs");

const BASE_URL = (
  process.env.JOBDIVA_BASE_URL ||
  "https://api.jobdiva.com"
).replace(/\/+$/, "");

const CLIENT_ID = process.env.JOBDIVA_CLIENT_ID;
const USERNAME = process.env.JOBDIVA_USERNAME;
const PASSWORD = process.env.JOBDIVA_PASSWORD;

const OUTPUT =
  "jobdiva-candidate-detail-diagnostic.json";


/* ============================================================
   Candidate IDs discovered from JobsSubmittalsDetail
   ============================================================ */

const CANDIDATE_IDS = [
  "13955000990084",
  "19627576624339",
  "20109720815038",
  "18958622643495"
];


/* ============================================================
   Results
   ============================================================ */

const results = {

  generatedAt:
    new Date().toISOString(),

  authentication: null,

  candidates: [],

  summary: {

    candidatesTested:
      CANDIDATE_IDS.length,

    requestsSucceeded:
      0,

    requestsFailed:
      0,

    candidatesWithData:
      0

  }

};


/* ============================================================
   HTTP helper
   ============================================================ */

async function getJson(path, token = null) {

  const headers = {
    Accept: "application/json"
  };

  if (token) {
    headers.Authorization = token;
  }

  const response = await fetch(
    `${BASE_URL}${path}`,
    {
      method: "GET",
      headers
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  }

  catch {
    data = text;
  }

  return {
    status: response.status,
    data
  };
}


/* ============================================================
   Token extraction
   ============================================================ */

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


/* ============================================================
   Authentication
   ============================================================ */

async function authenticate() {

  console.log("\n========================================");
  console.log("AUTHENTICATION");
  console.log("========================================");

  if (!CLIENT_ID || !USERNAME || !PASSWORD) {

    throw new Error(
      "Missing JOBDIVA_CLIENT_ID, " +
      "JOBDIVA_USERNAME or JOBDIVA_PASSWORD"
    );
  }

  const params = new URLSearchParams({

    clientid:
      CLIENT_ID,

    username:
      USERNAME,

    password:
      PASSWORD

  });

  const response = await getJson(
    `/apiv2/v2/authenticate?${params}`
  );

  const token =
    extractToken(response.data);

  results.authentication = {

    status:
      response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    tokenPresent:
      Boolean(token)

  };

  console.log(
    `HTTP ${response.status}`
  );

  if (!token) {

    console.dir(
      response.data,
      {
        depth: 5
      }
    );

    throw new Error(
      "Authentication token was not returned."
    );
  }

  return token;
}


/* ============================================================
   Recursive object walker
   ============================================================ */

function walk(value, callback) {

  if (Array.isArray(value)) {

    for (const item of value) {
      walk(item, callback);
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

    walk(child, callback);
  }
}


/* ============================================================
   Extract all field names
   ============================================================ */

function extractFieldNames(data) {

  const fields = new Set();

  walk(
    data,
    (obj) => {

      for (
        const key
        of Object.keys(obj)
      ) {

        fields.add(key);
      }
    }
  );

  return [
    ...fields
  ];
}


/* ============================================================
   Extract likely candidate information
   ============================================================ */

function extractCandidateFields(data) {

  const interesting = {};

  walk(
    data,
    (obj) => {

      for (
        const [key, value]
        of Object.entries(obj)
      ) {

        const lower =
          key.toLowerCase();

        /*
         * Candidate identity
         */

        if (
          lower.includes("candidate") ||
          lower.includes("firstname") ||
          lower.includes("lastname") ||
          lower === "name" ||
          lower.includes("fullname")
        ) {

          interesting[key] = value;
        }


        /*
         * Contact
         */

        if (
          lower.includes("email") ||
          lower.includes("phone") ||
          lower.includes("mobile")
        ) {

          interesting[key] = value;
        }


        /*
         * Location
         */

        if (
          lower.includes("city") ||
          lower.includes("state") ||
          lower.includes("country") ||
          lower.includes("zip") ||
          lower.includes("address")
        ) {

          interesting[key] = value;
        }


        /*
         * Professional information
         */

        if (
          lower.includes("skill") ||
          lower.includes("experience") ||
          lower.includes("title") ||
          lower.includes("position") ||
          lower.includes("education") ||
          lower.includes("degree") ||
          lower.includes("certification")
        ) {

          interesting[key] = value;
        }


        /*
         * Resume/profile
         */

        if (
          lower.includes("resume") ||
          lower.includes("profile") ||
          lower.includes("document")
        ) {

          interesting[key] = value;
        }

      }

    }
  );

  return interesting;
}


/* ============================================================
   Test CandidateDetail
   ============================================================ */

async function testCandidate(
  token,
  candidateId,
  index
) {

  console.log(
    `\n[${index}/${CANDIDATE_IDS.length}] ` +
    `Candidate ${candidateId}`
  );

  /*
   * CandidateDetail is being tested using
   * candidateId.
   */

  const path =
    `/apiv2/bi/CandidateDetail?candidateId=` +
    encodeURIComponent(candidateId);

  console.log(
    `GET ${path}`
  );

  try {

    const response =
      await getJson(
        path,
        token
      );

    const fieldNames =
      extractFieldNames(
        response.data
      );

    const interestingFields =
      extractCandidateFields(
        response.data
      );

    const result = {

      candidateId,

      endpoint:
        "/apiv2/bi/CandidateDetail",

      status:
        response.status,

      success:
        response.status >= 200 &&
        response.status < 300,

      fieldCount:
        fieldNames.length,

      fields:
        fieldNames,

      interestingFields,

      rawResponse:
        response.data

    };

    results.candidates.push(
      result
    );


    if (result.success) {

      results.summary
        .requestsSucceeded++;

      if (
        fieldNames.length > 0
      ) {

        results.summary
          .candidatesWithData++;
      }

    }

    else {

      results.summary
        .requestsFailed++;
    }


    console.log(
      `HTTP: ${response.status}`
    );

    console.log(
      `Fields found: ${fieldNames.length}`
    );


    if (fieldNames.length) {

      console.log(
        "\nFields:"
      );

      console.log(
        fieldNames.join(", ")
      );

    }


    if (
      Object.keys(
        interestingFields
      ).length
    ) {

      console.log(
        "\nInteresting fields:"
      );

      console.dir(
        interestingFields,
        {
          depth: 5
        }
      );

    }


    console.log(
      "\nRaw response:"
    );

    console.dir(
      response.data,
      {
        depth: 8,
        maxArrayLength: 20
      }
    );


    return result;

  }

  catch (error) {

    results.summary
      .requestsFailed++;

    const result = {

      candidateId,

      endpoint:
        "/apiv2/bi/CandidateDetail",

      status:
        null,

      success:
        false,

      fieldCount:
        0,

      fields:
        [],

      interestingFields:
        {},

      rawResponse:
        null,

      error:
        error.message

    };

    results.candidates.push(
      result
    );

    console.log(
      `ERROR: ${error.message}`
    );

    return result;
  }
}


/* ============================================================
   Main
   ============================================================ */

async function main() {

  console.log(`

╔══════════════════════════════════════════════════════════════╗
║             JOBDIVA CANDIDATE DETAIL TEST                  ║
║                         READ ONLY                           ║
╚══════════════════════════════════════════════════════════════╝

`);

  console.log(
    `Base URL: ${BASE_URL}`
  );

  console.log(
    `Candidates to test: ${CANDIDATE_IDS.length}`
  );


  try {

    /*
     * 1. Authenticate
     */

    const token =
      await authenticate();


    /*
     * 2. Test every candidate
     */

    console.log(
      "\n========================================"
    );

    console.log(
      "CANDIDATE DETAIL"
    );

    console.log(
      "========================================"
    );


    for (
      let i = 0;
      i < CANDIDATE_IDS.length;
      i++
    ) {

      await testCandidate(
        token,
        CANDIDATE_IDS[i],
        i + 1
      );

    }


    /*
     * 3. Save complete diagnostic
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
     * 4. Summary
     */

    console.log(`

========================================
SUMMARY
========================================

Candidates tested:
  ${results.summary.candidatesTested}

Requests succeeded:
  ${results.summary.requestsSucceeded}

Requests failed:
  ${results.summary.requestsFailed}

Candidates with data:
  ${results.summary.candidatesWithData}

Output:
  ${OUTPUT}

`);


    /*
     * Candidate-by-candidate summary
     */

    for (
      const candidate
      of results.candidates
    ) {

      console.log(
        `Candidate ${candidate.candidateId}`
      );

      console.log(
        `  HTTP: ${candidate.status}`
      );

      console.log(
        `  Fields: ${candidate.fieldCount}`
      );

      console.log(
        `  Success: ${candidate.success}`
      );

      console.log("");

    }


    console.log(`
NEXT STEP
---------

Upload:

  ${OUTPUT}

We will use the actual CandidateDetail
response to determine the exact field mapping
for your candidate panel.

We will NOT guess field names.
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