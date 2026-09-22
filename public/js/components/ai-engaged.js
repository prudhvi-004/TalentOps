/* =============================================================
   AI ENGAGED COMPONENT — ai-engaged.js
   =============================================================
   Purpose:
     Renders the AI Engaged section inside the job detail
     right panel. Shows two categories:
       → Engaged Applicants
       → Engaged Candidates
     Each category lists candidates fetched from the ATS
     via a UDF field match on JobID.

   How AI Engaged candidates are identified in ATS:
     Each AI Engaged candidate record in the ATS has:
       UDF Field 1 (e.g. customText1) = JobID they match to
       UDF Field 2 (e.g. customText2) = "Applicant" or "Candidate"
     The server filters by these fields and groups them.
     Field names are configured in .env:
       AI_ENGAGED_JOB_UDF_FIELD
       AI_ENGAGED_TYPE_FIELD

   Navigation:
     Clicking a candidate card opens the unified candidate
     profile page with heading "AI Engaged Applicant" or
     "AI Engaged Candidate" based on their category.
     This is identical layout to Pipeline candidate profile
     with the addition of View History button.

   API connection:
     ApiService.getAIEngagedForJob(jobId)
     Server route: GET /api/jobs/:id/ai-engaged
     Server logic: server/services/ats.service.js → getAIEngagedForJob()

   Mock data source (when ATS_PROVIDER=mock):
     data/ai-engaged.json
   ============================================================= */

