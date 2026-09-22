/* =============================================================
   JOB DETAIL PAGE — job-detail.js
   =============================================================
   Purpose:
     Renders the job detail page in two modes:

     MODE 1 — Default (full width, top-down):
       Scrollable page showing:
         → Job Info card
         → Job Description card
         → Candidates in Pipeline section (clickable chips)
         → AI Engaged section (tabbed)
       Activated: on page load

     MODE 2 — Split View:
       Left panel:  Job description (minimizable/expandable)
       Right panel: Selected candidate full profile
                    with Notes + AI Match buttons
       Activated: when user clicks a candidate name chip
                  OR clicks "Compare Candidates" button

   Key behaviours:
     → Candidate click → split view, that candidate selected
     → Compare button → split view, first candidate selected
     → Minimize JD → collapses left panel to thin strip
     → Expand (▶) → restores left panel to full width
     → Notes button → opens modal popup (not side panel)
     → All Candidates → opens modal with full list table
     → Exit Compare → returns to full width default view

   API connections:
     ApiService.getJobById(id)
     ApiService.getCandidatesForJob(id)
     ApiService.getAIEngagedForJob(id)
   ============================================================= */

const JobDetailPage = (() => {

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? escapeHtml(value) : d.toLocaleString();
  }

  function formatNoteDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return escapeHtml(value);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours() % 12 || 12).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const sec = String(d.getSeconds()).padStart(2, '0');
    const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
    return `${mm}/${dd}/${yy} ${hh}:${min}:${sec} ${ampm}`;
  }

  /* ------------------------------------------------------------------
     renderNotesIntoDom(container, notes)
     Populates a DOM container with the full notes list.
     Format (matches JobDiva reference display):
       [BOLD action type]     [date · username]   <- header row
       [note body text]                            <- body below
     Handles both UPPERCASE (live JobDiva) and lowercase (normalised).
  ------------------------------------------------------------------ */
  function renderNotesIntoDom(container, notes) {
    if (!container) return;
    container.replaceChildren();

    const rows = Array.isArray(notes) ? notes : [];

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'candidate-notes-empty';
      empty.textContent = 'No notes returned by JobDiva.';
      container.appendChild(empty);
      return;
    }

    rows.forEach(n => {
      const actionType = n.ACTIONTYPE || n.actionType || 'Note';
      const actionDate = n.ACTIONDATE || n.actionDate
                      || n.CREATEDATE || n.createdAt
                      || n.DATEUPDATED || n.dateUpdated || '';
      const username   = n.USERNAME   || n.username   || '';
      const noteBody   = String(n.NOTE || n.note || '')
                           .replace(/<br\s*\/?>/gi, '\n').trim();

      const article = document.createElement('article');
      article.className = 'candidate-note';

      // Header: bold action type on the left, date · user on the right
      const header = document.createElement('div');
      header.className = 'candidate-note-header';

      const action = document.createElement('strong');
      action.className = 'candidate-note-action';
      action.textContent = actionType;

      const meta = document.createElement('span');
      meta.className = 'candidate-note-meta';
      meta.textContent = formatNoteDate(actionDate)
                       + (username ? ' \u00b7 ' + username : '');

      header.appendChild(action);
      header.appendChild(meta);
      article.appendChild(header);

      // Body: full note text
      if (noteBody) {
        const body = document.createElement('div');
        body.className = 'candidate-note-body';
        body.textContent = noteBody;
        article.appendChild(body);
      }

      container.appendChild(article);
    });
  }


  /* -----------------------------------------------------------
     PAGE STATE
     Tracks current mode and selected candidate.
     Reset on every page load.
  ----------------------------------------------------------- */
  let pageState = {
    job:               null,
    allCandidates:     [],
    aiEngaged:         { applicants: [], candidates: [] },
    mode:              'default',    // 'default' | 'split'
    selectedCandId:    null,
    selectedCandSource:'pipeline',   // 'pipeline' | 'ai'
    selectedAICategory:'Applicant',
    jdMinimized:       false,
  };

  /* -----------------------------------------------------------
     render(container, jobId)
     Main entry — called by app.js router.
  ----------------------------------------------------------- */
  async function render(container, jobId, openOpts = {}) {
    // Reset state on each page load
    pageState = {
      job: null, allCandidates: [], aiEngaged: { applicants:[], candidates:[] },
      mode: 'default', selectedCandId: null,
      selectedCandSource: 'pipeline', selectedAICategory: 'Applicant',
      jdMinimized: false,
    };

    // Show loading
    container.innerHTML = `
      <div class="loading-screen">
        <div class="loading-spinner"></div>
        <p>Loading job...</p>
      </div>`;

    // Fetch job details
    const jobResult = await ApiService.getJobById(jobId);
    if (!jobResult.success) {
      container.innerHTML = `
        <div class="breadcrumb"><span onclick="navigate('/jobs')">← Back to Jobs</span></div>
        <div class="empty"><h3>Job not found</h3><p>${jobResult.error}</p></div>`;
      return;
    }
    pageState.job = jobResult.data;

    // Fetch candidates (pipeline + AI) in parallel
    const [candResult, aiResult] = await Promise.all([
      ApiService.getCandidatesForJob(jobId),
      ApiService.getAIEngagedForJob(jobId),
    ]);

    if (candResult.success) pageState.allCandidates = candResult.data;
    if (aiResult.success)   pageState.aiEngaged     = aiResult.data;
    // If coming from Candidates page, open split view immediately
    if (openOpts.openCandId) {
      pageState.selectedCandId = openOpts.openCandId;
      pageState.selectedCandSource = openOpts.openCandSource || 'pipeline';
      pageState.selectedAICategory = openOpts.openCandAICat || 'Applicant';
      await hydrateSelectedCandidate(openOpts.openCandId);
      renderSplitView(container);
    } else {
      renderDefault(container);
    }
  }

  /* ============================================================
     MODE 1 — DEFAULT VIEW (full width, top-down)
  ============================================================ */
  function renderDefault(container) {
    pageState.mode       = 'default';
    pageState.jdMinimized = false;
    const j = pageState.job;

    container.innerHTML = `
      <div class="fade-in">

        <!-- Breadcrumb + page header -->
        <div class="breadcrumb" style="margin-bottom:8px">
          <span id="backToJobs">← Back to Jobs</span>
        </div>

        <div class="page-header">
          <div>
            <div class="page-title">
              ${j.title}
              <span style="font-size:13px;color:var(--text-muted);font-weight:400;margin-left:6px">
                (${j.atsId || ''})
              </span>
            </div>
            <div class="page-subtitle">
              🏢 ${j.client} · 📍 ${j.location} ·
              <span class="chip chip-${j.status}">${j.status}</span>
            </div>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" id="viewPostingBtn">📄 View Original Posting</button>
            <button class="btn btn-secondary" id="jobActivityBtn">🕐 Job Activity</button>
            <button class="btn btn-secondary" id="compareCandBtn">🔀 Compare Candidates</button>
          </div>
        </div>

        <!-- ── JOB INFO CARD ── -->
        <div class="detail-card">
          <h3>ℹ️ Job Info</h3>
          <div class="detail-row">
            <span class="detail-label">Hiring Manager</span>
            <span>${j.hiringManager || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Client</span>
            <span>${j.client || '—'}${j.industry ? ` · ${j.industry}` : ''}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Primary Recruiter</span>
            <span>${j.primaryRecruiter || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Job Type</span>
            <span>${j.jobType || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Openings</span>
            <span>${j.openings || '—'}${j.fills !== '' && j.fills !== undefined ? ` · ${j.fills} filled` : ''}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Location</span>
            <span>${j.location}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Salary</span>
            <span>${j.salary || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Priority</span>
            <span><span class="chip chip-${j.priority}">${j.priority}</span></span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span><span class="chip chip-${j.status}">${j.status}</span></span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Start Date</span>
            <span>${j.startDate || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">End Date</span>
            <span>${j.endDate || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Posted</span>
            <span>${j.createdAt || '—'}</span>
          </div>
          <div class="detail-row"><span class="detail-label">Submittal Due</span><span>${formatDate(j.submittalDue)}</span></div>
          <div class="detail-row"><span class="detail-label">Work Mode</span><span>${j.onsiteRemote || '—'}${j.remotePercentage ? ` · ${j.remotePercentage}% remote` : ''}</span></div>
          <div class="detail-row"><span class="detail-label">Max Submittals</span><span>${j.maxAllowedSubmittals || '—'}</span></div>
          <div class="detail-row"><span class="detail-label">Bill Rate</span><span>${j.billRateMin || '—'}${j.billRateMax ? ` – ${j.billRateMax}` : ''} ${j.billRatePer || ''}</span></div>
          <div class="detail-row"><span class="detail-label">Pay Rate</span><span>${j.payRateMin || '—'}${j.payRateMax ? ` – ${j.payRateMax}` : ''} ${j.payRatePer || ''}</span></div>
        </div>

        <!-- ── JOB DESCRIPTION CARD ── -->
        <div class="detail-card">
          <h3>📋 Job Description</h3>
          <p style="font-size:13px;line-height:1.7;margin-bottom:14px">
            ${j.description || 'No description available.'}
          </p>
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                        text-transform:uppercase;letter-spacing:.3px;margin-bottom:8px">
              Requirements
            </div>
            ${j.requirements && j.requirements.length > 0
              ? `<ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.65">${j.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
              : '<span style="font-size:12px;color:var(--text-muted)">No explicit requirements returned by JobDiva.</span>'}
          </div>
          ${j.remarks ? `
          <div style="margin-top:16px">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                        text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">
              Remarks
            </div>
            <p style="font-size:13px;line-height:1.6;margin:0">${j.remarks}</p>
          </div>` : ''}
          ${j.submittalInstruction ? `
          <div style="margin-top:16px">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                        text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">
              Submittal Instructions
            </div>
            <p style="font-size:13px;line-height:1.6;margin:0">${j.submittalInstruction}</p>
          </div>` : ''}
        </div>

        <!-- ── CANDIDATES IN PIPELINE ── -->
        <div class="detail-card">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
            <h3 style="margin:0">
              👥 Assigned Candidates
              <span style="font-weight:400;font-size:12px;color:var(--text-muted)">
                (${pageState.allCandidates.length})
              </span>
            </h3>
            ${pageState.allCandidates.length > 0 ? `
              <input id="jobCandidateSearch" placeholder="Search candidates..."
                     style="min-width:220px;padding:6px 10px;font-size:12px"/>` : ''}
          </div>

          ${pageState.allCandidates.length === 0
            ? `<div class="empty" style="padding:20px 0">
                 <p>No candidates have applied to this job yet.</p>
               </div>`
            : `<!-- Clickable candidate name chips -->
               <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:0">
                 ${pageState.allCandidates.map(c => `
                   <button class="btn btn-secondary cand-chip"
                           data-cand="${c.id}"
                           data-source="pipeline"
                           style="font-size:12px;padding:8px 14px;text-align:left">
                     <strong>${escapeHtml(c.name)}</strong>
                     <span style="display:block;font-size:10px;color:var(--text-muted);margin-top:2px">
                       ${escapeHtml(c.applicationStatus || c.submittal?.startStatus || 'Submitted')} · ${formatDate(c.applicationDate || c.submittal?.submittalDate)}
                     </span>
                   </button>`).join('')}
               </div>`}
        </div>

        <!-- ── AI ENGAGED ── -->
        <div class="detail-card">
          <h3>🤖 AI Engaged</h3>

          <!-- Sub-tabs: Applicants | Candidates -->
          <div style="display:flex;gap:8px;margin-bottom:14px">
            <button class="filter-btn active" data-ai-tab="applicant">
              Engaged Applicants
              (${(pageState.aiEngaged.applicants || []).length})
            </button>
            <button class="filter-btn" data-ai-tab="candidate">
              Engaged Candidates
              (${(pageState.aiEngaged.candidates || []).length})
            </button>
          </div>

          <input id="aiCandidateSearch" placeholder="Search AI candidates..."
                 style="width:100%;max-width:320px;margin-bottom:12px;padding:7px 10px;font-size:12px"/>

          <!-- AI candidate list renders here -->
          <div id="aiListDefault"></div>
        </div>

      </div>`;

    // ── Wire up buttons ──
    document.getElementById('backToJobs')
      .onclick = () => navigate('/jobs');

    document.getElementById('viewPostingBtn')
      .onclick = () => openPostingModal(pageState.job);

    document.getElementById('jobActivityBtn')
      .onclick = () => openActivityModal(pageState.job);

    document.getElementById('compareCandBtn').onclick = async () => {
      const first = pageState.allCandidates[0];
      if (!first) { showToast('No candidates to compare'); return; }
      pageState.selectedCandId = first.id;
      pageState.selectedCandSource = 'pipeline';
      await hydrateSelectedCandidate(first.id);
      renderSplitView(document.getElementById('content') || document.querySelector('.content'));
    };

    // ── Candidate chip click → split view ──
    document.querySelectorAll('.cand-chip').forEach(btn => {
      btn.onclick = async () => {
        pageState.selectedCandId = btn.dataset.cand;
        pageState.selectedCandSource = btn.dataset.source || 'pipeline';
        await hydrateSelectedCandidate(btn.dataset.cand);
        renderSplitView(document.querySelector('.content'));
      };
    });

    // ── Assigned candidate search ──
    const candidateSearch = document.getElementById('jobCandidateSearch');
    if (candidateSearch) {
      candidateSearch.oninput = () => {
        const q = candidateSearch.value.trim().toLowerCase();
        document.querySelectorAll('.cand-chip').forEach(btn => {
          btn.style.display = !q || btn.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      };
    }

    const aiCandidateSearch = document.getElementById('aiCandidateSearch');
    if (aiCandidateSearch) aiCandidateSearch.oninput = applyAISearch;

    // ── AI tab switching ──
    document.querySelectorAll('[data-ai-tab]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-ai-tab]')
          .forEach(b => b.classList.toggle('active', b === btn));
        renderAIListDefault(
          document.getElementById('aiListDefault'),
          btn.dataset.aiTab
        );
        applyAISearch();
      };
    });

    // Render initial AI list (applicants tab)
    renderAIListDefault(
      document.getElementById('aiListDefault'),
      'applicant'
    );
  }

  function applyAISearch() {
    const input = document.getElementById('aiCandidateSearch');
    if (!input) return;
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('.ai-cand-chip').forEach(btn => {
      btn.style.display = !q || btn.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  /* -----------------------------------------------------------
     renderAIListDefault(container, tab)
     Renders AI engaged candidates in the default view.
     Clicking one → split view with AI candidate profile.
  ----------------------------------------------------------- */
  function renderAIListDefault(container, tab) {
    const list = tab === 'applicant'
      ? (pageState.aiEngaged.applicants || [])
      : (pageState.aiEngaged.candidates || []);

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty" style="padding:16px 0">
          <p>No AI Engaged ${tab === 'applicant' ? 'Applicants' : 'Candidates'} for this job.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${list.map(c => `
          <button class="btn btn-secondary ai-cand-chip"
                  data-cand="${c.id}"
                  data-ai-category="${c.aiCategory || 'Applicant'}"
                  style="font-size:12px;padding:6px 14px;
                         border-color:var(--primary);color:var(--primary)">
            🤖 ${c.name}
            <span class="ai-stage-badge" style="font-size:10px;padding:2px 6px;margin-left:4px">
              ${c.aiStageLabel || c.aiStage || ''}
            </span>
          </button>`).join('')}
      </div>`;

    // AI candidate chip click → split view
    container.querySelectorAll('.ai-cand-chip').forEach(btn => {
      btn.onclick = () => {
        pageState.selectedCandId      = btn.dataset.cand;
        pageState.selectedCandSource  = 'ai';
        pageState.selectedAICategory  = btn.dataset.aiCategory || 'Applicant';
        renderSplitView(document.querySelector('.content'));
      };
    });
  }

  /* ============================================================
     MODE 2 — SPLIT VIEW
     Left:  Job description (minimizable/expandable)
     Right: Selected candidate profile
  ============================================================ */
  function renderSplitView(container) {
    pageState.mode = 'split';
    const j = pageState.job;

    // Find selected candidate from correct pool
    const selectedCand = findSelectedCandidate();

    container.innerHTML = `
      <div class="fade-in">

        <!-- Header stays same as default view -->
        <div class="breadcrumb" style="margin-bottom:8px">
          <span id="backToJobs">← Back to Jobs</span>
        </div>

        <div class="page-header">
          <div>
            <div class="page-title">
              ${j.title}
              <span style="font-size:13px;color:var(--text-muted);font-weight:400;margin-left:6px">
                (${j.atsId || ''})
              </span>
            </div>
            <div class="page-subtitle">
              🏢 ${j.client} · 📍 ${j.location} ·
              <span class="chip chip-${j.status}">${j.status}</span>
            </div>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" id="viewPostingBtn">📄 View Original Posting</button>
            <button class="btn btn-secondary" id="jobActivityBtn">🕐 Job Activity</button>
            <button class="btn btn-secondary" id="exitCompareBtn">🔲 Exit Compare</button>
          </div>
        </div>

        <!-- SPLIT VIEW GRID -->
        <div class="split-view" id="splitViewGrid"
             style="height:calc(100vh - 200px)">

          <!-- LEFT PANEL: Job Description -->
          <div class="split-panel" id="jdPanel">
            <div class="split-header">
              <span id="jdPanelTitle">📋 Job Description</span>
              <button class="btn btn-sm btn-secondary" id="jdToggleBtn">
                ◀ Minimize
              </button>
            </div>
            <!-- JD content scrollable -->
            <div class="split-body" id="jdPanelBody">
              ${renderJDContent(j)}
            </div>
          </div>

          <!-- RIGHT PANEL: Candidate Profile -->
          <div class="split-panel">
            <div class="split-header">
              <span id="rightPanelTitle">👥 Candidates</span>
              <div style="display:flex;gap:6px;align-items:center">
                <input id="splitCandidateSearch" placeholder="Search candidates..."
                       style="width:190px;padding:5px 9px;font-size:11px"/>
                <!-- All Candidates button -->
                <button class="btn btn-sm btn-secondary" id="allCandsBtn">
                  📋 All Candidates
                </button>
              </div>
            </div>
            <div class="split-body" style="padding:0">

              <!-- Candidate selector chips at top -->
              <div style="padding:12px 16px;border-bottom:1px solid var(--border);
                          display:flex;flex-wrap:wrap;gap:6px" id="candChipBar">
                ${renderCandChips()}
              </div>

              <!-- Selected candidate profile -->
              <div style="padding:18px;overflow-y:auto;
                          height:calc(100% - 58px)" id="candidateProfileArea">
                ${selectedCand
                  ? renderCandidateCard(selectedCand)
                  : '<div class="empty"><p>Select a candidate above</p></div>'}
              </div>

            </div>
          </div>

        </div><!-- end split-view -->

      </div>`;

    // ── Wire up header buttons ──
    document.getElementById('backToJobs')
      .onclick = () => navigate('/jobs');
    document.getElementById('viewPostingBtn')
      .onclick = () => openPostingModal(j);
    document.getElementById('jobActivityBtn')
      .onclick = () => openActivityModal(j);
    document.getElementById('exitCompareBtn').onclick = () => {
      pageState.mode = 'default';
      pageState.selectedCandId = null;
      pageState.jdMinimized = false;
      renderDefault(container);
    };

    // ── JD Minimize / Expand ──
    document.getElementById('jdToggleBtn').onclick = () => {
      pageState.jdMinimized = !pageState.jdMinimized;
      applyJDMinimize();
    };

    // ── All Candidates button ──
    document.getElementById('allCandsBtn').onclick = () => {
      openAllCandidatesModal();
    };

    // ── Candidate chip clicks ──
    document.querySelectorAll('[data-select-cand]').forEach(btn => {
      btn.onclick = () => selectCandidate(
        btn.dataset.selectCand,
        btn.dataset.source || 'pipeline',
        btn.dataset.aiCategory || 'Applicant'
      );
    });

    // ── Candidate search in split view ──
    const splitCandidateSearch = document.getElementById('splitCandidateSearch');
    if (splitCandidateSearch) {
      splitCandidateSearch.oninput = () => {
        const q = splitCandidateSearch.value.trim().toLowerCase();
        document.querySelectorAll('#candChipBar [data-select-cand]').forEach(btn => {
          btn.style.display = !q || btn.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      };
    }

    // ── Notes button (inside candidate card) ──
    wireNoteBtn();

    // ── AI Match button ──
    wireAIMatchBtn();

    // ── View History button (AI candidates) ──
    wireViewHistoryBtn();

    // Apply minimized state if returning to split view
    if (pageState.jdMinimized) applyJDMinimize();
    // Populate notes list via DOM renderer (avoids innerHTML injection)
    if (selectedCand) populateSplitNotes(selectedCand);
  }

  /* -----------------------------------------------------------
     applyJDMinimize()
     Collapses or expands the left JD panel.
     When minimized: panel becomes a thin strip with expand arrow.
     When expanded:  panel returns to full width with content.
  ----------------------------------------------------------- */
  function applyJDMinimize() {
    const grid    = document.getElementById('splitViewGrid');
    const body    = document.getElementById('jdPanelBody');
    const title   = document.getElementById('jdPanelTitle');
    const toggleBtn = document.getElementById('jdToggleBtn');

    if (pageState.jdMinimized) {
      // Collapse left panel
      grid.style.gridTemplateColumns = '44px 1fr';
      body.style.display    = 'none';
      title.style.display   = 'none';
      toggleBtn.textContent = '▶';
      toggleBtn.title       = 'Expand Job Description';
    } else {
      // Restore left panel
      grid.style.gridTemplateColumns = '1fr 1fr';
      body.style.display    = '';
      title.style.display   = '';
      toggleBtn.textContent = '◀ Minimize';
      toggleBtn.title       = 'Minimize Job Description';
    }
  }

  /* -----------------------------------------------------------
     renderJDContent(job)
     Renders the job description content for the left panel.
  ----------------------------------------------------------- */
  function renderJDContent(j) {
    return `
      <div class="detail-card" style="margin-bottom:12px">
        <h3>ℹ️ Job Info</h3>
        <div class="detail-row">
          <span class="detail-label">Client</span>
          <span>${j.client}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Location</span>
          <span>${j.location}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Salary</span>
          <span>${j.salary || '—'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Priority</span>
          <span><span class="chip chip-${j.priority}">${j.priority}</span></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Hiring Mgr</span>
          <span style="font-size:12px">${j.hiringManager || '—'}</span>
        </div>
      </div>

      <div class="detail-card">
        <h3>📋 Description</h3>
        <p style="font-size:13px;line-height:1.7;margin-bottom:12px">
          ${j.description || 'No description.'}
        </p>
        ${j.requirements && j.requirements.length > 0 ? `
        <div style="margin-top:10px">
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                      text-transform:uppercase;margin-bottom:6px">
            Requirements
          </div>
          <ul style="margin:0;padding-left:20px;font-size:12px;line-height:1.6">${j.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        </div>` : ''}
      </div>`;
  }

  /* -----------------------------------------------------------
     renderCandChips()
     Renders the candidate selector chips at the top of
     the right panel. Shows both pipeline and AI candidates.
     Active candidate is highlighted in primary color.
  ----------------------------------------------------------- */
  function renderCandChips() {
    const allForChips = [
      ...pageState.allCandidates.map(c => ({ ...c, _source: 'pipeline' })),
      ...(pageState.aiEngaged.applicants || []).map(c =>
        ({ ...c, _source: 'ai', _aiCategory: 'Applicant' })),
      ...(pageState.aiEngaged.candidates || []).map(c =>
        ({ ...c, _source: 'ai', _aiCategory: 'Candidate' })),
    ];

    if (allForChips.length === 0) {
      return '<span style="font-size:12px;color:var(--text-muted)">No candidates</span>';
    }

    return allForChips.map(c => {
      const isActive = c.id === pageState.selectedCandId;
      const isAI     = c._source === 'ai';
      return `
        <button
          class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}"
          data-select-cand="${c.id}"
          data-source="${c._source}"
          data-ai-category="${c._aiCategory || 'Applicant'}"
          style="font-size:12px">
          ${isAI ? '🤖 ' : ''}${c.name}
        </button>`;
    }).join('');
  }

  /* -----------------------------------------------------------
     renderCandidateCard(candidate)
     Renders the full candidate profile in the right panel.
     Includes Notes + AI Match + View History (AI only) buttons.
  ----------------------------------------------------------- */
  function renderCandidateCard(c) {
    const isAI = c.type === 'ai' ||
                 pageState.selectedCandSource === 'ai';

    // Determine heading
    const heading = isAI
      ? (pageState.selectedAICategory === 'Candidate'
          ? '🤖 AI Engaged Candidate'
          : '🤖 AI Engaged Applicant')
      : '👤 Candidate Profile';

    return `
      <div class="fade-in">

        <!-- Name + actions row -->
        <div style="display:flex;justify-content:space-between;
                    align-items:flex-start;margin-bottom:14px">
          <div>
            <div style="font-size:11px;color:var(--primary);font-weight:600;
                        text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">
              ${heading}
            </div>
            <div style="font-size:18px;font-weight:700">${c.name}</div>
            <div class="cand-meta" style="margin-top:4px">
              📧 ${c.email || '—'} ·
              📱 ${c.phone || '—'} ·
              📍 ${c.location || [c.city, c.state].filter(Boolean).join(', ') || '—'}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:5px">
              ${c.title ? `💼 ${c.title}` : ''}${c.company ? ` · 🏢 ${c.company}` : ''}
            </div>
            ${c.applicationStatus || c.applicationDate ? `
            <div style="font-size:12px;color:var(--text-muted);margin-top:5px">
              ${c.applicationStatus ? `Application: ${c.applicationStatus}` : ''}
              ${c.applicationDate ? ` · Applied: ${c.applicationDate}` : ''}
            </div>` : ''}
            ${c.submittal ? `
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px">
              ${c.submittal.hiringManager ? `Hiring Manager: ${escapeHtml(c.submittal.hiringManager)} · ` : ''}
              ${c.submittal.interviewDate ? `Interview: ${formatDate(c.submittal.interviewDate)}` : ''}
            </div>` : ''}
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              ${c.experience
                ? `<span class="chip chip-medium">${c.experience}Y EXP</span>`
                : ''}
              ${isAI && c.aiStageLabel
                ? `<span class="ai-stage-badge">🤖 ${c.aiStageLabel}</span>`
                : ''}
            </div>
          </div>

          <!-- Action buttons -->
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            <!-- Notes button → opens modal popup -->
            <button class="btn btn-sm btn-secondary" id="notesBtnSplit"
                    data-cand-id="${c.id}"
                    data-cand-name="${c.name}"
                    data-job-id="${pageState.job.id}">
              📝 Notes
            </button>
            <!-- AI Match button -->
            <button class="btn btn-sm btn-secondary" id="aiMatchBtnSplit"
                    data-cand-id="${c.id}"
                    data-cand-name="${c.name}">
              🤖 AI Match
            </button>
            <!-- View History — AI candidates only -->
            ${isAI ? `
            <button class="btn btn-sm btn-secondary" id="viewHistoryBtnSplit"
                    data-cand-id="${c.id}">
              🕐 View History
            </button>` : ''}
          </div>
        </div>

        <!-- Profile -->
        ${c.profile ? `
        <div class="detail-card" style="margin-bottom:12px">
          <h3>👤 Profile</h3>
          <p style="font-size:13px;line-height:1.6">${c.profile}</p>
        </div>` : ''}

        <!-- Skills -->
        ${c.skills && c.skills.length > 0 ? `
        <div class="detail-card" style="margin-bottom:12px">
          <h3>🛠 Skills</h3>
          ${c.skills.map(s => `<span class="tile-tag">${s}</span>`).join('')}
        </div>` : ''}

        <!-- Education -->
        ${c.education ? `
        <div class="detail-card" style="margin-bottom:12px">
          <h3>🎓 Education</h3>
          <p style="font-size:13px">${c.education}</p>
          ${c.certifications && c.certifications.length > 0
            ? `<div style="margin-top:8px">
                 ${c.certifications.map(cert =>
                   `<span class="tile-tag">${cert}</span>`).join('')}
               </div>`
            : ''}
        </div>` : ''}

        <!-- Resume -->
        ${c.resume ? `
        <div class="detail-card">
          <h3>📄 Resume</h3>
          <pre style="white-space:pre-wrap;font-family:'Courier New',monospace;font-size:12px;background:var(--surface-2);padding:14px;border-radius:8px;line-height:1.6;max-height:520px;overflow:auto">${escapeHtml(c.resume)}</pre>
        </div>` : ''}

        <div class="detail-card" id="splitNotesCard">
          <h3>&#x1F5D2; Recent JobDiva Notes <span id="splitNotesCount" style="font-weight:400;font-size:12px;color:var(--text-muted)"></span></h3>
          <div id="splitNotesList" class="candidate-notes-container" aria-live="polite"></div>
        </div>

      </div>`;
  }

  /* -----------------------------------------------------------
     selectCandidate(candId, source, aiCategory)
     Updates selected candidate and re-renders right panel.
  ----------------------------------------------------------- */
  async function selectCandidate(candId, source, aiCategory) {
    pageState.selectedCandId      = candId;
    pageState.selectedCandSource  = source;
    pageState.selectedAICategory  = aiCategory || 'Applicant';

    // Load the complete JobDiva candidate record (resume, notes, attachments)
    // before rendering the split profile.
    await hydrateSelectedCandidate(candId);

    // Update chip active states
    document.querySelectorAll('[data-select-cand]').forEach(btn => {
      btn.classList.toggle('btn-primary',  btn.dataset.selectCand === candId);
      btn.classList.toggle('btn-secondary', btn.dataset.selectCand !== candId);
    });

    // Re-render candidate profile area
    const profileArea = document.getElementById('candidateProfileArea');
    if (!profileArea) return;
    const cand = findSelectedCandidate();
    profileArea.innerHTML = cand
      ? renderCandidateCard(cand)
      : '<div class="empty"><p>Candidate not found</p></div>';

    // Re-wire buttons after re-render
    wireNoteBtn();
    wireAIMatchBtn();
    wireViewHistoryBtn();
    populateSplitNotes(cand);
  }

  /* -----------------------------------------------------------
     findSelectedCandidate()
     Finds the currently selected candidate object from
     the correct data pool (pipeline or AI engaged).
  ----------------------------------------------------------- */
  async function hydrateSelectedCandidate(candidateId) {
    if (!candidateId) return null;
    const result = await ApiService.getCandidateById(candidateId);
    if (!result.success) {
      showToast(`Could not load candidate: ${result.error}`, 'error');
      return null;
    }
    const hydrated = result.data;
    const index = pageState.allCandidates.findIndex(c => String(c.id) === String(candidateId));
    if (index >= 0) {
      const original = pageState.allCandidates[index];
      pageState.allCandidates[index] = { ...original, ...hydrated, id: String(candidateId), jobId: pageState.job.id };
    } else {
      for (const key of ['applicants', 'candidates']) {
        const list = pageState.aiEngaged[key] || [];
        const aiIndex = list.findIndex(c => String(c.id) === String(candidateId));
        if (aiIndex >= 0) {
          list[aiIndex] = { ...list[aiIndex], ...hydrated, id: String(candidateId), jobId: pageState.job.id };
          break;
        }
      }
    }
    return hydrated;
  }

  function findSelectedCandidate() {
    if (!pageState.selectedCandId) return null;
    const id = pageState.selectedCandId;

    // Check pipeline first
    let found = pageState.allCandidates.find(c => c.id === id);
    if (found) return found;

    // Check AI applicants
    found = (pageState.aiEngaged.applicants || []).find(c => c.id === id);
    if (found) return found;

    // Check AI candidates
    found = (pageState.aiEngaged.candidates || []).find(c => c.id === id);
    return found || null;
  }
  /* -----------------------------------------------------------
     populateSplitNotes(c)
     Fills the #splitNotesList placeholder (rendered by
     renderCandidateCard) with DOM nodes via renderNotesIntoDom.
     Call this after every innerHTML assignment that uses
     renderCandidateCard so the notes always appear.
  ----------------------------------------------------------- */
  function populateSplitNotes(c) {
    const list  = document.getElementById('splitNotesList');
    const count = document.getElementById('splitNotesCount');
    const notes = Array.isArray(c?.notes) ? c.notes : [];
    if (count) count.textContent = '(' + notes.length + ')';
    renderNotesIntoDom(list, notes);
  }

  /* -----------------------------------------------------------
     wireNoteBtn()
     Wires the Notes button to open the note modal popup.
     Notes form is rendered INSIDE the global modal, not a panel.
  ----------------------------------------------------------- */
  function wireNoteBtn() {
    const btn = document.getElementById('notesBtnSplit');
    if (!btn) return;

    btn.onclick = () => {
      const candId   = btn.dataset.candId;
      const candName = btn.dataset.candName;
      const jobId    = btn.dataset.jobId;

      // Open modal with note form inside
      // NoteWritebackComponent renders into the modal body
      window.openModal(
        `📝 Write Note — ${candName}`,
        '<div id="noteModalContainer"></div>',
        '' // footer is handled inside the component
      );

      // Give modal time to render then inject form
      setTimeout(() => {
        const modalContainer = document.getElementById('noteModalContainer');
        if (modalContainer && typeof NoteWritebackComponent !== 'undefined') {
          NoteWritebackComponent.renderInModal(modalContainer, {
            jobId,
            candidateId: candId,
            candidateName: candName,
            onSuccess: async () => {
              // Re-fetch the candidate so the notes list in the split view
              // reflects the newly written note immediately.
              const refreshed = await ApiService.getCandidateById(candId);
              if (!refreshed?.success || !refreshed.data) return;

              // Update notes on the in-memory candidate record
              const updatedNotes = Array.isArray(refreshed.data.notes) ? refreshed.data.notes : [];
              const candIndex = pageState.allCandidates.findIndex(c => String(c.id) === String(candId));
              if (candIndex >= 0) {
                pageState.allCandidates[candIndex].notes = updatedNotes;
              } else {
                for (const key of ['applicants', 'candidates']) {
                  const list = pageState.aiEngaged[key] || [];
                  const aiIdx = list.findIndex(c => String(c.id) === String(candId));
                  if (aiIdx >= 0) { list[aiIdx].notes = updatedNotes; break; }
                }
              }

              // Re-render the candidate profile area with fresh notes
              const profileArea = document.getElementById('candidateProfileArea');
              const cand = findSelectedCandidate();
              if (profileArea && cand) {
                profileArea.innerHTML = renderCandidateCard(cand);
                wireNoteBtn();
                wireAIMatchBtn();
                wireViewHistoryBtn();
                populateSplitNotes(cand);
              }
            },
          });
        }
      }, 50);
    };
  }

  /* -----------------------------------------------------------
     wireAIMatchBtn()
     Wires the AI Match button (placeholder for demo).
  ----------------------------------------------------------- */
  function wireAIMatchBtn() {
    const btn = document.getElementById('aiMatchBtnSplit');
    if (!btn) return;

    btn.onclick = () => {
      const candName = btn.dataset.candName;
      window.openModal(
        `🤖 AI Match — ${candName}`,
        `<div style="text-align:center;padding:20px">
           <div style="font-size:48px;margin-bottom:12px">🤖</div>
           <p style="color:var(--text-muted);font-size:13px">
             AI Match scoring will connect to your AI engine in production.
             <br><br>
             For now this is a placeholder demonstrating where the
             AI match analysis result will appear.
           </p>
         </div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`
      );
    };
  }

  /* -----------------------------------------------------------
     wireViewHistoryBtn()
     Wires the View History button for AI candidates.
     Opens modal with AI conversation history timeline.
     Uses mock data from the candidate object.
  ----------------------------------------------------------- */
  function wireViewHistoryBtn() {
    const btn = document.getElementById('viewHistoryBtnSplit');
    if (!btn) return;

    btn.onclick = () => {
      const cand = findSelectedCandidate();
      if (!cand) return;
      openHistoryModal(cand);
    };
  }

  /* -----------------------------------------------------------
     openHistoryModal(candidate)
     Shows AI conversation history in a modal popup.
     Uses mock data from candidate.aiHistory array.
  ----------------------------------------------------------- */
  function openHistoryModal(c) {
    const history = c.aiHistory || [];
    const bodyHTML = `
      <div style="margin-bottom:16px">
        <span class="ai-stage-badge">
          🤖 Current: ${c.aiStageLabel || c.aiStage || 'Unknown'}
        </span>
      </div>
      ${history.length === 0
        ? '<p style="color:var(--text-muted)">No history available.</p>'
        : history.map(h => `
          <div style="display:flex;gap:14px;padding-bottom:18px">
            <div style="width:14px;height:14px;border-radius:50%;
                        background:var(--success);flex-shrink:0;margin-top:3px">
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted)">
                ${new Date(h.time).toLocaleString()}
              </div>
              <div style="font-size:13px;font-weight:500;margin-top:2px">
                ${h.event}
              </div>
            </div>
          </div>`).join('')}`;

    window.openModal(
      `🕐 AI History — ${c.name}`,
      bodyHTML,
      `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`
    );
  }

  /* -----------------------------------------------------------
     openAllCandidatesModal()
     Opens a modal with a structured table of all candidates.
     Clicking a candidate name selects them in the split view.
  ----------------------------------------------------------- */
  function openAllCandidatesModal() {
    const pipeline = pageState.allCandidates.map(c =>
      ({ ...c, _source: 'pipeline', _category: '—' }));
    const aiApps = (pageState.aiEngaged.applicants || []).map(c =>
      ({ ...c, _source: 'ai', _category: 'AI Applicant' }));
    const aiCands = (pageState.aiEngaged.candidates || []).map(c =>
      ({ ...c, _source: 'ai', _category: 'AI Candidate' }));

    const all = [...pipeline, ...aiApps, ...aiCands];

    const bodyHTML = `
      <input id="allCandidatesSearch" placeholder="Search by name, ID, city, state, category..."
             style="width:100%;margin-bottom:10px;padding:8px 10px;font-size:12px"/>
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>City</th>
            <th>State</th>
            <th>Experience</th>
            <th>Job ID</th>
          </tr>
        </thead>
        <tbody>
          ${all.map(c => `
            <tr data-modal-cand="${c.id}"
                data-modal-source="${c._source}"
                data-modal-ai-cat="${c.aiCategory || 'Applicant'}"
                data-modal-search="${escapeHtml([c.id, c.name, c.city, c.state, c._category, c.title, c.company].filter(Boolean).join(' '))}">
              <td>
                <span style="color:var(--primary);font-weight:600;cursor:pointer">
                  ${c._source === 'ai' ? '🤖 ' : ''}${c.name}
                </span>
              </td>
              <td>${c._category}</td>
              <td>${c.city || '—'}</td>
              <td>${c.state || '—'}</td>
              <td>${c.experience ? `${c.experience}y` : '—'}</td>
              <td>${pageState.job.atsId || pageState.job.id}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${all.length === 0
        ? '<div class="empty"><p>No candidates for this job.</p></div>'
        : ''}`;

    window.openModal(
      `📋 All Candidates — ${pageState.job.title}`,
      bodyHTML,
      `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`
    );

    // Wire up modal search and row clicks.
    setTimeout(() => {
      const search = document.getElementById('allCandidatesSearch');
      if (search) {
        search.oninput = () => {
          const q = search.value.trim().toLowerCase();
          document.querySelectorAll('[data-modal-cand]').forEach(row => {
            row.style.display = !q || row.dataset.modalSearch.toLowerCase().includes(q) ? '' : 'none';
          });
        };
      }

      document.querySelectorAll('[data-modal-cand]').forEach(row => {
        row.onclick = () => {
          closeModal();
          selectCandidate(
            row.dataset.modalCand,
            row.dataset.modalSource,
            row.dataset.modalAiCat
          );
        };
      });
    }, 50);
  }

  /* -----------------------------------------------------------
     openPostingModal(job)
     Shows the original posting description in a modal.
  ----------------------------------------------------------- */
  function openPostingModal(j) {
    window.openModal(
      `📄 Original Posting — ${j.title}`,
      `<div style="background:var(--surface-2);border-radius:8px;
                   padding:20px;font-size:14px;line-height:1.7">
         ${j.postingDescription || j.description || 'No posting description available.'}
       </div>`,
      `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`
    );
  }

  /* -----------------------------------------------------------
     openActivityModal(job)
     Shows the full job activity timeline.

     Event types rendered (all sourced from the server):
       job_posted                    — anchor: job creation
       job_status_changed            — Open → On Hold, etc.
       job_reopened                  — On Hold / Closed → Open
       job_title_changed             — title edit detected
       job_priority_changed          — priority change
       job_rate_changed              — pay/bill rate change
       job_openings_changed          — headcount change
       job_dates_changed             — start or end date shift
       job_primary_recruiter_assigned — initial primary recruiter
       job_primary_recruiter_changed  — primary recruiter handoff
       job_recruiter_assigned        — secondary recruiter added
       job_sales_assigned            — sales / primary sales added
       job_role_assigned             — named role (Account Mgr, etc.)

     Layout:
       • Filter tabs: All | Status | Job Edits | Team
       • Vertical timeline; each event has a coloured dot,
         icon, timestamp, label, from→to chips, detail line,
         and actor when available.
  ----------------------------------------------------------- */
  async function openActivityModal(j) {
    const esc = (v) => String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    // ── per-type visual config ──────────────────────────────────────────────
    // dot colour is a CSS custom-property reference or an explicit hex
    const EVENT_META = {
      job_posted:                     { icon: '🚀', dot: 'var(--primary)',  group: 'status' },
      job_status_changed:             { icon: '🔄', dot: '#f59e0b',         group: 'status' },
      job_reopened:                   { icon: '♻️', dot: 'var(--success)',  group: 'status' },
      job_title_changed:              { icon: '✏️', dot: 'var(--primary)',  group: 'edits'  },
      job_priority_changed:           { icon: '⚡', dot: '#8b5cf6',         group: 'edits'  },
      job_rate_changed:               { icon: '💰', dot: '#10b981',         group: 'edits'  },
      job_openings_changed:           { icon: '👥', dot: 'var(--primary)',  group: 'edits'  },
      job_dates_changed:              { icon: '📅', dot: '#6366f1',         group: 'edits'  },
      job_description_changed:        { icon: '📝', dot: 'var(--primary)',  group: 'edits'  },
      job_primary_recruiter_assigned: { icon: '🌟', dot: 'var(--success)',  group: 'team'   },
      job_primary_recruiter_changed:  { icon: '🔀', dot: '#f59e0b',         group: 'team'   },
      job_recruiter_assigned:         { icon: '👤', dot: 'var(--primary)',  group: 'team'   },
      job_sales_assigned:             { icon: '💼', dot: '#8b5cf6',         group: 'team'   },
      job_role_assigned:              { icon: '🏷️', dot: '#6366f1',        group: 'team'   },
    };

    // ── status chip colours ─────────────────────────────────────────────────
    const statusChipStyle = (val) => {
      const v = String(val || '').toLowerCase();
      if (v.includes('hold'))   return 'background:#fef3c7;color:#92400e';
      if (v.includes('open'))   return 'background:#d1fae5;color:#065f46';
      if (v.includes('fill'))   return 'background:#dbeafe;color:#1e40af';
      if (v.includes('clos') || v.includes('cancel') || v.includes('expir'))
                                return 'background:#fee2e2;color:#991b1b';
      return 'background:var(--surface-2);color:var(--text-muted)';
    };

    const priorityChipStyle = (val) => {
      const v = String(val || '').toLowerCase();
      if (v === 'high')   return 'background:#fee2e2;color:#991b1b';
      if (v === 'low')    return 'background:#f3f4f6;color:#6b7280';
      return 'background:#fef3c7;color:#92400e';
    };

    // ── render one timeline event row ───────────────────────────────────────
    function renderEvent(event) {
      const meta      = EVENT_META[event.type] || { icon: '📌', dot: 'var(--primary)', group: 'other' };
      const timestamp = event.timestamp ? new Date(event.timestamp).toLocaleString() : '';

      // from → to chips — style depends on event type
      let fromToHTML = '';
      if (event.from || event.to) {
        const isStatus   = event.type === 'job_status_changed' || event.type === 'job_reopened';
        const isPriority = event.type === 'job_priority_changed';

        const chipStyle = isStatus   ? statusChipStyle
                        : isPriority ? priorityChipStyle
                        : () => 'background:var(--surface-2);color:var(--text-muted)';

        const fromChip = event.from
          ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;
                          font-weight:500;${chipStyle(event.from)}">${esc(event.from)}</span>`
          : '';
        const toChip = event.to
          ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;
                          font-weight:600;${chipStyle(event.to)}">${esc(event.to)}</span>`
          : '';
        const arrow = fromChip && toChip
          ? `<span style="font-size:11px;color:var(--text-muted);margin:0 4px">→</span>`
          : '';

        fromToHTML = `<div style="margin-top:5px;display:flex;align-items:center;flex-wrap:wrap;gap:4px">
                        ${fromChip}${arrow}${toChip}
                      </div>`;
      }

      const detailHTML = event.detail
        ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5">
             ${esc(event.detail)}
           </div>`
        : '';

      const actorHTML = event.user
        ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">
             by <strong>${esc(event.user)}</strong>
           </div>`
        : '';

      return `
        <div class="activity-event" data-group="${meta.group}"
             style="position:relative;display:flex;gap:14px;padding:0 0 22px 0">
          <!-- coloured dot -->
          <div style="position:relative;z-index:1;flex:0 0 28px;
                      display:flex;align-items:flex-start;justify-content:center;
                      padding-top:1px">
            <div style="width:28px;height:28px;border-radius:50%;
                        background:${meta.dot};
                        display:flex;align-items:center;justify-content:center;
                        font-size:13px;
                        box-shadow:0 0 0 3px var(--surface)">
              ${meta.icon}
            </div>
          </div>
          <!-- text content -->
          <div style="min-width:0;flex:1;padding-top:4px">
            <div style="font-size:11px;color:var(--text-muted)">${esc(timestamp)}</div>
            <div style="font-size:13px;font-weight:600;margin-top:2px;color:var(--text)">
              ${esc(event.label || 'Job updated')}
            </div>
            ${detailHTML}
            ${fromToHTML}
            ${actorHTML}
          </div>
        </div>`;
    }

    // ── render the full timeline body given an active filter tab ────────────
    function renderTimeline(activity, activeTab) {
      const events      = Array.isArray(activity?.events) ? activity.events : [];
      const postingDate = activity?.postingDate
        ? new Date(activity.postingDate).toLocaleString()
        : (j.postingDate || j.createdAt || '');

      // counts per group — used to label tabs
      const counts = { all: events.length, status: 0, edits: 0, team: 0 };
      for (const ev of events) {
        const g = (EVENT_META[ev.type] || {}).group;
        if (g && counts[g] !== undefined) counts[g]++;
      }

      const tabs = [
        { key: 'all',    label: `All (${counts.all})`           },
        { key: 'status', label: `Status (${counts.status})`     },
        { key: 'edits',  label: `Job Edits (${counts.edits})`   },
        { key: 'team',   label: `Team (${counts.team})`         },
      ];

      const tabBar = `
        <div id="activityTabBar"
             style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px">
          ${tabs.map(t => `
            <button class="filter-btn ${activeTab === t.key ? 'active' : ''}"
                    data-activity-tab="${t.key}"
                    style="font-size:12px">
              ${t.label}
            </button>`).join('')}
        </div>`;

      const visible = activeTab === 'all'
        ? events
        : events.filter(ev => (EVENT_META[ev.type] || {}).group === activeTab);

      const meta = `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
          Activity since job posting${postingDate ? ` · ${esc(postingDate)}` : ''}
        </div>`;

      if (visible.length === 0) {
        return meta + tabBar + `
          <div class="empty" style="padding:24px 0">
            <p>No ${activeTab === 'all' ? '' : activeTab + ' '}activity recorded for this job.</p>
          </div>`;
      }

      return meta + tabBar + `
        <div style="position:relative;padding-left:4px" id="activityList">
          <!-- vertical connector line -->
          <div style="position:absolute;left:13px;top:14px;bottom:14px;
                      width:2px;background:var(--border);z-index:0"></div>
          ${visible.map(renderEvent).join('')}
        </div>`;
    }

    // ── open modal shell immediately (loading state) ─────────────────────────
    window.openModal(
      `🕐 Job Activity — ${esc(j.title || 'Job')}`,
      `<div id="jobActivityBody">
         <div style="display:flex;align-items:center;justify-content:center;
                     padding:48px 0;color:var(--text-muted);font-size:13px">
           <div class="loading-spinner" style="margin-right:10px"></div>
           Loading job activity…
         </div>
       </div>`,
      `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`
    );

    // ── fetch and render ──────────────────────────────────────────────────────
    try {
      const result = await ApiService.getJobActivity(j.id);
      const body   = document.getElementById('jobActivityBody');
      if (!body) return;

      if (!result.success) {
        body.innerHTML = `
          <div class="empty" style="padding:30px 0">
            <p>Unable to load job activity.</p>
            <div style="font-size:12px;color:var(--text-muted);margin-top:6px">
              ${esc(result.error || 'Unknown error')}
            </div>
          </div>`;
        return;
      }

      // Render with 'all' tab active initially
      let activeTab = 'all';
      body.innerHTML = renderTimeline(result.data, activeTab);

      // Wire tab buttons — re-render the list without re-fetching
      body.querySelectorAll('[data-activity-tab]').forEach(btn => {
        btn.onclick = () => {
          activeTab = btn.dataset.activityTab;
          body.innerHTML = renderTimeline(result.data, activeTab);
          // Re-wire after re-render
          body.querySelectorAll('[data-activity-tab]').forEach(b => {
            b.onclick = () => {
              activeTab = b.dataset.activityTab;
              body.innerHTML = renderTimeline(result.data, activeTab);
              wireTabButtons();
            };
          });
        };
      });

      function wireTabButtons() {
        body.querySelectorAll('[data-activity-tab]').forEach(b => {
          b.onclick = () => {
            activeTab = b.dataset.activityTab;
            body.innerHTML = renderTimeline(result.data, activeTab);
            wireTabButtons();
          };
        });
      }

    } catch (error) {
      const body = document.getElementById('jobActivityBody');
      if (!body) return;
      body.innerHTML = `
        <div class="empty" style="padding:30px 0">
          <p>Unable to load job activity.</p>
          <div style="font-size:12px;color:var(--text-muted);margin-top:6px">
            ${esc(error.message || 'Unknown error')}
          </div>
        </div>`;
    }
  }

  return { render };

})();
