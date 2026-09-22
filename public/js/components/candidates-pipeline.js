/* =============================================================
   CANDIDATES IN PIPELINE COMPONENT — candidates-pipeline.js
   =============================================================
   Purpose:
     Renders the list of candidates in pipeline for a job.
     Each candidate card is clickable → opens unified
     candidate profile page.

   Note:
     "Pipeline" here means candidates linked to this job
     in the ATS. No stage/status filtering is applied —
     all linked candidates are shown.

   API connection:
     ApiService.getCandidatesForJob(jobId)
   ============================================================= */

const CandidatesPipelineComponent = (() => {

  /* -----------------------------------------------------------
     render(container, jobId, job)
     @param container - DOM element to render into
     @param jobId     - ATS job ID to fetch candidates for
     @param job       - full job object (for context in profile)
  ----------------------------------------------------------- */
  async function render(container, jobId, job) {
    container.innerHTML = `
      <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;font-weight:600">Candidates in Pipeline</div>
        <div id="pipelineCount" style="font-size:12px;color:var(--text-muted)">Loading...</div>
      </div>
      <div id="pipelineList">
        <div class="loading-screen" style="height:80px">
          <div class="loading-spinner"></div>
        </div>
      </div>`;

    // Fetch candidates for this job
    const result = await ApiService.getCandidatesForJob(jobId);
    const list = document.getElementById('pipelineList');
    const countEl = document.getElementById('pipelineCount');

    if (!result.success) {
      list.innerHTML = `<div class="empty"><p>Could not load candidates: ${result.error}</p></div>`;
      countEl.textContent = '';
      return;
    }

    const candidates = result.data;
    countEl.textContent = `${candidates.length} candidate${candidates.length !== 1 ? 's' : ''}`;

    if (candidates.length === 0) {
      list.innerHTML = `
        <div class="empty" style="padding:30px 0">
          <h3>No candidates yet</h3>
          <p>Candidates linked to this job in ATS will appear here.</p>
        </div>`;
      return;
    }

    // Render candidate cards
    list.innerHTML = candidates.map(c => candidateCard(c)).join('');

    // Click handler → open candidate profile
    list.querySelectorAll('[data-cand]').forEach(el => {
      el.onclick = () => {
        // Navigate to candidate profile
        // source=pipeline tells the profile page which heading to use
        window.navigate(
          `/candidates/${el.dataset.cand}?source=pipeline&jobId=${jobId}`
        );
      };
    });
  }

  /* -----------------------------------------------------------
     Renders a single candidate card in the pipeline list
  ----------------------------------------------------------- */
  function candidateCard(c) {
    const skills = (c.skills || []).slice(0, 4);
    const extraSkills = (c.skills || []).length - 4;

    return `
      <div class="candidate-list-item fade-in" data-cand="${c.id}">
        <div style="flex:1">
          <!-- Name + meta -->
          <div class="cand-name">${c.name}</div>
          <div class="cand-meta">
            📧 ${c.email || '—'} ·
            📍 ${c.city || c.location || '—'}, ${c.state || ''}
            ${c.experience ? `· ${c.experience}y exp` : ''}
          </div>

          <!-- Skills -->
          ${skills.length > 0 ? `
          <div class="cand-skills" style="margin-top:6px">
            ${skills.map(s => `<span class="tile-tag">${s}</span>`).join('')}
            ${extraSkills > 0 ? `<span class="tile-tag">+${extraSkills}</span>` : ''}
          </div>` : ''}
        </div>

        <!-- Arrow indicator -->
        <div style="color:var(--text-muted);font-size:18px">›</div>
      </div>`;
  }

  return { render };

})();