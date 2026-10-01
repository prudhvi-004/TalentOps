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
    if (range === 'week')  return d >= new Date(startOfDay.getTime() - 7 * 24 * 60 * 60 * 1000) && d < endOfToday;
    if (range === 'month') return d >= new Date(startOfDay.getTime() - 30 * 24 * 60 * 60 * 1000) && d < endOfToday;
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
    if (search) search.oninput = onChange;
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

  return { inRange, wireCommonControls, wireRowLinks };

})();
