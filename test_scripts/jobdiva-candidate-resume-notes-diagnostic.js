/**
 * ============================================================
 * JOBDIVA CANDIDATE / RESUME / NOTES DIAGNOSTIC
 * ============================================================
 *
 * READ ONLY
 *
 * Tests:
 *
 *   CandidateDetail
 *        ↓
 *   CandidateResumesDetail
 *        ↓
 *   ResumesTextDetail
 *
 *   CandidateAttachmentList
 *
 *   CandidateNotesListDetail
 *
 * NO WRITE OPERATIONS ARE PERFORMED.
 *
 * Candidates discovered earlier:
 *
 *   13955000990084
 *   19627576624339
 *   20109720815038
 *   18958622643495
 *
 * Output:
 *
 *   jobdiva-candidate-resume-notes-diagnostic.json
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
  "jobdiva-candidate-resume-notes-diagnostic.json";


// ============================================================
// REAL CANDIDATES DISCOVERED FROM JOB SUBMITTALS
// ============================================================

const CANDIDATE_IDS = [

  "13955000990084",

  "19627576624339",

  "20109720815038",

  "18958622643495"

];


// ============================================================
// RESULTS
// ============================================================

const results = {

  generatedAt:
    new Date().toISOString(),

  authentication: null,

  candidates: [],

  summary: {

    candidatesTested:
      CANDIDATE_IDS.length,

    candidateDetailSuccess:
      0,

    resumeDetailSuccess:
      0,

    resumeTextSuccess:
      0,

    attachmentListSuccess:
      0,

    notesSuccess:
      0,

    resumeIdsFound: [],

    attachmentFilesFound: [],

    notesFound: 0

  }

};


// ============================================================
// HTTP
// ============================================================

async function request(
  method,
  path,
  token,
  body = null
) {

  const headers = {

    Accept:
      "application/json"

  };


  if (body !== null) {

    headers[
      "Content-Type"
    ] =
      "application/json";

  }


  if (token) {

    headers.Authorization =
      token;

  }


  const response =
    await fetch(

      `${BASE_URL}${path}`,

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
// AUTHENTICATE
// ============================================================

async function authenticate() {

  console.log(
    "\n========================================"
  );

  console.log(
    "AUTHENTICATION"
  );

  console.log(
    "========================================"
  );


  if (
    !CLIENT_ID ||
    !USERNAME ||
    !PASSWORD
  ) {

    throw new Error(

      "Missing JOBDIVA_CLIENT_ID, " +
      "JOBDIVA_USERNAME or JOBDIVA_PASSWORD"

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
      "Authentication token not returned."
    );

  }


  return token;

}


// ============================================================
// GENERIC ARRAY EXTRACTION
// ============================================================

function getDataArray(data) {

  if (
    Array.isArray(data)
  ) {

    return data;

  }


  if (
    Array.isArray(data?.data)
  ) {

    return data.data;

  }


  if (
    Array.isArray(data?.results)
  ) {

    return data.results;

  }


  if (
    Array.isArray(data?.Result)
  ) {

    return data.Result;

  }


  return [];

}


// ============================================================
// RECURSIVE WALKER
// ============================================================

function walk(
  value,
  callback
) {

  if (
    Array.isArray(value)
  ) {

    for (
      const item
      of value
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
// FIND RESUME IDS
// ============================================================

function extractResumeIds(
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

        const lower =
          key.toLowerCase();


        if (

          [
            "resumeid",
            "resume_id"
          ].includes(lower)

          &&

          (
            typeof value === "string" ||
            typeof value === "number"
          )

        ) {

          const id =
            String(value).trim();


          if (id) {

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
// FIND FILE NAMES
// ============================================================

function extractFileNames(
  data
) {

  const names =
    new Set();


  walk(

    data,

    (obj) => {

      for (
        const [key, value]
        of Object.entries(obj)
      ) {

        const lower =
          key.toLowerCase();


        if (

          [
            "filename",
            "file_name",
            "name"
          ].includes(lower)

          &&

          typeof value === "string"

          &&

          value.trim()

        ) {

          const valueString =
            value.trim();


          /*
           * Only consider strings that
           * look like files.
           */

          if (

            valueString.includes(".") ||

            valueString.toLowerCase()
              .includes("resume")

          ) {

            names.add(
              valueString
            );

          }

        }

      }

    }

  );


  return [
    ...names
  ];

}


// ============================================================
// TEST CANDIDATE DETAIL
// ============================================================

