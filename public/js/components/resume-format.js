/* =============================================================
   RESUME FORMAT — resume-format.js
   =============================================================
   Turns a plain-text resume (as returned by the ATS) into readable
   HTML: name header, section headings, role rows with dates,
   bullet points, labelled skills, and a separate "Additional Info"
   block. Falls back to simple paragraphs when no structure is found.

   ResumeFormat.toHtml(text) -> HTML string (all text is escaped)
   ============================================================= */

const ResumeFormat = (() => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const DATE = String.raw`(?:${MONTH}\.?\s+)?\d{4}`;
  const ROLE_RE = new RegExp(String.raw`^(.*?)\s+((?:${MONTH}\.?\s+)?\d{4}\s*[–—-]\s*(?:Present|Current|Now|${DATE}))$`, 'i');
  const HEADING_RE = /^[A-Z][A-Z &/,'-]{2,40}$/;
  const END_RE = /^-{3,}\s*END OF RESUME\s*-{3,}$/i;
  const LABEL_RE = /^([A-Za-z][A-Za-z &/+.()'-]{1,40}):\s*(.*)$/;

  const S = {
    wrap: 'font-family:\'Segoe UI\',system-ui,-apple-system,Arial,sans-serif;font-size:14px;line-height:1.6;color:var(--text);background:var(--surface-2);padding:20px 24px;border-radius:8px;',
    name: 'font-size:20px;font-weight:700;margin:0 0 2px',
    contact: 'font-size:12.5px;color:var(--text-muted);margin:0 0 2px',
    heading: 'font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:4px;margin:20px 0 10px',
    role: 'display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap;margin:14px 0 0;font-weight:600',
    date: 'font-weight:400;font-size:12.5px;color:var(--text-muted);white-space:nowrap',
    org: 'font-size:13px;color:var(--text-muted);margin:1px 0 6px',
    para: 'margin:0 0 8px',
    list: 'margin:4px 0 0;padding-left:20px',
    item: 'margin:0 0 5px',
    label: 'font-weight:600',
  };

  function toHtml(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim());
    const endIdx = lines.findIndex(l => END_RE.test(l));
    const body = (endIdx >= 0 ? lines.slice(0, endIdx) : lines).filter(Boolean);
    const extra = (endIdx >= 0 ? lines.slice(endIdx + 1) : []).filter(Boolean);
    if (!body.length && !extra.length) return '';

    const hasHeadings = body.some(l => HEADING_RE.test(l));
    const out = [];
    let section = '';
    let list = null;          // open <ul> flag
    let afterRole = false;    // next line is the company / location line

    const closeList = () => { if (list) { out.push('</ul>'); list = null; } };

    body.forEach((line, i) => {
      if (i === 0 && hasHeadings && !HEADING_RE.test(line)) { out.push(`<div style="${S.name}">${esc(line)}</div>`); return; }
      if (i === 1 && hasHeadings && !section) { out.push(`<div style="${S.contact}">${esc(line)}</div>`); return; }
      if (hasHeadings && !section && !HEADING_RE.test(line)) { out.push(`<div style="${S.contact}">${esc(line)}</div>`); return; }

      if (HEADING_RE.test(line)) {
        closeList(); afterRole = false;
        section = line;
        out.push(`<div style="${S.heading}">${esc(line)}</div>`);
        return;
      }

      const role = ROLE_RE.exec(line);
      if (role && role[1] && line.length < 120) {
        closeList();
        out.push(`<div style="${S.role}"><span>${esc(role[1])}</span><span style="${S.date}">${esc(role[2])}</span></div>`);
        afterRole = true;
        return;
      }
      if (afterRole) {
        afterRole = false;
        out.push(`<div style="${S.org}">${esc(line)}</div>`);
        return;
      }

      const isSkills = /skill|technolog|tools/i.test(section);
      const label = LABEL_RE.exec(line);
      if (isSkills && label && label[2]) {
        closeList();
        out.push(`<p style="${S.para}"><span style="${S.label}">${esc(label[1])}:</span> ${esc(label[2])}</p>`);
        return;
      }

      if (/^(summary|objective|profile|education|certifications?)$/i.test(section) || !hasHeadings) {
        closeList();
        out.push(`<p style="${S.para}">${esc(line)}</p>`);
        return;
      }

      // Experience / projects: each remaining line is a bullet.
      if (!list) { out.push(`<ul style="${S.list}">`); list = true; }
      out.push(`<li style="${S.item}">${esc(line.replace(/^[•·▪◦*-]\s+/, ''))}</li>`);
    });
    closeList();

    if (extra.length) {
      out.push(`<div style="${S.heading}">Additional Info</div>`);
      extra.filter(l => !/^additional info:?$/i.test(l)).forEach(line => {
        const m = LABEL_RE.exec(line);
        if (m && !m[2]) out.push(`<div style="${S.label};margin:10px 0 2px">${esc(m[1])}</div>`);
        else if (m) out.push(`<p style="${S.para}"><span style="${S.label}">${esc(m[1])}:</span> ${esc(m[2])}</p>`);
        else out.push(`<p style="${S.para}">${esc(line)}</p>`);
      });
    }

    return `<div class="resume-formatted" style="${S.wrap}">${out.join('')}</div>`;
  }

  return { toHtml };
})();
