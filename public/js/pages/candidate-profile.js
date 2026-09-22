/* =============================================================
   CANDIDATE PROFILE PAGE — candidate-profile.js
   =============================================================
   JobDiva-backed candidate profile.

   The server now composes this view from the verified JobDiva
   CandidateDetail + CandidateResumesDetail + ResumesTextDetail +
   CandidateNotesListDetail + CandidateAttachmentList contracts.
   ============================================================= */

const CandidateProfilePage = (() => {

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? escapeHtml(value) : d.toLocaleString();
  }

  function noteText(value) {
    return escapeHtml(String(value || '').replace(/<br\s*\/?>/gi, '\n'));
  }

  function renderResumeList(c) {
    const resumes = Array.isArray(c.resumes) ? c.resumes : [];
    if (!resumes.length) {
      return '<p style="font-size:13px;color:var(--text-muted)">No resume records returned by JobDiva.</p>';
    }

    return `
      <div class="resume-list">
        ${resumes.map((r, i) => `
          <div class="resume-item" data-resume-id="${escapeHtml(r.id)}">
            <div>
              <div style="font-weight:600;font-size:13px">
                ${i === 0 ? '⭐ ' : ''}Resume ${i + 1}
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:3px">
                ID: ${escapeHtml(r.id || '—')} · Updated: ${formatDate(r.updatedAt)}
              </div>
            </div>
            ${r.text ? `<button class="btn btn-sm btn-secondary" data-view-resume="${escapeHtml(r.id)}">View</button>` : ''}
          </div>
        `).join('')}
      </div>
      <div id="resumeViewer" style="margin-top:12px"></div>`;
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

  function normaliseNotes(notes) {
    if (!Array.isArray(notes)) return [];

    return notes
      .map(note => {
        // JobDiva normally returns note rows as objects. Keep support for
        // lower-case aliases as well so the renderer is not coupled to one
        // exact response casing.
        if (note && typeof note === 'object' && !Array.isArray(note)) {
          return note;
        }
        return { NOTE: note == null ? '' : String(note) };
      })
      .filter(Boolean);
  }

  function getNoteField(note, ...keys) {
    for (const key of keys) {
      if (note && note[key] !== undefined && note[key] !== null && String(note[key]) !== '') {
        return note[key];
      }
    }
    return '';
  }

  function renderNotesInto(list, c, query = '') {
    if (!list) return 0;

    const notes = normaliseNotes(c?.notes);
    const q = String(query || '').trim().toLowerCase();

    const filtered = notes.filter(note => {
      if (!q) return true;

      return [
        getNoteField(note, 'ACTIONTYPE', 'actionType'),
        getNoteField(note, 'NOTE', 'note'),
        getNoteField(note, 'USERNAME', 'username'),
        getNoteField(note, 'NOTE_TYPE', 'noteType'),
        getNoteField(note, 'JOBID', 'jobId'),
        getNoteField(note, 'NOTEID', 'noteId'),
      ].some(value => String(value ?? '').toLowerCase().includes(q));
    });

    // Render through DOM APIs rather than injecting the note body into the
    // large candidate-profile innerHTML template. This makes note rendering
    // independent of the surrounding template and safely handles arbitrary
    // JobDiva note text.
    list.replaceChildren();

    if (!notes.length) {
      const empty = document.createElement('div');
      empty.className = 'candidate-notes-empty';
      empty.textContent = 'No notes returned by JobDiva.';
      list.appendChild(empty);
      return 0;
    }

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'candidate-notes-empty';
      empty.textContent = 'No notes match your search.';
      list.appendChild(empty);
      return 0;
    }

    filtered.forEach(note => {
      const article = document.createElement('article');
      article.className = 'candidate-note';

      const header = document.createElement('div');
      header.className = 'candidate-note-header';

      const action = document.createElement('div');
      action.className = 'candidate-note-action';
      action.textContent = getNoteField(note, 'ACTIONTYPE', 'actionType') || 'Note';

      const meta = document.createElement('div');
      meta.className = 'candidate-note-meta';
      const timestamp = getNoteField(
        note,
        'ACTIONDATE', 'actionDate',
        'CREATEDATE', 'createdAt',
        'DATEUPDATED', 'dateUpdated'
      );
      const username = getNoteField(note, 'USERNAME', 'username');
      meta.textContent = `${formatNoteDate(timestamp)}${username ? ` · ${username}` : ''}`;

      header.appendChild(action);
      header.appendChild(meta);

      const body = document.createElement('div');
      body.className = 'candidate-note-body';
      body.textContent = String(getNoteField(note, 'NOTE', 'note') || '')
        .replace(/<br\s*\/?>/gi, '\n');

      article.appendChild(header);
      if (body.textContent) article.appendChild(body);
      list.appendChild(article);
    });

    return filtered.length;
  }

  function renderNotes(c, query = '') {
    // Kept as a small fallback for callers outside the main renderer.
    const notes = normaliseNotes(c?.notes);
    if (!notes.length) {
      return '<div class="candidate-notes-empty">No notes returned by JobDiva.</div>';
    }
    return `<div class="candidate-notes-list-placeholder" data-note-count="${notes.length}"></div>`;
  }

  function renderAttachments(c) {
    const attachments = Array.isArray(c.attachments) ? c.attachments : [];
    if (!attachments.length) {
      return '<p style="font-size:13px;color:var(--text-muted)">No candidate attachments returned by JobDiva.</p>';
    }

    return `<div class="attachment-list">
      ${attachments.map(a => `
        <div class="attachment-item">
          <span>📎 ${escapeHtml(a.FILENAME || a.filename || a.NAME || a.name || 'Attachment')}</span>
          ${a.DESCRIPTION || a.description ? `<span style="font-size:11px;color:var(--text-muted)">${escapeHtml(a.DESCRIPTION || a.description)}</span>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  async function render(container, candidateId, source, jobId) {
    container.innerHTML = `
      <div class="loading-screen">
        <div class="loading-spinner"></div>
        <p>Loading candidate profile from JobDiva...</p>
      </div>`;

    const params = new URLSearchParams(window.location.search);
    const aiCategory = params.get('aiCategory') || 'Applicant';
    const heading = source === 'ai'
      ? (aiCategory === 'Candidate' ? '🤖 AI Engaged Candidate' : '🤖 AI Engaged Applicant')
      : '👤 Candidate Profile';
    const backPath = jobId ? `/jobs/${jobId}` : '/jobs';

    const result = await ApiService.getCandidateById(candidateId);

    if (!result.success) {
      container.innerHTML = `
        <div class="breadcrumb"><span id="backBtn">← Back to Job</span></div>
        <div class="empty"><h3>Candidate not found</h3><p>${escapeHtml(result.error)}</p></div>`;
      document.getElementById('backBtn').onclick = () => navigate(backPath);
      return;
    }

    const c = result.data || {};
    const phones = c.contact?.phones || [];
    const salary = c.salaryDetails || {};
    const social = c.social || {};
    const latestSubmission = c.submittal || {};

    container.innerHTML = `
      <div class="fade-in">
        <div class="breadcrumb" style="margin-bottom:8px">
          <span id="backBtn">← Back to Job</span>
        </div>

        <div class="page-header">
          <div>
            <div class="page-title">${heading}</div>
            <div class="page-subtitle">
              ${escapeHtml(c.name)} · ${escapeHtml(c.location || [c.city, c.state].filter(Boolean).join(', ') || '—')}
            </div>
          </div>
          <div class="page-actions">
            ${source === 'ai' ? `<button class="btn btn-secondary" id="viewHistoryBtn">🕐 View History</button>` : ''}
            <button class="btn btn-primary" id="openNoteBtn">📝 Write Note</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:16px">
          <div>
            <div class="detail-card">
              <h3>👤 Candidate Information</h3>
              ${[
                ['Candidate ID', c.id],
                ['Full Name', c.name],
                ['Email', c.email],
                ['Alternate Email', c.contact?.alternateEmail],
                ['Phone', c.phone],
                ['Other Phones', phones.filter(p => String(p) !== String(c.phone)).join(', ')],
                ['Address', [c.raw?.ADDRESS1, c.raw?.ADDRESS2].filter(Boolean).join(', ')],
                ['Location', c.location || [c.city, c.state, c.zipCode, c.country].filter(Boolean).join(', ')],
                ['Current Title', c.title],
                ['Current Company', c.company],
                ['Status', c.status],
                ['Profession / Specialty', c.raw?.PROFESSION_SPECIALTY],
              ].map(([label, value]) => value ? `
                <div class="detail-row"><span class="detail-label">${label}</span><span>${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}</span></div>
              ` : '').join('')}
              ${source === 'ai' ? `
                <div class="detail-row"><span class="detail-label">AI Stage</span><span><span class="ai-stage-badge">🤖 ${escapeHtml(c.aiStageLabel || c.aiStage || '—')}</span></span></div>
              ` : ''}
            </div>

            ${latestSubmission && (latestSubmission.submittalDate || latestSubmission.hiringManager || latestSubmission.startStatus || latestSubmission.recruiterName) ? `
            <div class="detail-card">
              <h3>📌 Job Submission</h3>
              <div class="detail-row"><span class="detail-label">Job ID</span><span>${escapeHtml(latestSubmission.jobId || jobId || '—')}</span></div>
              <div class="detail-row"><span class="detail-label">Submittal Date</span><span>${formatDate(latestSubmission.submittalDate)}</span></div>
              <div class="detail-row"><span class="detail-label">Recruiter</span><span>${escapeHtml(latestSubmission.recruiterName || '—')}</span></div>
              <div class="detail-row"><span class="detail-label">Hiring Manager</span><span>${escapeHtml(latestSubmission.hiringManager || '—')}</span></div>
              <div class="detail-row"><span class="detail-label">Interview</span><span>${formatDate(latestSubmission.interviewDate || latestSubmission.interviewScheduleDate)}</span></div>
              <div class="detail-row"><span class="detail-label">Start Status</span><span>${escapeHtml(latestSubmission.startStatus || '—')}</span></div>
              <div class="detail-row"><span class="detail-label">Hire Flag</span><span>${escapeHtml(latestSubmission.hireFlag || '—')}</span></div>
              <div class="detail-row"><span class="detail-label">Pay Rate</span><span>${escapeHtml(latestSubmission.payRate || '—')} ${escapeHtml(latestSubmission.payFrequency || '')}</span></div>
              <div class="detail-row"><span class="detail-label">Bill Rate</span><span>${escapeHtml(latestSubmission.billRate || '—')} ${escapeHtml(latestSubmission.billFrequency || '')}</span></div>
            </div>` : ''}

            <div class="detail-card">
              <h3>💰 Compensation</h3>
              <div class="detail-row"><span class="detail-label">Current Salary</span><span>${escapeHtml(salary.current || '—')} ${escapeHtml(salary.currentPer || '')}</span></div>
              <div class="detail-row"><span class="detail-label">Preferred Minimum</span><span>${escapeHtml(salary.preferredMinimum || '—')} ${escapeHtml(salary.preferredPer || '')}</span></div>
            </div>

            ${c.profile ? `<div class="detail-card"><h3>📝 Profile</h3><p style="font-size:13px;line-height:1.7;white-space:pre-wrap">${escapeHtml(c.profile)}</p></div>` : ''}

            ${c.skills?.length ? `<div class="detail-card"><h3>🛠 Skills</h3><div>${c.skills.map(s => `<span class="tile-tag">${escapeHtml(s)}</span>`).join('')}</div></div>` : ''}

            ${(c.education || c.certifications?.length) ? `
              <div class="detail-card">
                <h3>🎓 Education & Certifications</h3>
                ${c.education ? `<div class="detail-row"><span class="detail-label">Education</span><span>${escapeHtml(c.education)}</span></div>` : ''}
                ${c.certifications?.length ? `<div class="detail-row"><span class="detail-label">Certifications</span><span>${c.certifications.map(x => `<span class="tile-tag">${escapeHtml(x)}</span>`).join('')}</span></div>` : ''}
              </div>` : ''}

            ${Object.values(social).some(Boolean) ? `
              <div class="detail-card">
                <h3>🔗 Online Profiles</h3>
                ${Object.entries(social).filter(([,v]) => v).map(([k,v]) => `<div class="detail-row"><span class="detail-label">${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('')}
              </div>` : ''}

            <div class="detail-card">
              <h3>📄 Resumes <span style="font-weight:400;font-size:12px;color:var(--text-muted)">(${(c.resumes || []).length})</span></h3>
              ${renderResumeList(c)}
            </div>

            <div class="detail-card">
              <h3>📎 Attachments</h3>
              ${renderAttachments(c)}
            </div>

            <div class="detail-card candidate-notes-card">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
                <h3 style="margin:0">🗒 JobDiva Notes <span id="candidateNotesCount" style="font-weight:400;font-size:12px;color:var(--text-muted)">(${normaliseNotes(c.notes).length})</span></h3>
                ${normaliseNotes(c.notes).length ? `<input id="candidateNotesSearch" placeholder="Search notes..." style="min-width:220px;padding:6px 10px;font-size:12px"/>` : ''}
              </div>
              <div id="candidateNotesList" class="candidate-notes-container" aria-live="polite"></div>
            </div>
          </div>

          <div>
            <div class="detail-card" style="position:sticky;top:16px">
              <h3>📝 Write Note to ATS</h3>
              <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0">Use the <strong>Write Note</strong> button above to open the JobDiva note form.</p>
            </div>
          </div>
        </div>
      </div>`;

    // Render notes only after the candidate DOM exists. This is deliberately
    // separate from the large template above so the notes list cannot be
    // swallowed by template/HTML parsing or surrounding layout.
    const candidateNotesList = document.getElementById('candidateNotesList');
    const renderedNoteCount = renderNotesInto(candidateNotesList, c);
    console.log(`[CandidateProfile] Rendered notes: ${renderedNoteCount}`);

    document.getElementById('backBtn').onclick = () => navigate(backPath);

    if (source === 'ai') {
      document.getElementById('viewHistoryBtn').onclick = () => openHistoryModal(c);
    }

    const notesSearch = document.getElementById('candidateNotesSearch');
    if (notesSearch) {
      notesSearch.oninput = () => {
        const list = document.getElementById('candidateNotesList');
        if (list) renderNotesInto(list, c, notesSearch.value);
      };
    }

    document.getElementById('openNoteBtn').onclick = () => {
      window.openModal(
        `📝 Write Note — ${escapeHtml(c.name)}`,
        '<div id="noteModalContainer"></div>',
        '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
      );
      const modalContainer = document.getElementById('noteModalContainer');
      if (modalContainer && typeof NoteWritebackComponent !== 'undefined') {
        NoteWritebackComponent.renderInModal(modalContainer, {
          jobId: jobId || c.jobId || '',
          candidateId: c.id,
          candidateName: c.name,
          onSuccess: async () => {
            // Re-read CandidateNotesListDetail after a successful write so
            // the new JobDiva note appears immediately in this page.
            const refreshed = await ApiService.getCandidateById(c.id);
            if (!refreshed?.success || !refreshed.data) return;

            c.notes = normaliseNotes(refreshed.data.notes);

            const count = document.getElementById('candidateNotesCount');
            if (count) count.textContent = `(${c.notes.length})`;

            const list = document.getElementById('candidateNotesList');
            if (list) renderNotesInto(list, c, notesSearch?.value || '');
          },
        });
      }
    };

    document.querySelectorAll('[data-view-resume]').forEach(button => {
      button.onclick = () => {
        const resume = (c.resumes || []).find(r => String(r.id) === String(button.dataset.viewResume));
        const viewer = document.getElementById('resumeViewer');
        if (!viewer || !resume) return;
        viewer.innerHTML = resume.text
          ? `<pre style="white-space:pre-wrap;font-family:'Courier New',monospace;font-size:12px;background:var(--surface-2);padding:14px;border-radius:8px;line-height:1.6;max-height:700px;overflow:auto">${escapeHtml(resume.text)}</pre>`
          : '<p style="color:var(--text-muted);font-size:12px">No text was returned for this resume.</p>';
      };
    });

  }

  function openHistoryModal(c) {
    const history = c.aiHistory || [];
    const bodyHTML = `
      <div style="margin-bottom:12px"><span class="ai-stage-badge">🤖 Current Stage: ${escapeHtml(c.aiStageLabel || c.aiStage || 'Unknown')}</span></div>
      ${history.length === 0
        ? '<p style="color:var(--text-muted)">No history available.</p>'
        : history.map(h => `
          <div style="display:flex;gap:12px;padding-bottom:16px">
            <div style="width:14px;height:14px;border-radius:50%;background:var(--success);flex-shrink:0;margin-top:3px"></div>
            <div><div style="font-size:11px;color:var(--text-muted)">${formatDate(h.time)}</div><div style="font-size:13px;font-weight:500;margin-top:2px">${escapeHtml(h.event)}</div></div>
          </div>`).join('')}`;

    window.openModal(
      `🕐 AI History — ${escapeHtml(c.name)}`,
      bodyHTML,
      `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`
    );
  }

  return { render };

})();
