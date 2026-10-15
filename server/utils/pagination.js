// =============================================================
// CURSOR PAGINATION — pagination.js
// =============================================================
// Keyset ("cursor") pagination over an already-loaded, cached result set.
//
// Why cursor and not offset/page numbers:
//   → The cursor encodes the sort position of the last row the client saw
//     ({ v: sortValue, id }), so the next page starts strictly after it.
//     Rows added/removed between requests (the ATS cache refreshes every
//     15s) never cause duplicates or skipped rows, unlike OFFSET paging.
//   → Page N costs the same as page 1: a binary search to the cursor, then
//     a slice of `limit` rows. Only `limit` rows are serialized, sent and
//     rendered, instead of the whole data set.
//
// Opt-in contract (so existing callers keep working):
//   GET /api/x                 → legacy: full array in `data`
//   GET /api/x?limit=25        → { data, pageInfo: { limit, nextCursor, hasMore, total }, facets? }
//   GET /api/x?limit=25&cursor=<pageInfo.nextCursor>
//
// Shared optional filters (applied before paging, so totals are exact):
//   q            text search over the endpoint's searchFields
//   from, to     ISO bounds on the endpoint's date field  (from <= d < to)
//   + any endpoint-specific filters / facets declared by the route
// =============================================================

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 500;

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (parsed && 'v' in parsed && 'id' in parsed) return parsed;
  } catch (_) { /* fall through */ }
  const err = new Error('Invalid cursor');
  err.status = 400;
  throw err;
}

function parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// Parses a date-ish value to epoch ms (0 when missing/invalid).
function toTime(value) {
  const t = new Date(value || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Total order over (sortValue, id) in the requested direction.
function compare(a, b, order) {
  let c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
  if (c === 0) c = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return order === 'asc' ? c : -c;
}

/**
 * paginate(rows, opts)
 * @param rows            array to page over (not mutated)
 * @param opts.sortValue  row => number|string   sort key (default: none → keep order)
 * @param opts.idOf       row => string          unique tie-breaker
 * @param opts.order      'desc' (default) | 'asc'
 * @param opts.limit      page size
 * @param opts.cursor     opaque cursor from a previous page
 * @returns { items, pageInfo }
 */
function paginate(rows, { sortValue, idOf, order = 'desc', limit, cursor } = {}) {
  const size = parseLimit(limit);
  const keyed = rows.map((row, index) => ({
    row,
    v: sortValue ? sortValue(row) : 0,
    // Falls back to the original position so un-keyed rows still have a total order.
    id: String(idOf ? idOf(row) : String(index).padStart(10, '0')),
  }));
  keyed.sort((a, b) => compare(a, b, order));

  // Binary search for the first row strictly after the cursor.
  let start = 0;
  const after = decodeCursor(cursor);
  if (after) {
    const probe = { v: after.v, id: String(after.id) };
    let lo = 0;
    let hi = keyed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(keyed[mid], probe, order) <= 0) lo = mid + 1; else hi = mid;
    }
    start = lo;
  }

  const slice = keyed.slice(start, start + size);
  const hasMore = start + size < keyed.length;
  const last = slice[slice.length - 1];
  return {
    items: slice.map(k => k.row),
    pageInfo: {
      limit: size,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ v: last.v, id: last.id }) : null,
      total: keyed.length,
    },
  };
}

function matchesText(row, fields, q) {
  if (!q) return true;
  const needle = String(q).trim().toLowerCase();
  if (!needle) return true;
  return fields.some(field => {
    const value = typeof field === 'function' ? field(row) : row[field];
    if (Array.isArray(value)) return value.some(v => String(v ?? '').toLowerCase().includes(needle));
    return String(value ?? '').toLowerCase().includes(needle);
  });
}

/**
 * respond(req, res, rows, opts)
 * Applies filters, then either returns the legacy full array (no `limit`)
 * or one cursor page.
 *
 * opts.sortValue / opts.idOf / opts.order   see paginate()
 * opts.dateOf       row => date-ish           enables ?from=&to=
 * opts.searchFields [field | row=>value]      enables ?q=
 * opts.filters      { name: (row, value) => bool }   query params that narrow the scope
 * opts.facets       { name: row => key }      ?name=<key> filters AFTER counts are taken,
 *                                             and per-key counts are returned in `facets`
 *                                             (so tab/segment badges stay accurate).
 * opts.distinctOf   row => key                ?distinct=1 → pageInfo.distinctTotal
 * opts.meta         rows => object            extra payload sent with the first page only
 */
function respond(req, res, rows, opts = {}) {
  const q = req.query || {};
  if (q.limit === undefined && q.cursor === undefined) {
    return res.json({ success: true, data: rows });
  }

  let scope = rows;
  if (opts.dateOf && (q.from || q.to)) {
    const from = q.from ? toTime(q.from) : -Infinity;
    const to = q.to ? toTime(q.to) : Infinity;
    scope = scope.filter(row => {
      const t = toTime(opts.dateOf(row));
      return t >= from && t < to;
    });
  }
  if (opts.searchFields && q.q) scope = scope.filter(row => matchesText(row, opts.searchFields, q.q));
  for (const [name, test] of Object.entries(opts.filters || {})) {
    if (q[name] !== undefined && q[name] !== '') scope = scope.filter(row => test(row, q[name]));
  }

  let facets;
  let page = scope;
  if (opts.facets) {
    facets = {};
    for (const [name, keyOf] of Object.entries(opts.facets)) {
      const counts = { all: scope.length };
      for (const row of scope) {
        const key = keyOf(row);
        counts[key] = (counts[key] || 0) + 1;
      }
      facets[name] = counts;
      if (q[name] && q[name] !== 'all') page = page.filter(row => keyOf(row) === q[name]);
    }
  }

  let items;
  let pageInfo;
  try {
    ({ items, pageInfo } = paginate(page, {
      sortValue: opts.sortValue,
      idOf: opts.idOf,
      order: opts.order,
      limit: q.limit,
      cursor: q.cursor,
    }));
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
  if (opts.distinctOf && q.distinct) {
    pageInfo.distinctTotal = new Set(page.map(opts.distinctOf)).size;
  }
  // Optional first-page-only extras (e.g. the option list for a filter dropdown),
  // computed over the unfiltered rows.
  const meta = opts.meta && !q.cursor ? opts.meta(rows) : undefined;
  return res.json({ success: true, data: items, pageInfo, ...(facets ? { facets } : {}), ...(meta ? { meta } : {}) });
}

module.exports = { paginate, respond, matchesText, toTime, encodeCursor, decodeCursor, DEFAULT_LIMIT, MAX_LIMIT };
