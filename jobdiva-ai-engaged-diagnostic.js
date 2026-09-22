/**
 * ============================================================
 * JOBDIVA AI ENGAGED DISCOVERY DIAGNOSTIC
 * ============================================================
 *
 * READ ONLY
 *
 * Purpose:
 *   Discover how AI Engaged records are represented in the
 *   actual JobDiva sandbox.
 *
 * We test:
 *
 *   1. CandidateDetail + wildcard UDF requests
 *   2. CandidateDetail + likely UDF names
 *   3. CandidatesDetail + wildcard UDF requests
 *   4. searchCandidateProfile + wildcard UDF requests
 *   5. searchCandidateProfile + likely UDF names
 *
 * NO WRITE OPERATIONS.
 *
 * ============================================================
 */

require("dotenv").config();

const fs = require("fs");


// ============================================================
// CONFIG
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

const OUTPUT =
  "jobdiva-ai-engaged-diagnostic.json";


// ============================================================
// REAL CANDIDATES ALREADY DISCOVERED
// ============================================================

const KNOWN_CANDIDATE_IDS = [

  "13955000990084",
  "19627576624339",
  "20109720815038",
  "18958622643495"

];


// ============================================================
// LIKELY ACCOUNT-SPECIFIC UDF NAMES
// ============================================================
//
// These are NOT assumed to be correct.
// They are probes only.
//
// The important breakthrough is that JobDiva expects
// the actual UDF display/API name in userFieldsName.
//

const UDF_PROBES = [

  // AI Job
  "AI Job ID",
  "AI JobID",
  "AI Job",
  "AI Engaged Job ID",
  "AI Engaged Job",
  "AI Job Id",
  "AI_JOB_ID",
  "AI_JOBID",
  "AI_JOB",

  // AI category
  "AI Category",
  "AI Type",
  "AI Engaged Type",
  "AI Engaged Category",
  "AI Candidate Type",
  "AI_CATEGORY",
  "AI_TYPE",

  // AI stage
  "AI Stage",
  "AI Engaged Stage",
  "AI Status",
  "AI Engagement Stage",
  "AI_STAGE",
  "AI_STATUS",

  // Possible names from earlier implementation
  "customText1",
  "customText2",
  "customText3",

  "CUSTOMFIELD1",
  "CUSTOMFIELD2",
  "CUSTOMFIELD3"

];


// ============================================================
// RESULTS
// ============================================================

const results = {

  generatedAt:
    new Date().toISOString(),

  baseUrl:
    BASE_URL,

  candidatesTested:
    KNOWN_CANDIDATE_IDS,

  tests: [],

  discovered: {

    udfNamesWithData: [],

    wildcardResults: [],

    aiCandidates: []

  }

};


// ============================================================
// HTTP
// ============================================================