async function testCandidateDetail(
  candidate,
  token
) {

  console.log(
    "\n----------------------------------------"
  );

  console.log(
    "CandidateDetail"
  );

  console.log(
    "----------------------------------------"
  );


  const path =
    `/apiv2/bi/CandidateDetail?candidateId=` +
    encodeURIComponent(
      candidate.candidateId
    );


  const response =
    await request(
      "GET",
      path,
      token
    );


  candidate.candidateDetail = {

    endpoint:
      path,

    status:
      response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    rawResponse:
      response.data

  };


  console.log(
    `HTTP ${response.status}`
  );


  if (
    candidate.candidateDetail.success
  ) {

    results.summary
      .candidateDetailSuccess++;

  }

}


// ============================================================
// TEST CANDIDATE RESUMES
// ============================================================

async function testCandidateResumes(
  candidate,
  token
) {

  console.log(
    "\n----------------------------------------"
  );

  console.log(
    "CandidateResumesDetail"
  );

  console.log(
    "----------------------------------------"
  );


  const path =
    `/apiv2/bi/CandidateResumesDetail?candidateId=` +
    encodeURIComponent(
      candidate.candidateId
    );


  const response =
    await request(
      "GET",
      path,
      token
    );


  const resumeIds =
    extractResumeIds(
      response.data
    );


  candidate.resumeDetails = {

    endpoint:
      path,

    status:
      response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    resumeIds,

    rawResponse:
      response.data

  };


  console.log(
    `HTTP ${response.status}`
  );


  console.log(
    `Resume IDs found: ${resumeIds.length}`
  );


  if (
    resumeIds.length
  ) {

    console.log(
      resumeIds.join(", ")
    );


    for (
      const resumeId
      of resumeIds
    ) {

      results.summary
        .resumeIdsFound
        .push({

          candidateId:
            candidate.candidateId,

          resumeId

        });

    }

  }


  if (
    candidate.resumeDetails.success
  ) {

    results.summary
      .resumeDetailSuccess++;

  }


  return resumeIds;

}


// ============================================================
// TEST RESUME TEXT
// ============================================================

async function testResumeText(
  candidate,
  resumeIds,
  token
) {

  console.log(
    "\n----------------------------------------"
  );

  console.log(
    "ResumesTextDetail"
  );

  console.log(
    "----------------------------------------"
  );


  if (
    !resumeIds.length
  ) {

    console.log(
      "No resume IDs. Skipping."
    );


    candidate.resumeText = {

      skipped:
        true,

      reason:
        "No resume IDs returned by CandidateResumesDetail"

    };


    return;

  }


  const params =
    new URLSearchParams();


  for (
    const resumeId
    of resumeIds
  ) {

    params.append(
      "resumeIds",
      resumeId
    );

  }


  const path =
    `/apiv2/bi/ResumesTextDetail?` +
    params.toString();


  const response =
    await request(
      "GET",
      path,
      token
    );


  candidate.resumeText = {

    endpoint:
      path,

    status:
      response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    rawResponse:
      response.data

  };


  console.log(
    `HTTP ${response.status}`
  );


  if (
    candidate.resumeText.success
  ) {

    results.summary
      .resumeTextSuccess++;

  }


  console.log(
    "\nResume text response preview:"
  );


  console.dir(

    response.data,

    {

      depth: 6,

      maxArrayLength: 10

    }

  );

}


// ============================================================
// TEST ATTACHMENT LIST
// ============================================================

async function testAttachments(
  candidate,
  token
) {

  console.log(
    "\n----------------------------------------"
  );

  console.log(
    "CandidateAttachmentList"
  );

  console.log(
    "----------------------------------------"
  );


  const path =
    `/apiv2/bi/CandidateAttachmentList?candidateId=` +
    encodeURIComponent(
      candidate.candidateId
    );


  const response =
    await request(
      "GET",
      path,
      token
    );


  const fileNames =
    extractFileNames(
      response.data
    );


  candidate.attachments = {

    endpoint:
      path,

    status:
      response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    fileNames,

    rawResponse:
      response.data

  };


  console.log(
    `HTTP ${response.status}`
  );


  console.log(
    `Possible file names: ${fileNames.length}`
  );


  if (
    fileNames.length
  ) {

    console.log(
      fileNames.join("\n")
    );


    for (
      const fileName
      of fileNames
    ) {

      results.summary
        .attachmentFilesFound
        .push({

          candidateId:
            candidate.candidateId,

          fileName

        });

    }

  }


  if (
    candidate.attachments.success
  ) {

    results.summary
      .attachmentListSuccess++;

  }

}


// ============================================================
// TEST CANDIDATE NOTES
// ============================================================

