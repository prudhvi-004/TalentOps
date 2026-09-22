#!/usr/bin/env node

/**
 * JobDiva Assignment History Diagnostic
 *
 * Purpose:
 *   Verify exactly what NewUpdatedJobUserRecords returns for one Job ID,
 *   and show both RAW and NORMALIZED assignment events.
 *
 * Usage:
 *   node test-job-assignment-history.js
 *
 * Or use environment variables:
 *
 *   JOBDIVA_BASE_URL=https://api.jobdiva.com \
 *   JOBDIVA_CLIENT_ID=... \
 *   JOBDIVA_USERNAME=... \
 *   JOBDIVA_PASSWORD=... \
 *   JOB_ID=26155924 \
 *   node test-job-assignment-history.js
 *
 * IMPORTANT:
 *   Never commit or paste your credentials into source control/chat.
 */

const readline = require('readline');
const https = require('https');
const http = require('http');

const DEFAULT_BASE_URL =
  process.env.JOBDIVA_BASE_URL || 'https://api.jobdiva.com';

const AUTH_PATH = '/apiv2/v2/authenticate';
const JOB_DETAIL_PATH = '/apiv2/bi/JobDetail';
const ASSIGNMENT_PATH = '/apiv2/bi/NewUpdatedJobUserRecords';


/* ============================================================
   INPUT
   ============================================================ */