async function request(
  method,
  pathname,
  token,
  body = null
) {

  const url =
    `${BASE_URL}${pathname}`;

  const headers = {

    Accept:
      "application/json"

  };


  if (token) {

    headers.Authorization =
      token;

  }


  if (body !== null) {

    headers["Content-Type"] =
      "application/json";

  }


  const response =
    await fetch(

      url,

      {

        method,

        headers,

        body:
          body !== null
            ? JSON.stringify(body)
            : undefined

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
// AUTH
// ============================================================

function extractToken(data) {

  if (
    typeof data === "string"
  ) {

    return data.trim();

  }


  if (
    !data ||
    typeof data !== "object"
  ) {

    return null;

  }


  return (

    data.token ||

    data.Token ||

    data.access_token ||

    data.accessToken ||

    data.Result?.token ||

    data.Result?.access_token ||

    data.Result?.accessToken ||

    (
      typeof data.Result === "string"
        ? data.Result
        : null
    )

  );

}


async function authenticate() {

  const params =
    new URLSearchParams({

      clientid:
        CLIENT_ID,

      username:
        USERNAME,

      password:
        PASSWORD

    });


  const response =
    await request(

      "GET",

      `/apiv2/v2/authenticate?${params}`,

      null

    );


  const token =
    extractToken(
      response.data
    );


  console.log(
    `Authentication HTTP ${response.status}`
  );


  if (!token) {

    console.dir(
      response.data,
      {
        depth: 5
      }
    );


    throw new Error(
      "Authentication failed."
    );

  }


  return token;

}


// ============================================================
// OBJECT HELPERS
// ============================================================

function unwrap(data) {

  if (
    data == null
  ) {

    return data;

  }


  if (
    Array.isArray(data)
  ) {

    return data;

  }


  if (
    Array.isArray(data.Result)
  ) {

    return data.Result;

  }


  if (
    data.Result !== undefined
  ) {

    return data.Result;

  }


  if (
    Array.isArray(data.result)
  ) {

    return data.result;

  }


  if (
    data.result !== undefined
  ) {

    return data.result;

  }


  if (
    Array.isArray(data.data)
  ) {

    return data.data;

  }


  if (
    data.data !== undefined
  ) {

    return data.data;

  }


  return data;

}


function rowsToObjects(value) {

  if (
    !Array.isArray(value) ||
    !value.length
  ) {

    return value;

  }


  if (
    !Array.isArray(value[0])
  ) {

    return value;

  }


  const headers =
    value[0].map(
      h => String(h ?? "").trim()
    );


  return value.slice(1).map(row => {

    const obj = {};

    headers.forEach(
      (header, index) => {

        if (header) {

          obj[header] =
            row[index];

        }

      }
    );

    return obj;

  });

}


function getRows(data) {

  return rowsToObjects(
    unwrap(data)
  );

}


function objectHasAIValue(
  obj
) {

  if (
    !obj ||
    typeof obj !== "object"
  ) {

    return false;

  }


  const values =
    Object.values(obj);


  return values.some(value => {

    if (
      value === null ||
      value === undefined
    ) {

      return false;

    }


    const text =
      String(value)
        .trim()
        .toLowerCase();


    return (

      text === "applicant" ||

      text === "candidate" ||

      text.includes("ai") ||

      /^\d{6,}$/.test(text)

    );

  });

}


// ============================================================
// TEST 1
// CandidateDetail with wildcard UDF names
// ============================================================

async function testCandidateWildcard(
  candidateId,
  token
) {

  const wildcardNames = [

    "*",
    "ALL",
    "all",
    "%"

  ];


  for (
    const udfName
    of wildcardNames
  ) {

    const params =
      new URLSearchParams();


    params.append(
      "candidateId",
      candidateId
    );


    params.append(
      "userFieldsName",
      udfName
    );


    const pathname =
      `/apiv2/bi/CandidateDetail?` +
      params.toString();


    const response =
      await request(
        "GET",
        pathname,
        token
      );


    const rows =
      getRows(
        response.data
      );


    const row =
      Array.isArray(rows)
        ? rows[0]
        : rows;


    const test = {

      test:
        "CandidateDetailWildcard",

      candidateId,

      udfName,

      status:
        response.status,

      success:
        response.status >= 200 &&
        response.status < 300,

      keys:
        row &&
        typeof row === "object"
          ? Object.keys(row)
          : [],

      rawResponse:
        response.data

    };


    results.tests.push(test);


    console.log(
      `CandidateDetail ${candidateId} ` +
      `UDF=${udfName} ` +
      `HTTP=${response.status} ` +
      `keys=${test.keys.length}`
    );


    /*
     * If wildcard actually exposes UDF fields,
     * this is our breakthrough.
     */

    if (
      test.keys.some(
        key =>
          ![
            "ID",
            "FIRSTNAME",
            "LASTNAME",
            "SUFFIX",
            "ADDRESS1",
            "ADDRESS2",
            "CITY",
            "STATE",
            "ZIPCODE",
            "COUNTRY",
            "EMAIL",
            "CELLPHONE",
            "WORKPHONE",
            "HOMEPHONE"
          ].includes(key)
      )
    ) {

      results.discovered
        .wildcardResults
        .push(test);

    }

  }

}


// ============================================================
// TEST 2
// CandidateDetail with likely names
// ============================================================

async function testCandidateUdfNames(
  candidateId,
  token
) {

  for (
    const udfName
    of UDF_PROBES
  ) {

    const params =
      new URLSearchParams();


    params.append(
      "candidateId",
      candidateId
    );


    params.append(
      "userFieldsName",
      udfName
    );


    const pathname =
      `/apiv2/bi/CandidateDetail?` +
      params.toString();


    const response =
      await request(
        "GET",
        pathname,
        token
      );


    const rows =
      getRows(
        response.data
      );


    const row =
      Array.isArray(rows)
        ? rows[0]
        : rows;


    if (
      !row ||
      typeof row !== "object"
    ) {

      continue;

    }


    /*
     * Find keys that look like UDF output.
     */

    const interestingKeys =
      Object.keys(row)
        .filter(key => {

          const upper =
            key.toUpperCase();


          return (

            upper.includes("AI") ||

            upper.includes("CUSTOM") ||

            upper.includes("UDF") ||

            upper.includes("FIELD")

          );

        });


    if (
      interestingKeys.length
    ) {

      const found = {

        candidateId,

        requestedUdf:
          udfName,

        status:
          response.status,

        fields:
          interestingKeys.reduce(
            (obj, key) => {

              obj[key] =
                row[key];

              return obj;

            },

            {}

          ),

        rawResponse:
          response.data

      };


      results.discovered
        .udfNamesWithData
        .push(found);


      console.log(
        "\nFOUND POSSIBLE UDF:"
      );


      console.dir(
        found,
        {
          depth: 8
        }
      );

    }

  }

}


// ============================================================
// TEST 3
// CandidatesDetail wildcard
// ============================================================

async function testCandidatesDetailWildcard(
  token
) {

  for (
    const udfName
    of ["*", "ALL", "all", "%"]
  ) {

    const params =
      new URLSearchParams();


    for (
      const id
      of KNOWN_CANDIDATE_IDS
    ) {

      params.append(
        "candidateIds",
        id
      );

    }


    params.append(
      "userFieldsName",
      udfName
    );


    const pathname =
      `/apiv2/bi/CandidatesDetail?` +
      params.toString();


    const response =
      await request(
        "GET",
        pathname,
        token
      );


    const rows =
      getRows(
        response.data
      );


    const test = {

      test:
        "CandidatesDetailWildcard",

      udfName,

      status:
        response.status,

      rawResponse:
        response.data

    };


    results.tests.push(test);


    console.log(
      `CandidatesDetail UDF=${udfName} ` +
      `HTTP=${response.status}`
    );

  }

}


// ============================================================
// TEST 4
// SearchCandidateProfile with wildcard UDF inclusion
// ============================================================

async function testSearchWildcard(
  token
) {

  const variants = [

    {
      name:
        "includeUdfs=*",

      body: {

        includeUdfs: ["*"],

        maxreturned: 100,

        offset: 0

      }

    },

    {
      name:
        "includeUdfs=ALL",

      body: {

        includeUdfs: ["ALL"],

        maxreturned: 100,

        offset: 0

      }

    },

    {
      name:
        "includeUdfs=all",

      body: {

        includeUdfs: ["all"],

        maxreturned: 100,

        offset: 0

      }

    },

    {
      name:
        "noUdfFilter",

      body: {

        maxreturned: 100,

        offset: 0

      }

    }

  ];


  for (
    const variant
    of variants
  ) {

    const response =
      await request(

        "POST",

        "/apiv2/jobdiva/searchCandidateProfile",

        token,

        variant.body

      );


    const rows =
      getRows(
        response.data
      );


    const array =
      Array.isArray(rows)
        ? rows
        : rows
          ? [rows]
          : [];


    const test = {

      test:
        "searchCandidateProfile",

      variant:
        variant.name,

      status:
        response.status,

      rowCount:
        array.length,

      sampleKeys:
        array.length
          ? Object.keys(array[0])
          : [],

      rawResponse:
        response.data

    };


    results.tests.push(test);


    console.log(
      `searchCandidateProfile ` +
      `${variant.name} ` +
      `HTTP=${response.status} ` +
      `rows=${array.length}`
    );


    /*
     * Search the returned records for
     * possible AI information.
     */

    for (
      const row
      of array
    ) {

      if (
        objectHasAIValue(row)
      ) {

        results.discovered
          .aiCandidates
          .push(row);

      }

    }

  }

}


// ============================================================
// TEST 5
// SearchCandidateProfile using likely UDF names
// ============================================================

async function testSearchByUdf(
  jobId,
  token
) {

  console.log(
    "\nSearching candidates by likely AI Job UDF names..."
  );


  for (
    const udfName
    of UDF_PROBES
  ) {

    const body = {

      searchForUdfs: [

        {

          udfName,

          udfValue:
            String(jobId)

        }

      ],

      includeUdfs:
        UDF_PROBES,

      maxreturned:
        100,

      offset:
        0

    };


    const response =
      await request(

        "POST",

        "/apiv2/jobdiva/searchCandidateProfile",

        token,

        body

      );


    const rows =
      getRows(
        response.data
      );


    const array =
      Array.isArray(rows)
        ? rows
        : rows
          ? [rows]
          : [];


    if (
      array.length
    ) {

      const found = {

        udfName,

        jobId,

        status:
          response.status,

        count:
          array.length,

        rows:
          array

      };


      results.discovered
        .aiCandidates
        .push(
          ...array
        );


      console.log(
        "\n======================================"
      );


      console.log(
        "POSSIBLE AI UDF FOUND"
      );


      console.log(
        `UDF: ${udfName}`
      );


      console.log(
        `Job: ${jobId}`
      );


      console.log(
        `Candidates: ${array.length}`
      );


      console.dir(
        found,
        {
          depth: 10
        }
      );


      results.tests.push({

        test:
          "searchCandidateProfileByUdf",

        ...found

      });

    }

  }

}


// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log(`

============================================================
        JOBDIVA AI ENGAGED DISCOVERY
============================================================

READ ONLY

The purpose is to discover the REAL JobDiva
Candidate UDF names used by the AI workflow.

Candidates:
${KNOWN_CANDIDATE_IDS.join("\n")}

============================================================

`);


  if (
    !CLIENT_ID ||
    !USERNAME ||
    !PASSWORD
  ) {

    throw new Error(
      "JOBDIVA_CLIENT_ID / USERNAME / PASSWORD missing."
    );

  }


  const token =
    await authenticate();


  /*
   * ----------------------------------------------------------
   * 1. CandidateDetail wildcard discovery
   * ----------------------------------------------------------
   */

  console.log(
    "\n[1] CandidateDetail wildcard tests"
  );


  for (
    const candidateId
    of KNOWN_CANDIDATE_IDS
  ) {

    await testCandidateWildcard(
      candidateId,
      token
    );

  }


  /*
   * ----------------------------------------------------------
   * 2. CandidateDetail named UDF probes
   * ----------------------------------------------------------
   */

  console.log(
    "\n[2] CandidateDetail named UDF probes"
  );


  for (
    const candidateId
    of KNOWN_CANDIDATE_IDS
  ) {

    await testCandidateUdfNames(
      candidateId,
      token
    );

  }


  /*
   * ----------------------------------------------------------
   * 3. CandidatesDetail wildcard
   * ----------------------------------------------------------
   */

  console.log(
    "\n[3] CandidatesDetail wildcard tests"
  );


  await testCandidatesDetailWildcard(
    token
  );


  /*
   * ----------------------------------------------------------
   * 4. Search wildcard
   * ----------------------------------------------------------
   */

  console.log(
    "\n[4] searchCandidateProfile wildcard tests"
  );


  await testSearchWildcard(
    token
  );


  /*
   * ----------------------------------------------------------
   * 5. Search likely UDF names against a real job
   * ----------------------------------------------------------
   *
   * We use the first job returned by the recruiter's
   * configured job list.
   */

  console.log(
    "\n[5] Finding a real recruiter job..."
  );


  const jobParams =
    new URLSearchParams({

      recruiterId:
        process.env.JOBDIVA_RECRUITER_ID

    });


  const jobsResponse =
    await request(

      "GET",

      `/apiv2/bi/JobsListByUser?${jobParams}`,

      token

    );


  const jobRows =
    getRows(
      jobsResponse.data
    );


  const jobs =
    Array.isArray(jobRows)
      ? jobRows
      : jobRows
        ? [jobRows]
        : [];


  const firstJob =
    jobs[0];


  const jobId =
    firstJob &&
    (
      firstJob.JOBID ||
      firstJob.jobId ||
      firstJob.JOB_ID ||
      firstJob.id ||
      firstJob.ID
    );


  console.log(
    `Using Job ID: ${jobId || "NONE"}`
  );


  if (
    jobId
  ) {

    await testSearchByUdf(
      jobId,
      token
    );

  }


  /*
   * ----------------------------------------------------------
   * SAVE
   * ----------------------------------------------------------
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
   * ----------------------------------------------------------
   * FINAL SUMMARY
   * ----------------------------------------------------------
   */

  console.log(`

============================================================
                    DISCOVERY SUMMARY
============================================================

Known candidates tested:
  ${KNOWN_CANDIDATE_IDS.length}

Possible UDF responses:
  ${results.discovered.udfNamesWithData.length}

Wildcard responses containing extra data:
  ${results.discovered.wildcardResults.length}

Possible AI candidate records:
  ${results.discovered.aiCandidates.length}

Results:
  ${OUTPUT}

============================================================

WHAT WE ARE LOOKING FOR

A successful result will look like:

{
  "AI Job ID": "123456",
  "AI Category": "Applicant",
  "AI Stage": "Evaluated"
}

OR:

{
  "AI_JOB_ID": "123456",
  "AI_TYPE": "Candidate"
}

OR any other JobDiva-specific UDF names.

DO NOT MODIFY JOBDIVA.

This diagnostic performs READ operations only.

============================================================

`);

}


main()
  .catch(error => {

    console.error(
      "\nDIAGNOSTIC FAILED:"
    );

    console.error(
      error.stack ||
      error.message
    );

    process.exitCode = 1;

  });