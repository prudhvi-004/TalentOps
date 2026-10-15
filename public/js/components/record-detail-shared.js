/* =============================================================
   RECORD DETAIL SHARED HELPERS — record-detail-shared.js
   =============================================================
   Shared logic for the dashboard tile "detail" pages (Submittals,
   Interviews, Starts, First Presentation, My Primary Jobs):
     - date-range filter buttons (Today/This Week/This Month/Custom)
     - candidate/job row navigation wiring
   ============================================================= */

const RecordDetailShared = (() => {

  function inRange(dateRaw, range) {
    if (!dateRaw) return range !== 'custom';
    const d = new Date(dateRaw);
    if (Number.isNaN(d.getTime())) return false;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Upper bound for today/week/month: these are trailing windows ending
    // "now", not open-ended into the future. Without this cap, a record
    // dated months from now (e.g. a future placement start date) would
    // incorrectly match every range, including "Today".
    const endOfToday = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    if (range === 'today') return d >= startOfDay && d < endOfToday;
    // Calendar-based: week starts Monday (Monday = day 1), month starts on the 1st.
    if (range === 'week') {
      const daysSinceMonday = (startOfDay.getDay() + 6) % 7;
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
      return d >= weekStart && d < endOfToday;
    }
    if (range === 'month') return d >= new Date(now.getFullYear(), now.getMonth(), 1) && d < endOfToday;
    if (range === 'custom') {
      const from = document.getElementById('dateFrom')?.value;
      const to = document.getElementById('dateTo')?.value;
      if (from && d < new Date(from)) return false;
      if (to && d > new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1)) return false;
      return true;
    }
    return true;
  }

  /**
   * rangeParams(range, fromValue, toValue)
   * Server-side twin of inRange(): turns the selected range into the
   * ?from=&to= bounds (ISO, from <= d < to) the paginated endpoints filter on,
   * using the user's local calendar so Today/Week/Month match what they see.
   */
  function rangeParams(range, fromValue, toValue) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    if (range === 'today') return { from: startOfDay.toISOString(), to: endOfToday.toISOString() };
    if (range === 'week') {
      const daysSinceMonday = (startOfDay.getDay() + 6) % 7;
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
      return { from: weekStart.toISOString(), to: endOfToday.toISOString() };
    }
    if (range === 'month') {
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: endOfToday.toISOString() };
    }
    if (range === 'custom') {
      const out = {};
      if (fromValue) out.from = new Date(fromValue).toISOString();
      if (toValue) out.to = new Date(new Date(toValue).getTime() + 24 * 60 * 60 * 1000).toISOString();
      return out;
    }
    return {};
  }

  /**
   * pagedTable({ wrap, headHtml, rowHtml, emptyHtml, fetchPage })
   * Cursor-paginated <table>: load(params) fetches page 1 for the given
   * filters; further pages are appended as the footer scrolls into view
   * (or via its Load more button). Each filter change = a new load() and the
   * server does the filtering, so only ~25 rows are ever fetched/rendered.
   *   fetchPage(params) => ApiService.getX(params)
   *   onPage({ total, facets, pageInfo })  called after every page
   */
  function pagedTable({ wrap, headHtml, rowHtml, emptyHtml, errorTitle, fetchPage, onPage }) {
    const pager = ApiService.createPager(fetchPage);
    let shown = 0;

    function footer(page) {
      LoadMore.attach(wrap, {
        shown, total: page.pageInfo.total, hasMore: pager.hasMore,
        onMore: async () => { const next = await pager.next(); if (next) paint(next, true); },
      });
    }

    function paint(page, append) {
      if (!wrap.isConnected) return;
      if (!page.success) {
        wrap.innerHTML = `<div class="empty"><h3>${errorTitle || 'Could not load records'}</h3><p>${page.error}</p></div>`;
        return;
      }
      if (onPage) onPage(page);
      if (!append) {
        shown = 0;
        LoadMore.clear(wrap);
        if (page.rows.length === 0) { wrap.innerHTML = emptyHtml; return; }
        wrap.innerHTML = `<table class="data-table"><thead>${headHtml}</thead><tbody></tbody></table>`;
      }
      wrap.querySelector('tbody').insertAdjacentHTML('beforeend', page.rows.map(rowHtml).join(''));
      shown += page.rows.length;
      wireRowLinks(wrap);
      footer(page);
    }

    return {
      async load(params) {
        const page = await pager.reset(params);
        if (page) paint(page, false);
      },
    };
  }

  /**
   * Wires the Today/Week/Month/Custom buttons + custom date inputs + search
   * box that every detail page renders identically.
   *
   * @param container   the page's root element
   * @param getRange    () => current active range value
   * @param setRange    (value) => void, updates the page's active range
   * @param onChange    called whenever a filter changes (re-apply + re-render)
   */
  function wireCommonControls(container, getRange, setRange, onChange) {
    container.querySelector('[data-nav="/"]').onclick = () => window.navigate('/');

    container.querySelectorAll('[data-range]').forEach(btn => {
      btn.onclick = () => {
        setRange(btn.dataset.range);
        container.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === getRange()));
        const customInputs = document.getElementById('customDateInputs');
        if (customInputs) customInputs.style.display = getRange() === 'custom' ? 'flex' : 'none';
        onChange();
      };
    });

    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    if (dateFrom) dateFrom.onchange = onChange;
    if (dateTo) dateTo.onchange = onChange;

    const search = document.getElementById('searchInput');
    // Each change re-queries the server, so wait for typing to pause.
    if (search) search.oninput = LoadMore.debounce(onChange, 250);
  }

  /** Wires [data-cand]/[data-job-link] anchors rendered inside a table. */
  function wireRowLinks(wrap) {
    wrap.querySelectorAll('[data-cand]').forEach(el => {
      el.onclick = (e) => {
        e.preventDefault();
        window.navigate(`/candidates/${el.dataset.cand}?source=pipeline&jobId=${el.dataset.job}`);
      };
    });
    wrap.querySelectorAll('[data-job-link]').forEach(el => {
      el.onclick = (e) => {
        e.preventDefault();
        window.navigate(`/jobs/${el.dataset.jobLink}`);
      };
    });
  }

  return { inRange, rangeParams, pagedTable, wireCommonControls, wireRowLinks };

})();
