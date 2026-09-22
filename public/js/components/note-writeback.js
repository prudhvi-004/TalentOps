/* =============================================================
   NOTE WRITEBACK COMPONENT — note-writeback.js
   =============================================================
   Purpose:
     Renders the note form inside a modal popup.
     Called when user clicks the Notes button on a candidate
     in the split view. Opens as a modal, not a side panel.

   Entry points:
     NoteWritebackComponent.renderInModal(container, context)
       → Used by job-detail.js Notes button

   Form flow:
     1. Job ID      — auto-tagged, read-only
     2. Candidate   — auto-tagged, read-only
     3. Action Type — dropdown (4 options)
     4. Alignment   — ONLY for "Rec – Sense AI"
     5. Note Text   — required
     6. Preview     — live composed note preview
     7. Submit      — sends to ATS, shows confirmed success only

   Note format sent to ATS:

     Rec – Sense AI:
       "{Candidate Alignment} – {Note Text}"

     Other action types:
       "{Note Text}"

   On success: shows green confirmation, resets form
   On failure: queues retry, adds bell notification
   ============================================================= */

const NoteWritebackComponent = (() => {

  const NOTE_ACTION_TYPES = [
    'Rec – Sense AI',
    'Rec – Outbound',
    'Rec – Engaged',
    'Rec – Inbound',
  ];

  const ALIGNMENT_OPTIONS = [
    'Candidate Aligns with the Role',
    'Candidate is a Partial Fit',
    'Candidate is Not a Fit',
  ];

  // In-browser note retry queue
  const noteQueue = [];

  /* -----------------------------------------------------------
     renderInModal(container, context)
     Renders the full note form inside a modal container.

     @param container  - DOM element inside the modal body
     @param context    - { jobId, candidateId, candidateName }
  ----------------------------------------------------------- */
  function renderInModal(container, context) {
    const { jobId, candidateId, candidateName, onSuccess } = context;

    container.innerHTML = `
      <div style="padding:4px 0">

        <!-- Auto-tagged fields (read-only) -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                        text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">
              Job ID <span style="font-weight:400">(auto-tagged)</span>
            </div>
            <input type="text" value="${jobId || 'Not available'}" readonly
              style="width:100%;background:var(--surface-2);
                     color:var(--text-muted);cursor:default"/>
            <input type="hidden" id="nm_jobId" value="${jobId || ''}"/>
          </div>

          <div>
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                        text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">
              Candidate <span style="font-weight:400">(auto-tagged)</span>
            </div>
            <input type="text" value="${candidateName || '—'}" readonly
              style="width:100%;background:var(--surface-2);
                     color:var(--text-muted);cursor:default"/>
            <input type="hidden" id="nm_candidateId" value="${candidateId || ''}"/>
            <input type="hidden" id="nm_candidateName" value="${candidateName || ''}"/>
          </div>
        </div>

        <!-- Note Action Type -->
        <div class="form-group">
          <label>
            Note Action Type
            <span style="color:var(--danger)">*</span>
          </label>

          <select id="nm_actionType">
            <option value="">— Select Action Type —</option>

            ${NOTE_ACTION_TYPES.map(t =>
              `<option value="${t}">${t}</option>`
            ).join('')}
          </select>
        </div>

        <!-- Candidate Alignment
             ONLY visible for Rec – Sense AI -->
        <div class="form-group" id="nm_alignGroup" style="display:none">

          <label>
            Candidate Alignment
            <span style="color:var(--danger)">*</span>
          </label>

          <select id="nm_alignment">
            <option value="">— Select Alignment —</option>

            ${ALIGNMENT_OPTIONS.map(o =>
              `<option value="${o}">${o}</option>`
            ).join('')}
          </select>
        </div>

        <!-- Note Text -->
        <div class="form-group" id="nm_textGroup" style="display:none">

          <label>
            Note
            <span style="color:var(--danger)">*</span>

            <span style="font-weight:400;text-transform:none;font-size:11px;
                         color:var(--text-muted)">
              required
            </span>
          </label>

          <textarea
            id="nm_noteText"
            rows="4"
            placeholder="Enter your note about this candidate..."
          ></textarea>
        </div>

        <!-- Live Preview -->
        <div id="nm_previewSection" style="display:none;margin-bottom:16px">

          <div style="font-size:11px;font-weight:600;color:var(--text-muted);
                      text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px">
            Preview — Note to be sent to ATS
          </div>

          <div
            id="nm_preview"
            style="background:var(--surface-2);
                   border:1px solid var(--border);
                   border-radius:8px;
                   padding:12px;
                   font-size:13px;
                   min-height:44px;
                   line-height:1.5"
          >
          </div>

        </div>

        <!-- Submit button -->
        <button
          class="btn btn-primary btn-full"
          id="nm_submitBtn"
          disabled
        >
          📤 Push Note to ATS
        </button>

        <!-- Status message -->
        <div
          id="nm_statusMsg"
          style="margin-top:12px;display:none"
        ></div>

      </div>`;

    // Update modal footer with close button
    const footer = document.getElementById('modalFooter');

    if (footer) {
      footer.innerHTML = `
        <button
          class="btn btn-secondary"
          onclick="closeModal()"
        >
          Close
        </button>`;
    }

    attachModalListeners(context);
  }

  /* -----------------------------------------------------------
     attachModalListeners(context)
     All form interactivity for the modal version.
  ----------------------------------------------------------- */
  function attachModalListeners(context) {

    const actionSel =
      document.getElementById('nm_actionType');

    const alignSel =
      document.getElementById('nm_alignment');

    const noteTA =
      document.getElementById('nm_noteText');

    const alignGroup =
      document.getElementById('nm_alignGroup');

    const textGroup =
      document.getElementById('nm_textGroup');

    const previewSec =
      document.getElementById('nm_previewSection');

    const previewEl =
      document.getElementById('nm_preview');

    const submitBtn =
      document.getElementById('nm_submitBtn');

    const statusEl =
      document.getElementById('nm_statusMsg');


    /* ---------------------------------------------------------
       Helper: determine whether current action requires
       Candidate Alignment.

       Candidate Alignment is ONLY required for:
         Rec – Sense AI
    --------------------------------------------------------- */
    function requiresAlignment() {
      return actionSel.value === 'Rec – Sense AI';
    }


    /* ---------------------------------------------------------
       Helper: validate the form.

       Rules:

       All action types:
         - Action Type required
         - Note Text required

       Rec – Sense AI:
         - Candidate Alignment also required
    --------------------------------------------------------- */
    function isFormValid() {

      const action =
        actionSel.value;

      const note =
        noteTA.value.trim();

      // Action type and note are always required
      if (!action || !note) {
        return false;
      }

      // Alignment is required ONLY for Rec – Sense AI
      if (
        requiresAlignment() &&
        !alignSel.value
      ) {
        return false;
      }

      return true;
    }


    /* ---------------------------------------------------------
       Step 1: Action Type selected

       Rec – Sense AI:
         → Show Candidate Alignment
         → Note appears after Alignment is selected

       Other action types:
         → Hide Candidate Alignment
         → Clear any previous Alignment
         → Show Note immediately
    --------------------------------------------------------- */
    actionSel.onchange = () => {

      const isRecExAI =
        requiresAlignment();


      if (isRecExAI) {

        // Rec – Sense AI requires Candidate Alignment
        alignGroup.style.display = '';

        // Note is shown only after alignment is selected
        textGroup.style.display =
          alignSel.value ? '' : 'none';

      } else {

        // All other action types do NOT use Alignment
        alignGroup.style.display = 'none';

        // Clear any previous alignment selection
        alignSel.value = '';

        // For other action types the Note appears immediately
        textGroup.style.display =
          actionSel.value ? '' : 'none';
      }


      // If no action is selected, reset everything
      if (!actionSel.value) {

        alignSel.value = '';
        noteTA.value = '';

        alignGroup.style.display = 'none';
        textGroup.style.display = 'none';
        previewSec.style.display = 'none';

      }


      updatePreview();

      submitBtn.disabled =
        !isFormValid();
    };


    /* ---------------------------------------------------------
       Step 2: Alignment selected

       This event matters only for Rec – Sense AI.

       For other action types the Alignment field is hidden
       and therefore this event has no practical effect.
    --------------------------------------------------------- */
    alignSel.onchange = () => {

      if (requiresAlignment()) {

        // Show Note once Alignment has been selected
        textGroup.style.display =
          alignSel.value ? '' : 'none';

      }

      updatePreview();

      submitBtn.disabled =
        !isFormValid();
    };


    /* ---------------------------------------------------------
       Step 3: Note text input

       Update preview and validate the form.
    --------------------------------------------------------- */
    noteTA.oninput = () => {

      updatePreview();

      submitBtn.disabled =
        !isFormValid();
    };


    /* ---------------------------------------------------------
       Live preview updater

       Rec – Sense AI:
         Alignment – Note

       Other action types:
         Note only
    --------------------------------------------------------- */
    function updatePreview() {

      const action =
        actionSel.value;

      const align =
        alignSel.value;

      const text =
        noteTA.value.trim();


      // No action selected
      if (!action) {

        previewSec.style.display = 'none';

        return;
      }


      /* -------------------------------------------------------
         Rec – Sense AI

         Preview:
           Candidate Aligns with the Role – Note
      ------------------------------------------------------- */
      if (action === 'Rec – Sense AI') {

        if (align && text) {

          previewEl.textContent =
            `${align} – ${text}`;

          previewSec.style.display = '';

        } else if (align) {

          previewEl.innerHTML = `
            <span style="color:var(--text-muted)">
              ${align} –
              <em>enter note above...</em>
            </span>`;

          previewSec.style.display = '';

        } else {

          previewSec.style.display = 'none';
        }

        return;
      }


      /* -------------------------------------------------------
         All other action types

         Preview:
           Note only
      ------------------------------------------------------- */
      if (text) {

        previewEl.textContent =
          text;

        previewSec.style.display = '';

      } else {

        previewEl.innerHTML = `
          <span style="color:var(--text-muted)">
            <em>Enter note above...</em>
          </span>`;

        previewSec.style.display = '';
      }
    }


    /* ---------------------------------------------------------
       Submit handler
    --------------------------------------------------------- */
    submitBtn.onclick = async () => {

      const noteText =
        noteTA.value.trim();


      // Final client-side validation
      if (!actionSel.value) {

        showStatus(
          statusEl,
          '⚠️ Note action type is required.',
          'warning'
        );

        return;
      }


      if (
        requiresAlignment() &&
        !alignSel.value
      ) {

        showStatus(
          statusEl,
          '⚠️ Candidate alignment is required for Rec – Sense AI.',
          'warning'
        );

        return;
      }


      if (!noteText) {

        showStatus(
          statusEl,
          '⚠️ Note text is required.',
          'warning'
        );

        return;
      }


      /* -------------------------------------------------------
         Build payload

         For Rec – Sense AI:
           candidateAlignment = selected alignment

         For all other action types:
           candidateAlignment = ''
      ------------------------------------------------------- */
      const payload = {

        jobId:
          document.getElementById('nm_jobId').value,

        candidateId:
          document.getElementById('nm_candidateId').value,

        candidateName:
          document.getElementById('nm_candidateName').value,

        noteActionType:
          actionSel.value,

        candidateAlignment:
          requiresAlignment()
            ? alignSel.value
            : '',

        noteText,
      };


      // Loading state
      submitBtn.disabled = true;

      submitBtn.textContent =
        '⏳ Sending to ATS...';

      statusEl.style.display = 'none';


      // [API-CONNECT]
      // Send note to server → ATS
      const result =
        await ApiService.writeNote(payload);


      if (result.success) {

        // ATS confirmed — show success
        showStatus(
          statusEl,
          '✅ Note successfully pushed to ATS and confirmed.',
          'success'
        );

        window.showToast(
          'Note pushed to ATS',
          'success'
        );


        // Reset form
        actionSel.value = '';
        alignSel.value = '';
        noteTA.value = '';

        alignGroup.style.display = 'none';
        textGroup.style.display = 'none';
        previewSec.style.display = 'none';

        submitBtn.disabled = true;

        submitBtn.textContent =
          '📤 Push Note to ATS';

        // Let the host page refresh its JobDiva notes without requiring a
        // browser reload. The callback is optional so this component remains
        // reusable from Job Detail and other pages.
        if (typeof onSuccess === 'function') {
          try {
            await onSuccess(payload);
          } catch (refreshError) {
            console.warn('[Notes] Note was created, but the host page could not refresh notes:', refreshError);
          }
        }


      } else if (result.queued) {

        showStatus(
          statusEl,
          '⚠️ ATS did not confirm. Note queued — retrying in 30 minutes.',
          'warning'
        );

        queueRetry(payload);

        submitBtn.disabled = false;

        submitBtn.textContent =
          '📤 Push Note to ATS';


      } else {

        showStatus(
          statusEl,
          `❌ Failed: ${
            result.error || 'Unknown error'
          }. Please try again.`,
          'error'
        );

        submitBtn.disabled = false;

        submitBtn.textContent =
          '📤 Push Note to ATS';
      }
    };
  }


  /* -----------------------------------------------------------
     queueRetry(payload)
     Queues a failed note and adds a bell notification.
     Retries after 30 minutes automatically.
  ----------------------------------------------------------- */
  function queueRetry(payload) {

    if (
      typeof window.addNotification === 'function'
    ) {

      window.addNotification(
        '⚠️ Note Writeback Queued',

        `Note for ${payload.candidateName} (Job: ${payload.jobId}) ` +
        `queued. Retrying in 30 minutes.`,

        'error'
      );
    }


    const entry = {
      payload,
      retryCount: 0
    };

    noteQueue.push(entry);


    setTimeout(async () => {

      const r =
        await ApiService.writeNote(payload);


      if (r.success) {

        window.addNotification &&
          window.addNotification(
            '✅ Note Retry Succeeded',

            `Note for ${payload.candidateName} pushed to ATS successfully.`,

            'success'
          );

        window.showToast(
          'Queued note sent to ATS',
          'success'
        );

      } else {

        window.addNotification &&
          window.addNotification(
            '❌ Note Writeback Failed',

            `Note for ${payload.candidateName} could not reach ATS. Please resend.`,

            'error'
          );
      }

    }, 30 * 60 * 1000); // 30 minutes
  }


  /* -----------------------------------------------------------
     showStatus(el, message, type)
  ----------------------------------------------------------- */
  function showStatus(
    el,
    message,
    type
  ) {

    if (!el) return;


    const colors = {

      success: {
        bg: '#d1fae5',
        color: '#065f46',
        border: '#a7f3d0'
      },

      error: {
        bg: '#fee2e2',
        color: '#991b1b',
        border: '#fca5a5'
      },

      warning: {
        bg: '#fef3c7',
        color: '#92400e',
        border: '#fcd34d'
      },

    };


    const s =
      colors[type] ||
      colors.error;


    el.style.display = '';


    el.innerHTML = `
      <div style="background:${s.bg};
                  color:${s.color};
                  border:1px solid ${s.border};
                  border-radius:8px;
                  padding:10px 14px;
                  font-size:13px;
                  line-height:1.5">

        ${message}

      </div>`;
  }


  return {
    renderInModal,
    getNoteQueue: () => noteQueue
  };

})();