function ask(question, secret = false) {
  if (!secret || !process.stdin.isTTY) {
    return new Promise(resolve => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question(question, answer => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  return new Promise(resolve => {
    process.stdout.write(question);

    let value = '';

    const onData = chunk => {
      const str = chunk.toString();

      // Ctrl+C
      if (str === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      }

      // Enter
      if (str === '\r' || str === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);

        process.stdout.write('\n');
        resolve(value.trim());
      }

      // Backspace
      else if (str === '\u007f') {
        value = value.slice(0, -1);
      }

      // Normal character
      else {
        value += str;
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}


/* ============================================================
   URL / HTTP HELPERS
   ============================================================ */

function buildUrl(baseUrl, pathname, params = {}) {
  const url = new URL(
    pathname,
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  );

  for (const [key, value] of Object.entries(params)) {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach(v => {
        url.searchParams.append(key, v);
      });
    } else {
      url.searchParams.set(key, value);
    }
  }

  return url;
}


function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const transport =
      url.protocol === 'http:' ? http : https;

    const req = transport.request(
      url,
      {
        method: options.method || 'GET',

        headers: options.headers || {},

        timeout: 60000
      },
      res => {
        let body = '';

        res.setEncoding('utf8');

        res.on('data', chunk => {
          body += chunk;
        });

        res.on('end', () => {
          let parsed = body;

          try {
            parsed = JSON.parse(body);
          } catch (_) {
            // Response wasn't JSON
          }

          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed,
            rawBody: body
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(
        new Error('Request timed out')
      );
    });

    req.on('error', reject);

    req.end();
  });
}


/* ============================================================
   JOBDIVA RESPONSE NORMALIZATION
   ============================================================ */

function unwrap(data) {
  if (data == null) {
    return data;
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (data.Result !== undefined) {
    return data.Result;
  }

  if (data.result !== undefined) {
    return data.result;
  }

  if (data.data !== undefined) {
    return data.data;
  }

  return data;
}


function rowsFrom(data) {
  const value = unwrap(data);

  if (Array.isArray(value)) {
    return value;
  }

  if (
    value &&
    Array.isArray(value.rows)
  ) {
    return value.rows;
  }

  return value ? [value] : [];
}


/**
 * JobDiva BI endpoints can return tabular data like:
 *
 * {
 *   data: [
 *     ["JOBID", "USERID", "FIRSTNAME"],
 *     ["26155924", "123", "John"]
 *   ]
 * }
 */
function normalizeTabularRows(data) {
  const value = unwrap(data);

  if (!Array.isArray(value)) {
    return rowsFrom(value);
  }

  if (!value.length) {
    return [];
  }

  if (Array.isArray(value[0])) {
    const headers = value[0].map(String);

    return value.slice(1).map(row => {
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = row[index];
      });

      return obj;
    });
  }

  return value;
}


/* ============================================================
   FIELD HELPERS
   ============================================================ */

function first(obj, names) {
  for (const name of names) {
    if (
      obj &&
      obj[name] !== undefined &&
      obj[name] !== null &&
      obj[name] !== ''
    ) {
      return obj[name];
    }
  }

  return '';
}


/* ============================================================
   DATE HELPERS
   ============================================================ */

function parseDate(value) {
  if (!value) {
    return null;
  }

  const d = new Date(value);

  return Number.isNaN(d.getTime())
    ? null
    : d;
}


function iso(value) {
  const d = parseDate(value);

  return d
    ? d.toISOString()
    : '';
}


function localDisplay(value) {
  const d = parseDate(value);

  return d
    ? d.toString()
    : '';
}


/* ============================================================
   ASSIGNMENT ROLE
   ============================================================ */

function assignmentRole(row) {
  const primaryRecruiter =
    String(
      first(row, [
        'PRIMARYRECRUITER',
        'primaryRecruiter'
      ])
    ).toLowerCase();

  const recruiter =
    String(
      first(row, [
        'RECRUITER',
        'recruiter'
      ])
    ).toLowerCase();

  const primarySales =
    String(
      first(row, [
        'PRIMARYSALES',
        'primarySales'
      ])
    ).toLowerCase();

  const sales =
    String(
      first(row, [
        'SALES',
        'sales'
      ])
    ).toLowerCase();


  if (
    ['1', 'true', 'y', 'yes']
      .includes(primaryRecruiter)
  ) {
    return 'Primary Recruiter';
  }


  if (
    ['1', 'true', 'y', 'yes']
      .includes(recruiter)
  ) {
    return 'Recruiter';
  }


  if (
    ['1', 'true', 'y', 'yes']
      .includes(primarySales)
  ) {
    return 'Primary Sales';
  }


  if (
    ['1', 'true', 'y', 'yes']
      .includes(sales)
  ) {
    return 'Sales';
  }


  return 'User';
}


/* ============================================================
   NORMALIZE ASSIGNMENT RECORD
   ============================================================ */

function normalizeAssignment(row, requestedJobId) {
  const jobId =
    first(row, [
      'JOBID',
      'jobId',
      'jobID',
      'ID',
      'id'
    ]);


  const userId =
    first(row, [
      'USERID',
      'userId',
      'USER_ID',
      'id'
    ]);


  const firstName =
    first(row, [
      'FIRSTNAME',
      'firstName',
      'firstname'
    ]);


  const lastName =
    first(row, [
      'LASTNAME',
      'lastName',
      'lastname'
    ]);


  const name =
    [
      firstName,
      lastName
    ]
      .filter(Boolean)
      .join(' ')
      .trim();


  const updated =
    first(row, [
      'DATEUPDATED',
      'dateUpdated'
    ]);


  const assigned =
    first(row, [
      'DATELASTASSIGNED',
      'dateLastAssigned'
    ]);


  return {

    requestedJobId:
      String(requestedJobId),

    jobId:
      String(jobId),

    userId:
      String(userId),

    userName:
      name ||
      `User ${userId}`,

    role:
      assignmentRole(row),

    rawDateUpdated:
      updated,

    rawDateLastAssigned:
      assigned,

    dateUpdatedISO:
      iso(updated),

    dateLastAssignedISO:
      iso(assigned),

    dateLastAssignedLocal:
      localDisplay(assigned),

    assignmentTimestampMs:
      parseDate(assigned)?.getTime() ?? null,

    recruiter:
      first(row, [
        'RECRUITER',
        'recruiter'
      ]),

    primaryRecruiter:
      first(row, [
        'PRIMARYRECRUITER',
        'primaryRecruiter'
      ]),

    sales:
      first(row, [
        'SALES',
        'sales'
      ]),

    primarySales:
      first(row, [
        'PRIMARYSALES',
        'primarySales'
      ])
  };
}


/* ============================================================
   JOBDIVA 14-DAY WINDOW HANDLING
   ============================================================ */

function windows(start, end) {
  const result = [];

  // Slightly less than 14 days
  // to remain safely within JobDiva's limit.
  const maxMs =
    (14 * 24 * 60 * 60 * 1000) - 1000;


  let cursor =
    new Date(start.getTime());


  while (cursor < end) {

    const windowEnd =
      new Date(
        Math.min(
          cursor.getTime() + maxMs,
          end.getTime()
        )
      );


    result.push({
      from: new Date(cursor),
      to: windowEnd
    });


    // Start the next window one second
    // after the previous window.
    cursor =
      new Date(
        windowEnd.getTime() + 1000
      );
  }


  return result;
}


/* ============================================================
   JOBDIVA DATE FORMAT
   ============================================================ */

function formatJDDate(d) {
  const pad =
    n => String(n).padStart(2, '0');


  return (
    `${pad(d.getMonth() + 1)}/` +
    `${pad(d.getDate())}/` +
    `${d.getFullYear()} ` +
    `${pad(d.getHours())}:` +
    `${pad(d.getMinutes())}:` +
    `${pad(d.getSeconds())}`
  );
}


/* ============================================================
   MAIN
   ============================================================ */

async function main() {

  console.log(
    '\n=== JobDiva Assignment History Diagnostic ===\n'
  );


  /* ----------------------------------------------------------
     1. GET CREDENTIALS
     ---------------------------------------------------------- */

  const baseUrl =
    process.env.JOBDIVA_BASE_URL ||
    await ask(
      `JobDiva base URL [${DEFAULT_BASE_URL}]: `
    ) ||
    DEFAULT_BASE_URL;


  const clientId =
    process.env.JOBDIVA_CLIENT_ID ||
    await ask('Client ID: ');


  const username =
    process.env.JOBDIVA_USERNAME ||
    await ask('API Username: ');


  const password =
    process.env.JOBDIVA_PASSWORD ||
    await ask(
      'API Password: ',
      true
    );


  const jobId =
    process.env.JOB_ID ||
    await ask('Job ID: ');


  if (
    !clientId ||
    !username ||
    !password ||
    !jobId
  ) {
    throw new Error(
      'Client ID, username, password and Job ID are required.'
    );
  }


  /* ----------------------------------------------------------
     2. AUTHENTICATE
     ---------------------------------------------------------- */

  console.log(
    '\n[1] Authenticating...'
  );


  const authUrl =
    buildUrl(
      baseUrl,
      AUTH_PATH,
      {
        clientid: clientId,
        username,
        password
      }
    );


  const auth =
    await request(
      authUrl,
      {
        headers: {
          Accept: '*/*'
        }
      }
    );


  if (
    auth.status < 200 ||
    auth.status >= 300
  ) {
    throw new Error(
      `Authentication failed: HTTP ${auth.status}\n${auth.rawBody}`
    );
  }


  const tokenValue =
    typeof auth.body === 'string'
      ? auth.body.trim()
      : first(
          auth.body,
          [
            'token',
            'Token',
            'Result'
          ]
        );


  if (!tokenValue) {
    throw new Error(
      'Authentication returned no token.'
    );
  }


  console.log(
    '    Authentication: OK'
  );


  const headers = {
    Accept: 'application/json',

    Authorization: tokenValue
  };


  /* ----------------------------------------------------------
     3. FETCH JOB DETAIL
     ---------------------------------------------------------- */

  console.log(
    `[2] Fetching JobDetail for Job ID ${jobId}...`
  );


  const jobUrl =
    buildUrl(
      baseUrl,
      JOB_DETAIL_PATH,
      {
        jobId: Number(jobId)
      }
    );


  const jobResponse =
    await request(
      jobUrl,
      {
        headers
      }
    );


  if (
    jobResponse.status < 200 ||
    jobResponse.status >= 300
  ) {
    throw new Error(
      `JobDetail failed: HTTP ${jobResponse.status}\n${jobResponse.rawBody}`
    );
  }


  const jobRows =
    normalizeTabularRows(
      jobResponse.body
    );


  const job =
    jobRows.find(
      row =>
        String(
          first(
            row,
            [
              'JOBID',
              'jobId',
              'jobID',
              'ID',
              'id'
            ]
          )
        ) === String(jobId)
    ) ||
    jobRows[0];


  if (!job) {
    throw new Error(
      `JobDetail returned no row for Job ID ${jobId}.`
    );
  }


  /* ----------------------------------------------------------
     4. DETERMINE POSTING DATE
     ---------------------------------------------------------- */

  const postingRaw =
    first(
      job,
      [
        'ISSUEDATE',
        'issuedDate',

        'POSTINGDATE',
        'postingDate',

        'DATEPOSTED',
        'datePosted',

        'POSTDATE',
        'postDate'
      ]
    );


  const postingDate =
    parseDate(postingRaw);


  console.log(
    '    Job title:',
    first(
      job,
      [
        'TITLE',
        'title',
        'jobTitle'
      ]
    )
  );


  console.log(
    '    Posting date raw:',
    postingRaw ||
      '(not found)'
  );


  console.log(
    '    Posting date ISO:',
    iso(postingRaw) ||
      '(not parseable)'
  );


  if (!postingDate) {
    throw new Error(
      'Could not determine posting/issue date from JobDetail.'
    );
  }


  /* ----------------------------------------------------------
     5. BUILD DATE WINDOWS
     ---------------------------------------------------------- */

  const now =
    new Date();


  const dateWindows =
    windows(
      postingDate,
      now
    );


  console.log(
    `\n[3] Querying ${ASSIGNMENT_PATH}`
  );


  console.log(
    `    Range: ${postingDate.toISOString()} -> ${now.toISOString()}`
  );


  console.log(
    `    Windows: ${dateWindows.length} (each <= 14 days)`
  );


  /* ----------------------------------------------------------
     6. FETCH ASSIGNMENT RECORDS
     ---------------------------------------------------------- */

  const allRows = [];


  for (
    let i = 0;
    i < dateWindows.length;
    i++
  ) {

    const w =
      dateWindows[i];


    const fromDate =
      formatJDDate(w.from);


    const toDate =
      formatJDDate(w.to);


    process.stdout.write(
      `    Window ${i + 1}/${dateWindows.length}: ` +
      `${fromDate} -> ${toDate} ... `
    );


    const url =
      buildUrl(
        baseUrl,
        ASSIGNMENT_PATH,
        {
          fromDate,
          toDate
        }
      );


    const response =
      await request(
        url,
        {
          headers
        }
      );


    if (
      response.status < 200 ||
      response.status >= 300
    ) {

      console.log(
        `HTTP ${response.status}`
      );

      console.log(
        response.rawBody
      );

      continue;
    }


    const rows =
      normalizeTabularRows(
        response.body
      );


    /*
     * NewUpdatedJobUserRecords is not necessarily
     * Job-ID-specific, so filter locally.
     */

    const matching =
      rows.filter(
        row =>
          String(
            first(
              row,
              [
                'JOBID',
                'jobId',
                'jobID',
                'ID',
                'id'
              ]
            )
          ) === String(jobId)
      );


    console.log(
      `${rows.length} total, ` +
      `${matching.length} matching Job ID`
    );


    allRows.push(
      ...matching.map(
        row => ({
          ...row,

          __windowFrom:
            fromDate,

          __windowTo:
            toDate
        })
      )
    );
  }


  /* ----------------------------------------------------------
     7. NORMALIZE
     ---------------------------------------------------------- */

  console.log(
    `\n[4] Matching raw assignment records: ${allRows.length}`
  );


  const normalized =
    allRows
      .map(
        row =>
          normalizeAssignment(
            row,
            jobId
          )
      )
      .sort(
        (a, b) =>
          (
            a.assignmentTimestampMs ??
            Infinity
          ) -
          (
            b.assignmentTimestampMs ??
            Infinity
          )
      );


  /* ----------------------------------------------------------
     8. PRINT NORMALIZED RECORDS
     ---------------------------------------------------------- */

  console.log(
    '\n=== NORMALIZED ASSIGNMENT RECORDS ===\n'
  );


  if (!normalized.length) {

    console.log(
      'No assignment records were returned for this Job ID.'
    );

  } else {

    normalized.forEach(
      (item, index) => {

        console.log(
          `#${index + 1}`
        );

        console.log(
          JSON.stringify(
            item,
            null,
            2
          )
        );

        console.log('');
      }
    );
  }


  /* ----------------------------------------------------------
     9. SAME TIMESTAMP CHECK
     ---------------------------------------------------------- */

  console.log(
    '\n=== SAME TIMESTAMP CHECK ===\n'
  );


  const byTimestamp =
    new Map();


  for (const item of normalized) {

    const key =
      item.assignmentTimestampMs;


    if (key == null) {
      continue;
    }


    if (!byTimestamp.has(key)) {
      byTimestamp.set(
        key,
        []
      );
    }


    byTimestamp
      .get(key)
      .push(item);
  }


  let sameTimestampGroupCount = 0;


  for (
    const [
      timestamp,
      items
    ] of byTimestamp.entries()
  ) {

    if (items.length <= 1) {
      continue;
    }


    sameTimestampGroupCount++;


    console.log(
      `Timestamp: ${new Date(
        Number(timestamp)
      ).toISOString()}`
    );


    items.forEach(
      item => {

        console.log(
          `  - ${item.userName} | ` +
          `${item.role} | ` +
          `USERID=${item.userId}`
        );
      }
    );


    console.log(
      '  => These records have the exact same parsed instant.'
    );


    console.log('');
  }


  if (!sameTimestampGroupCount) {

    console.log(
      'No multiple assignment records share the exact same parsed timestamp.'
    );
  }


  /* ----------------------------------------------------------
     10. PRINT RAW RECORDS
     ---------------------------------------------------------- */

  console.log(
    '\n=== RAW RECORDS ===\n'
  );


  allRows.forEach(
    (row, index) => {

      console.log(
        `RAW #${index + 1}`
      );


      console.log(
        JSON.stringify(
          row,
          null,
          2
        )
      );


      console.log('');
    }
  );


  /* ----------------------------------------------------------
     11. VERIFICATION NOTES
     ---------------------------------------------------------- */

  console.log(
    '\n=== VERIFICATION NOTES ==='
  );


  console.log(
    '1. Compare raw DATELASTASSIGNED values first.'
  );


  console.log(
    '2. The normalized ISO timestamp is derived from DATELASTASSIGNED.'
  );


  console.log(
    '3. If several users have the exact same DATELASTASSIGNED value, the API really returned the same timestamp for those records.'
  );


  console.log(
    '4. That does NOT by itself prove they were assigned simultaneously by the same user/action; it only proves the assignment records share that timestamp.'
  );


  console.log(
    '5. DATEUPDATED is shown separately because it is not necessarily the assignment timestamp.'
  );


  console.log(
    '6. This script does not invent "Unassigned -> X" or an actor who performed the assignment.'
  );


  /* ----------------------------------------------------------
     12. FINAL SUMMARY
     ---------------------------------------------------------- */

  console.log(
    '\n=== SUMMARY ==='
  );


  console.log(
    JSON.stringify(
      {
        jobId:
          String(jobId),

        jobTitle:
          first(
            job,
            [
              'TITLE',
              'title',
              'jobTitle'
            ]
          ),

        postingDateRaw:
          postingRaw,

        postingDateISO:
          iso(postingRaw),

        assignmentRecordCount:
          normalized.length,

        sameTimestampGroupCount,

        assignments:
          normalized.map(
            x => ({
              userId:
                x.userId,

              userName:
                x.userName,

              role:
                x.role,

              dateLastAssignedRaw:
                x.rawDateLastAssigned,

              dateLastAssignedISO:
                x.dateLastAssignedISO,

              dateUpdatedRaw:
                x.rawDateUpdated,

              dateUpdatedISO:
                x.dateUpdatedISO
            })
          )
      },
      null,
      2
    )
  );
}


/* ============================================================
   RUN
   ============================================================ */

main().catch(err => {

  console.error(
    '\nERROR:',
    err.message
  );

  process.exit(1);
});