async function testCandidateNotes(
  candidate,
  token
) {

  console.log(
    "\n----------------------------------------"
  );

  console.log(
    "CandidateNotesListDetail"
  );

  console.log(
    "----------------------------------------"
  );


  /*
   * This endpoint expects candidateIds[]
   */

  const params =
    new URLSearchParams();


  params.append(
    "candidateIds",
    candidate.candidateId
  );


  const path =
    `/apiv2/bi/CandidateNotesListDetail?` +
    params.toString();


  const response =
    await request(
      "GET",
      path,
      token
    );


  const notes =
    getDataArray(
      response.data
    );


  candidate.notes = {

    endpoint:
      path,

    status:
      response.status,

    success:
      response.status >= 200 &&
      response.status < 300,

    noteCount:
      notes.length,

    rawResponse:
      response.data

  };


  console.log(
    `HTTP ${response.status}`
  );


  console.log(
    `Notes returned: ${notes.length}`
  );


  if (
    candidate.notes.success
  ) {

    results.summary
      .notesSuccess++;

  }


  results.summary.notesFound +=
    notes.length;


  if (
    notes.length
  ) {

    console.log(
      "\nNotes preview:"
    );


    console.dir(

      notes.slice(0, 10),

      {

        depth: 6

      }

    );

  }

}


// ============================================================
// TEST ONE CANDIDATE
// ============================================================

async function testCandidate(
  candidateId,
  index,
  token
) {

  console.log(`

============================================================
CANDIDATE ${index}/${CANDIDATE_IDS.length}
ID: ${candidateId}
============================================================

`);


  const candidate = {

    candidateId

  };


  results.candidates.push(
    candidate
  );


  /*
   * 1. Candidate profile
   */

  await testCandidateDetail(
    candidate,
    token
  );


  /*
   * 2. Candidate resumes
   */

  const resumeIds =
    await testCandidateResumes(
      candidate,
      token
    );


  /*
   * 3. Resume text
   */

  await testResumeText(
    candidate,
    resumeIds,
    token
  );


  /*
   * 4. Attachments
   */

  await testAttachments(
    candidate,
    token
  );


  /*
   * 5. Existing notes
   */

  await testCandidateNotes(
    candidate,
    token
  );

}


// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log(`

╔══════════════════════════════════════════════════════════════╗
║       JOBDIVA CANDIDATE / RESUME / NOTES DIAGNOSTIC        ║
║                         READ ONLY                           ║
╚══════════════════════════════════════════════════════════════╝

`);

  console.log(
    `Base URL: ${BASE_URL}`
  );

  console.log(
    `Candidates: ${CANDIDATE_IDS.length}`
  );


  try {

    /*
     * Authenticate
     */

    const token =
      await authenticate();


    /*
     * Test candidates
     */

    for (
      let i = 0;
      i < CANDIDATE_IDS.length;
      i++
    ) {

      await testCandidate(

        CANDIDATE_IDS[i],

        i + 1,

        token

      );

    }


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

    console.log(`

╔══════════════════════════════════════════════════════════════╗
║                         SUMMARY                             ║
╚══════════════════════════════════════════════════════════════╝

Candidates tested:
  ${results.summary.candidatesTested}

CandidateDetail success:
  ${results.summary.candidateDetailSuccess}

CandidateResumesDetail success:
  ${results.summary.resumeDetailSuccess}

ResumesTextDetail success:
  ${results.summary.resumeTextSuccess}

CandidateAttachmentList success:
  ${results.summary.attachmentListSuccess}

CandidateNotesListDetail success:
  ${results.summary.notesSuccess}

Resume IDs found:
  ${results.summary.resumeIdsFound.length}

Attachment files found:
  ${results.summary.attachmentFilesFound.length}

Notes found:
  ${results.summary.notesFound}

Output:
  ${OUTPUT}

`);


    /*
     * Show resume IDs explicitly
     */

    if (
      results.summary.resumeIdsFound.length
    ) {

      console.log(
        "\nResume IDs:"
      );


      for (
        const item
        of results.summary.resumeIdsFound
      ) {

        console.log(

          `  Candidate ${item.candidateId}` +
          ` → Resume ${item.resumeId}`

        );

      }

    }


    /*
     * Show attachment names explicitly
     */

    if (
      results.summary.attachmentFilesFound.length
    ) {

      console.log(
        "\nAttachment files:"
      );


      for (
        const item
        of results.summary.attachmentFilesFound
      ) {

        console.log(

          `  Candidate ${item.candidateId}` +
          ` → ${item.fileName}`

        );

      }

    }


    console.log(`

============================================================

NEXT STEP

Upload:

  ${OUTPUT}

We will determine:

1. Which resume belongs to the candidate
2. Whether JobDiva returns actual resume text
3. Whether the resume can be downloaded
4. What attachment/file fields are available
5. What existing candidate notes look like
6. The exact fields required by createCandidateNote

NO NOTES WILL BE CREATED BY THIS SCRIPT.

============================================================
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
     * Save partial results
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