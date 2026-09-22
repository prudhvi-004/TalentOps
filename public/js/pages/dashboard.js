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

  const DUMMY_METRICS = {
    submittals:  14, interviews: 6,
    starts: 2, fps: 3, talkTimeSec: 5400,
  };
  const TARGETS = {
    submittals: 20, interviews: 10,
    starts: 3, fps: 5, talkTimeSec: 7200,
  };

  let activeDateRange = 'today';

  function render(container) {
    const m = DUMMY_METRICS;
    const talkAchieved = m.talkTimeSec >= TARGETS.talkTimeSec;

    container.innerHTML = `
      <div class="page-header fade-in">
        <div>
          <div class="page-title">Welcome Back 👋</div>
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
        ${perfTile('Submittals','submittals',m.submittals,TARGETS.submittals,'/jobs')}
        ${perfTile('Interviews','interviews',m.interviews,TARGETS.interviews,'/candidates')}
        ${perfTile('Starts','starts',m.starts,TARGETS.starts,'/candidates')}
        ${perfTile('First Presentation','fps',m.fps,TARGETS.fps,'/candidates')}
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

    // Date range filter buttons
    container.querySelectorAll('[data-range]').forEach(btn => {
      btn.onclick = () => {
        activeDateRange = btn.dataset.range;
        container.querySelectorAll('[data-range]').forEach(b => {
          b.classList.toggle('active', b.dataset.range === activeDateRange);
        });
        const customInputs = document.getElementById('customDateInputs');
        customInputs.style.display = activeDateRange === 'custom' ? 'flex' : 'none';
        // In production: re-fetch metrics with new date range
        // For demo: just shows the filter is interactive
        showToast(`Showing: ${btn.textContent.trim()}`);
      };
    });

    // Tile navigation clicks
    container.querySelectorAll('[data-nav]').forEach(el => {
      el.onclick = () => window.navigate(el.dataset.nav);
    });

    loadRecentJobs();
  }

  function perfTile(label, key, val, target, navTo) {
    const pct = Math.min(100, Math.round((val / target) * 100));
    return `
      <div class="perf-tile" data-nav="${navTo}" style="cursor:pointer">
        <div class="perf-label">${label}</div>
        <div class="perf-value">${val}</div>
        <div class="perf-target">Target: ${target}</div>
        <div class="progress-bar">
          <div class="progress-fill ${pct >= 100 ? 'done' : ''}"
               style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  function talkTimeTile(sec, achieved) {
    const h   = Math.floor(sec / 3600);
    const min = Math.floor((sec % 3600) / 60);
    const pct = Math.min(100, Math.round((sec / TARGETS.talkTimeSec) * 100));
    return `
      <div class="perf-tile" data-nav="/">
        <div class="perf-label">Talk Time (Daily)</div>
        ${achieved
          ? `<div class="perf-value">${h}h ${min}m</div>
             <div class="perf-target">🎯 Goal reached!</div>`
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
      <div class="perf-tile" data-nav="/jobs"
           style="border-left:4px solid var(--primary)">
        <div class="perf-label">Open Jobs</div>
        <div class="perf-value" id="openJobsCount">—</div>
        <div class="perf-target">Total across portfolio</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:100%"></div>
        </div>
      </div>`;
  }

  function myPrimaryJobsTile() {
    return `
      <div class="perf-tile" data-nav="/jobs"
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

    const result = await ApiService.getJobs();
    if (!result.success) {
      grid.innerHTML = `<div class="empty"><p>Could not load jobs</p></div>`;
      return;
    }

    const jobs = result.data;

    // Update Open Jobs tile count
    const openJobs = jobs.filter(j => j.status === 'open');
    const openEl = document.getElementById('openJobsCount');
    if (openEl) openEl.textContent = openJobs.length;

    // Update My Primary Jobs tile count (demo: all jobs as primary)
    const primaryEl = document.getElementById('myPrimaryCount');
    if (primaryEl) primaryEl.textContent = jobs.length;

    // Render recent job tiles
    grid.innerHTML = jobs.slice(0, 4).map(job => `
      <div class="tile fade-in" data-job="${job.id}" style="cursor:pointer">
        <div class="tile-header">
          <div class="tile-title">${job.title}</div>
          <span class="chip chip-${job.status}">${job.status}</span>
        </div>
        <div class="tile-client">🏢 ${job.client} · 📍 ${job.location}</div>
        <div style="margin-top:6px">
          <span class="chip chip-${job.priority}">${job.priority}</span>
          <span style="font-size:12px;color:var(--text-muted);margin-left:6px">
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