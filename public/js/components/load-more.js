/* =============================================================
   LOAD MORE — load-more.js
   =============================================================
   Shared UI for cursor-paginated lists. Renders a footer
   ("Showing 25 of 312 · Load more") and auto-loads the next page
   when the footer scrolls into view, so users get infinite scroll
   with a button fallback.

   LoadMore.attach(host, { shown, total, hasMore, onMore })
     host    element the footer is rendered into (replaces old footer)
     onMore  async () => void   — must append the next page, then call
             attach() again with fresh numbers
   LoadMore.clear(host)         — remove footer + stop observing
   LoadMore.debounce(fn, ms)    — for search inputs that re-query the server
   ============================================================= */

const LoadMore = (() => {
  const observers = new WeakMap();

  function clear(host) {
    const obs = observers.get(host);
    if (obs) { obs.disconnect(); observers.delete(host); }
    host.querySelectorAll(':scope > .load-more-footer').forEach(el => el.remove());
  }

  function attach(host, { shown, total, hasMore, onMore }) {
    clear(host);
    if (!hasMore && (total == null || shown >= total)) return;

    const footer = document.createElement('div');
    footer.className = 'load-more-footer';
    footer.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:12px;padding:14px 0;font-size:12px;color:var(--text-muted)';
    footer.innerHTML = `
      <span>Showing ${shown}${total != null ? ` of ${total}` : ''}</span>
      ${hasMore ? '<button class="btn btn-secondary" type="button" style="font-size:12px;padding:6px 14px">Load more</button>' : ''}`;
    host.appendChild(footer);
    if (!hasMore) return;

    const button = footer.querySelector('button');
    let loading = false;
    const more = async () => {
      if (loading) return;
      loading = true;
      button.disabled = true;
      button.textContent = 'Loading…';
      try { await onMore(); } finally { loading = false; }
    };
    button.onclick = more;

    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) more();
      }, { rootMargin: '300px' });
      obs.observe(footer);
      observers.set(host, obs);
    }
  }

  function debounce(fn, ms = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  return { attach, clear, debounce };
})();