const AIEngagedComponent = (() => {

  /* -----------------------------------------------------------
     STATE
     Tracks which sub-tab is active within AI Engaged:
       'applicant' → Engaged Applicants
       'candidate' → Engaged Candidates
  ----------------------------------------------------------- */
  let activeTab = 'applicant';
  let cachedData = null; // Cache fetched data so tab switch is instant

  /* -----------------------------------------------------------
     render(container, jobId, job)
     Main entry — called by job-detail.js when AI Engaged
     tab is first clicked.

     @param container - DOM element to render into
     @param jobId     - ATS Job ID
     @param job       - Full job object for context
  ----------------------------------------------------------- */
  async function render(container, jobId, job) {
    // Show loading while fetching
    container.innerHTML = `
      <div style="margin-bottom:14px">

        <!-- Sub-tab buttons: Applicants vs Candidates -->
        <!-- These are FILTER BUTTONS not dropdowns as specified -->
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button
            class="filter-btn ${activeTab === 'applicant' ? 'active' : ''}"
            data-ai-tab="applicant">
            Engaged Applicants
          </button>
          <button
            class="filter-btn ${activeTab === 'candidate' ? 'active' : ''}"
            data-ai-tab="candidate">
            Engaged Candidates
          </button>
        </div>

        <!-- Candidate list renders here -->
        <div id="aiCandList">
          <div class="loading-screen" style="height:80px">
            <div class="loading-spinner"></div>
            <p>Loading AI Engaged candidates...</p>
          </div>
        </div>

      </div>`;

    // Wire up sub-tab buttons
    container.querySelectorAll('[data-ai-tab]').forEach(btn => {
      btn.onclick = () => {
        activeTab = btn.dataset.aiTab;

        // Update active state on buttons
        container.querySelectorAll('[data-ai-tab]').forEach(b => {
          b.classList.toggle('active', b.dataset.aiTab === activeTab);
        });

        // Re-render the list with cached data (no new fetch needed)
        if (cachedData) {
          renderList(
            document.getElementById('aiCandList'),
            cachedData,
            jobId,
            job
          );
        }
      };
    });

    // Fetch AI Engaged candidates from API
    // [API-CONNECT] ApiService.getAIEngagedForJob calls:
    //   GET /api/jobs/:id/ai-engaged
    //   which calls atsService.getAIEngagedForJob(jobId)
    //   which filters candidates by UDF JobID field
    const result = await ApiService.getAIEngagedForJob(jobId);
    const listContainer = document.getElementById('aiCandList');

    if (!result.success) {
      listContainer.innerHTML = `
        <div class="empty" style="padding:20px 0">
          <h3>Could not load AI Engaged candidates</h3>
          <p style="font-size:12px;color:var(--text-muted)">${result.error}</p>
        </div>`;
      return;
    }

    // Cache the result so tab switching doesn't re-fetch
    cachedData = result.data;

    // Render the active tab list
    renderList(listContainer, cachedData, jobId, job);
  }

  /* -----------------------------------------------------------
     renderList(container, data, jobId, job)
     Renders the candidate cards for the currently active tab.

     @param container - DOM element for the list
     @param data      - { applicants: [...], candidates: [...] }
     @param jobId     - for navigation URL
     @param job       - for context
  ----------------------------------------------------------- */
  function renderList(container, data, jobId, job) {
    // Pick which array to show based on active tab
    const list = activeTab === 'applicant'
      ? (data.applicants || [])
      : (data.candidates || []);

    // Category label for display
    const categoryLabel = activeTab === 'applicant'
      ? 'Engaged Applicant'
      : 'Engaged Candidate';

    // Count display
    const countText = `${list.length} AI ${categoryLabel}${list.length !== 1 ? 's' : ''}`;

    if (list.length === 0) {
      container.innerHTML = `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
          ${countText}
        </div>
        <div class="empty" style="padding:24px 0">
          <div style="font-size:32px;margin-bottom:8px">🤖</div>
          <h3>No ${categoryLabel}s</h3>
          <p style="font-size:12px">
            AI Engaged ${categoryLabel}s for this job will appear here
            when their ATS record UDF matches this JobID.
          </p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
        ${countText}
      </div>
      ${list.map(c => aiCandidateCard(c, categoryLabel)).join('')}`;

    // Click handler — navigate to candidate profile
    // Passes source=ai and aiCategory so profile page
    // shows the correct heading
    container.querySelectorAll('[data-ai-cand]').forEach(el => {
      el.onclick = () => {
        const candId   = el.dataset.aiCand;
        const category = el.dataset.aiCategory;
        window.navigate(
          `/candidates/${candId}?source=ai&jobId=${jobId}&aiCategory=${category}`
        );
      };
    });
  }

  /* -----------------------------------------------------------
     aiCandidateCard(candidate, categoryLabel)
     Renders a single AI Engaged candidate card.

     Shows:
       → Name, email, location, experience
       → Skills tags
       → AI Stage badge (current conversation stage)
       → Click → opens unified candidate profile with
                  AI Engaged heading + View History button
  ----------------------------------------------------------- */
  function aiCandidateCard(c, categoryLabel) {
    const skills = (c.skills || []).slice(0, 4);
    const extraSkills = (c.skills || []).length - 4;

    // Map AI stage key to display label and color
    const stageInfo = getStageInfo(c.aiStage);

    return `
      <div class="ai-cand-item fade-in"
           data-ai-cand="${c.id}"
           data-ai-category="${c.aiCategory || 'Applicant'}">

        <!-- Top row: name + stage badge -->
        <div style="display:flex;justify-content:space-between;
                    align-items:flex-start;gap:10px">
          <div style="flex:1">
            <!-- Candidate name -->
            <div class="cand-name" style="font-size:14px">${c.name}</div>

            <!-- Email + location + experience -->
            <div class="cand-meta" style="margin-top:3px">
              📧 ${c.email || '—'} ·
              📍 ${c.city || c.location || '—'}, ${c.state || ''}
              ${c.experience ? `· ${c.experience}y exp` : ''}
            </div>

            <!-- Skills -->
            ${skills.length > 0 ? `
            <div style="margin-top:6px">
              ${skills.map(s => `<span class="tile-tag">${s}</span>`).join('')}
              ${extraSkills > 0 ? `<span class="tile-tag">+${extraSkills}</span>` : ''}
            </div>` : ''}
          </div>

          <!-- Arrow -->
          <div style="color:var(--text-muted);font-size:18px;flex-shrink:0">›</div>
        </div>

        <!-- AI Stage indicator -->
        <!-- This reflects at what stage the AI conversation is -->
        <div style="margin-top:10px;padding-top:8px;
                    border-top:1px solid var(--border);
                    display:flex;align-items:center;gap:8px">
          <span class="ai-stage-badge">
            🤖 ${c.aiStageLabel || stageInfo.label}
          </span>
          <span style="font-size:11px;color:var(--primary)">
            View full profile →
          </span>
        </div>

      </div>`;
  }

  /* -----------------------------------------------------------
     getStageInfo(stageKey)
     Maps internal stage keys to human readable labels.
     Add new stages here as the AI system evolves.
  ----------------------------------------------------------- */
  function getStageInfo(stageKey) {
    const stages = {
      'shortlisted':     { label: 'Shortlisted by AI' },
      '1st_call_fail':   { label: '1st Call Failed → 2nd Attempt Scheduled' },
      '2nd_attempting':  { label: '2nd Attempt In Progress' },
      'email_sent':      { label: 'Email Sent — Awaiting Response' },
      'evaluated':       { label: 'Evaluated — Awaiting Recruiter Review' },
      'connected':       { label: 'AI Connected — Conversation Ongoing' },
      'completed':       { label: 'AI Conversation Complete' },
    };
    return stages[stageKey] || { label: stageKey || 'In Progress' };
  }

  return { render };

})();