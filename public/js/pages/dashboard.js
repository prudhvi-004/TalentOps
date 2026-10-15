/* =============================================================
   DASHBOARD PAGE — dashboard.js (updated Part 4)
   =============================================================
   Added in Part 4:
     → Date range filter buttons (Today/Week/Month/Custom)
     → Custom date range inputs
     → Open Jobs tile
     → My Primary Jobs tile
     → All tiles clickable with navigation
   ============================================================= */

const DashboardPage = (() => {

  const DUMMY_METRICS = { talkTimeSec: 5400 };
  const TARGETS = { talkTimeSec: 7200 };

  // Targets scale with the selected date range — a recruiter's daily goal
  // is naturally smaller than their monthly goal. 'custom' has no target:
  // a custom range is an arbitrary window, so there's nothing sensible to
  // measure it against — those tiles just show the raw count.
  const RANGE_TARGETS = {
    submittals: { today: 1, week: 6, month: 24 },
    interviews: { today: 1, week: 1, month: 4 },
    starts:     { today: 1, week: 1, month: 1 },
    fps:        { today: 1, week: 2, month: 5 },
  };

  let activeDateRange = 'today';
  // Raw (unfiltered) records fetched once per page load; date-range button
  // clicks just re-filter this cached data client-side — no re-fetch needed.

  function render(container) {
    const m = DUMMY_METRICS;
    const talkAchieved = m.talkTimeSec >= TARGETS.talkTimeSec;

    container.innerHTML = `
      <div class="page-header fade-in">
        <div>
          <div class="page-title">Welcome Back </div>
          <div class="page-subtitle">
            TalentOps Demo ·
            ${new Date().toLocaleDateString('en-US',
              { weekday:'long', month:'long', day:'numeric' })}
          </div>
        </div>
      </div>

      <!-- ── DATE RANGE FILTERS ── -->
      <div style="display:flex;align-items:center;gap:8px;
                  margin-bottom:20px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--text-muted);font-weight:600">
          Date Range:
        </span>
        ${[['today','Today'],['week','This Week'],
           ['month','This Month'],['custom','Custom Date']]
          .map(([val, lbl]) => `
            <button class="filter-btn ${activeDateRange === val ? 'active' : ''}"
                    data-range="${val}">
              ${lbl}
            </button>`).join('')}
        <!-- Custom date inputs (hidden by default) -->
        <div id="customDateInputs" style="display:none;gap:6px;align-items:center">
          <input type="date" id="dateFrom"
                 style="padding:4px 8px;font-size:12px"/>
          <span style="font-size:12px;color:var(--text-muted)">to</span>
          <input type="date" id="dateTo"
                 style="padding:4px 8px;font-size:12px"/>
        </div>
      </div>

      <!-- ── PERFORMANCE TILES ── -->
      <h3 style="font-size:13px;margin-bottom:12px;color:var(--text-muted);
                 text-transform:uppercase;letter-spacing:.5px">
        Daily Performance
      </h3>
      <div id="perfTilesGrid"
           class="tile-grid"
           style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr));
                  margin-bottom:28px">
        ${perfTile('Submittals','submittals','/submittals')}
        ${perfTile('Interviews','interviews','/interviews')}
        ${perfTile('Starts','starts','/starts')}
        ${perfTile('FPS','fps',null)}
        ${talkTimeTile(m.talkTimeSec, talkAchieved)}
        ${openJobsTile()}
        ${myPrimaryJobsTile()}
      </div>

      <!-- ── RECENT JOBS ── -->
      <h3 style="font-size:13px;margin-bottom:12px;color:var(--text-muted);
                 text-transform:uppercase;letter-spacing:.5px">
        Recent Jobs
      </h3>
      <div id="recentJobsGrid" class="tile-grid">
        <div class="loading-screen" style="height:100px">
          <div class="loading-spinner"></div>
        </div>
      </div>`;

    // Date range filter buttons — re-filters the already-fetched tile data,
    // so switching ranges is instant (no re-fetch from the server).
    container.querySelectorAll('[data-range]').forEach(btn => {
      btn.onclick = () => {
        activeDateRange = btn.dataset.range;
        container.querySelectorAll('[data-range]').forEach(b => {
          b.classList.toggle('active', b.dataset.range === activeDateRange);
        });
        const customInputs = document.getElementById('customDateInputs');
        customInputs.style.display = activeDateRange === 'custom' ? 'flex' : 'none';
        showToast(`Showing: ${btn.textContent.trim()}`);
        applyDateRangeToTiles();
      };
    });
    document.getElementById('dateFrom').onchange = applyDateRangeToTiles;
    document.getElementById('dateTo').onchange = applyDateRangeToTiles;

    // Tile navigation clicks
    container.querySelectorAll('[data-nav]').forEach(el => {
      el.onclick = () => window.navigate(el.dataset.nav);
    });

    loadRecentJobs();
    loadTileData();
  }

  // Tiles only need counts, so each one asks the server for a single row
  // (limit=1) and reads the exact total from pageInfo — no full lists are
  // downloaded or filtered in the browser.
  async function loadTileData() {
    await loadScript('/js/components/record-detail-shared.js');
    applyDateRangeToTiles();
  }

  let tileRequestId = 0;

  // Re-queries the tile counts for the currently selected date range.
  // Called on initial load and every time the Date Range selection changes.
  async function applyDateRangeToTiles() {
    const requestId = ++tileRequestId;
    const range = RecordDetailShared.rangeParams(activeDateRange,
      document.getElementById('dateFrom')?.value, document.getElementById('dateTo')?.value);
    const count = (fetchPage, extra = {}) =>
      fetchPage({ ...range, ...extra, limit: 1 }).then(r => (r.success ? r.pageInfo : null));

    const [submittals, interviews, starts, fps, myPrimary] = await Promise.all([
      count(ApiService.getSubmittals, { type: 'external' }),
      count(ApiService.getInterviews),
      count(ApiService.getStarts),
      count(ApiService.getFirstPresentations),
      count(ApiService.getMyPrimaryJobRecords, { distinct: 1 }),
    ]);
    if (requestId !== tileRequestId) return; // a newer range selection superseded this one

    updatePerfTile('submittals', submittals ? submittals.total : 0);
    updatePerfTile('interviews', interviews ? interviews.total : 0);
    updatePerfTile('starts', starts ? starts.total : 0);
    updatePerfTile('fps', fps ? fps.total : 0);
    setTileCount('myPrimaryCount', myPrimary ? myPrimary.distinctTotal : 0);
  }

  function setTileCount(elId, value) {
    const el = document.getElementById(elId);
    if (el) el.textContent = value;
  }

  // navTo === null renders a disabled, greyed-out tile that does not
  // navigate anywhere when clicked (used for FPS and Talk Time — demo
  // metrics with no dedicated detail view). Starts at 0/—; updatePerfTile()
  // fills in the real value, target and bar once data loads.
  function perfTile(label, key, navTo) {
    const disabled = navTo == null;
    return `
      <div class="perf-tile" ${disabled ? '' : `data-nav="${navTo}"`}
           style="${disabled ? 'cursor:not-allowed;opacity:.55' : 'cursor:pointer'}">
        <div class="perf-label">${label}</div>
        <div class="perf-value" id="perfValue-${key}">0</div>
        <div class="perf-target" id="perfTarget-${key}"></div>
        <div class="progress-bar" id="perfBarWrap-${key}">
          <div class="progress-fill" id="perfBar-${key}" style="width:0%"></div>
        </div>
      </div>`;
  }

  // Updates one performance tile's number, target label and progress-bar
  // fill to match the currently selected date range. Called on initial load
  // and every time Today/Week/Month/Custom changes.
  function updatePerfTile(key, value) {
    const valueEl = document.getElementById(`perfValue-${key}`);
    const targetEl = document.getElementById(`perfTarget-${key}`);
    const barWrapEl = document.getElementById(`perfBarWrap-${key}`);
    const barEl = document.getElementById(`perfBar-${key}`);
    if (!valueEl) return;

    valueEl.textContent = value;

    const target = RANGE_TARGETS[key] ? RANGE_TARGETS[key][activeDateRange] : undefined;
    if (!target) {
      // Custom range (or no target defined): just show the raw count.
      targetEl.textContent = '';
      barWrapEl.style.display = 'none';
      return;
    }

    barWrapEl.style.display = '';
    const pct = Math.min(100, Math.round((value / target) * 100));
    targetEl.textContent = `Target: ${target}`;
    barEl.style.width = `${pct}%`;
    barEl.classList.toggle('done', pct >= 100);
  }

  function talkTimeTile(sec, achieved) {
    const h   = Math.floor(sec / 3600);
    const min = Math.floor((sec % 3600) / 60);
    const pct = Math.min(100, Math.round((sec / TARGETS.talkTimeSec) * 100));
    return `
      <div class="perf-tile" style="cursor:not-allowed;opacity:.55">
        <div class="perf-label">Talk Time (Daily)</div>
        ${achieved
          ? `<div class="perf-value">${h}h ${min}m</div>
             <div class="perf-target">Goal reached!</div>`
          : `<div class="perf-target" style="margin-top:6px">
               Working toward 2h daily target
             </div>`}
        <div class="progress-bar" style="margin-top:10px;height:8px">
          <div class="progress-fill ${achieved ? 'done' : ''}"
               style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  function openJobsTile() {
    return `
      <div class="perf-tile" data-nav="/jobs?status=open"
           style="border-left:4px solid var(--primary)">
        <div class="perf-label">Open Jobs</div>
        <div class="perf-value" id="openJobsCount">—</div>
        <div class="perf-target">Open, posted in last 30 days</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:100%"></div>
        </div>
      </div>`;
  }

  function myPrimaryJobsTile() {
    return `
      <div class="perf-tile" data-nav="/my-primary-jobs"
           style="border-left:4px solid var(--success)">
        <div class="perf-label">My Primary Jobs</div>
        <div class="perf-value" id="myPrimaryCount">—</div>
        <div class="perf-target">Assigned as Primary Recruiter</div>
        <div class="progress-bar">
          <div class="progress-fill done" style="width:100%"></div>
        </div>
      </div>`;
  }

  async function loadRecentJobs() {
    const grid = document.getElementById('recentJobsGrid');
    if (!grid) return;

    // Two small paged queries instead of downloading every job: the 6 newest
    // for the tiles, and an exact total for the Open Jobs tile (open, posted
    // in the last 30 days — same window as the Jobs page).
    const [result, open] = await Promise.all([
      ApiService.getJobs({ limit: 6 }),
      ApiService.getJobs({ limit: 1, status: 'open', days: 30 }),
    ]);
    if (!result.success) {
      grid.innerHTML = `<div class="empty"><p>Could not load jobs</p></div>`;
      return;
    }

    const jobs = result.data;
    const openEl = document.getElementById('openJobsCount');
    if (openEl) openEl.textContent = open.success ? open.pageInfo.total : '—';

    // Render recent job tiles
    grid.innerHTML = jobs.map(job => `
      <div class="tile fade-in" data-job="${job.id}" style="cursor:pointer">
        <div class="tile-header">
          <div class="tile-title">${job.title}</div>
          <span class="chip chip-${job.status}">${job.status}</span>
        </div>
        <div class="tile-client">${job.client} · ${job.location}</div>
        <div style="margin-top:6px">
          <span style="font-size:12px;color:var(--text-muted)">
            ${job.salary}
          </span>
        </div>
        <div style="margin-top:8px">
          ${(job.requirements || []).slice(0, 3)
            .map(r => `<span class="tile-tag">${r}</span>`).join('')}
        </div>
      </div>`).join('');

    grid.querySelectorAll('[data-job]').forEach(el => {
      el.onclick = () => window.navigate(`/jobs/${el.dataset.job}`);
    });
  }

  return { render };

})();