/* ============================================================================
   אבני הבניין של הממשק: אייקונים, יצירת אלמנטים, ורכיבים חוזרים.
   האייקונים מצוירים כ-SVG בקו אחיד (גריד 24, עובי 1.7) — לא אמוג'י — כדי
   שיתאימו לכל גודל ויקבלו את צבע הטקסט שסביבם.
   ========================================================================== */
window.UI = (function () {
  const PATHS = {
    dashboard: '<path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/>',
    customers: '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/>'
             + '<circle cx="10" cy="8" r="3.2"/><path d="M20 19v-1.4a3.5 3.5 0 0 0-2.6-3.4M15.5 5.2a3.2 3.2 0 0 1 0 5.9"/>',
    grid: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 9.5V19.5M14.5 9.5V19.5"/>',
    activity: '<path d="M8 5.5h9.5a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2H8Z"/>'
            + '<path d="M9 3.8h6v3H9zM8.5 12.5l2 2 4.5-4.5"/>',
    settings: '<path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/>'
            + '<path d="m19.2 14.1.9 1.6-2.3 2.3-1.6-.9a6.8 6.8 0 0 1-1.6.7l-.4 1.8h-3.3l-.4-1.8a6.8 6.8 0 0 1-1.6-.7l-1.6.9-2.3-2.3.9-1.6a6.8 6.8 0 0 1-.7-1.6L3.4 12V8.7l1.8-.4c.2-.6.4-1.1.7-1.6l-.9-1.6L7.3 2.8l1.6.9c.5-.3 1-.5 1.6-.7L10.9 1.2h3.3"/>',
    search: '<circle cx="11" cy="11" r="6.3"/><path d="m16 16 4 4"/>',
    download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/>',
    upload: '<path d="M12 20V9m0 0 4 4M12 9 8 13M5 5h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4"/>',
    moon: '<path d="M20 13.2A8.2 8.2 0 0 1 10.8 4a8.2 8.2 0 1 0 9.2 9.2Z"/>',
    alert: '<path d="M12 8.5v4.2M12 16.3h.01"/><circle cx="12" cy="12" r="8.3"/>',
    clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.4V12l3 1.8"/>',
    trendUp: '<path d="M4 16.5 10 10l3.5 3.5L20 7"/><path d="M15.5 7H20v4.5"/>',
    spark: '<path d="M12 3.5 13.8 9l5.7.2-4.5 3.5 1.6 5.5L12 15l-4.6 3.2L9 12.7 4.5 9.2 10.2 9 12 3.5Z"/>',
    users: '<circle cx="9" cy="8" r="3.3"/><path d="M3.8 19.2a5.2 5.2 0 0 1 10.4 0"/><path d="M16 11.2a3.3 3.3 0 0 0 0-6.4M17 19.2a5.2 5.2 0 0 0-2-4.1"/>',
    target: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1"/>',
    file: '<path d="M14 3.6H7.5a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.2L14 3.6Z"/><path d="M13.8 3.8V8.4h4.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    undo: '<path d="M4 9h11a5 5 0 0 1 0 10h-3"/><path d="M8 5 4 9l4 4"/>',
    trash: '<path d="M5 7h14M10 7V5.2A1.2 1.2 0 0 1 11.2 4h1.6A1.2 1.2 0 0 1 14 5.2V7m3 0v11.8a1.2 1.2 0 0 1-1.2 1.2H8.2A1.2 1.2 0 0 1 7 18.8V7"/>',
    phone: '<path d="M7.5 4.5h3l1.3 3.3-1.9 1.4a10.5 10.5 0 0 0 4.9 4.9l1.4-1.9 3.3 1.3v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 5.5 6.7a2 2 0 0 1 2-2.2Z"/>',
    mail: '<rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2"/><path d="m4.4 7 7.6 5.4L19.6 7"/>',
    note: '<path d="M6 4.5h12v15H6z"/><path d="M9 9h6M9 12.5h6M9 16h3"/>',
  };

  function icon(name, size = 17) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;
  }

  /**
   * אות פתיחה לשם הלקוח. בעברית אין מוסכמה של ראשי תיבות לשמות חברות,
   * ושתי אותיות ("הה", "גת") נקראות כרעש — אות אחת היא עוגן חזותי נקי.
   */
  function initials(name) {
    const word = String(name || "").replace(/["'()\u05f3\u05f4]/g, "").trim().split(/\s+/)[0];
    return (word || "?")[0];
  }

  /** צבע רקע יציב לראשי התיבות, נגזר מהשם עצמו. */
  function tint(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
    return `oklch(var(--tint-l, 0.93) 0.045 ${hash})`;
  }

  function avatar(name) {
    return `<div class="avatar" style="background:${tint(name)}" aria-hidden="true">${
      Fmt.escape(initials(name))}</div>`;
  }

  function delta(pct, { size = "" } = {}) {
    if (pct === null || pct === undefined || !isFinite(pct)) {
      return '<span class="badge accent">חדש</span>';
    }
    const dir = pct >= 0 ? "up" : "down";
    const arrow = pct >= 0
      ? '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5v-7M3 5.5 6 2.5l3 3"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5v7M3 6.5l3 3 3-3"/></svg>';
    return `<span class="delta ${dir} ${size}">${arrow}${Fmt.percent(pct, 1)}</span>`;
  }

  function empty(title, body, iconName = "spark") {
    return `<div class="empty">${icon(iconName, 30)}<strong>${Fmt.escape(title)}</strong>${
      body ? `<span>${Fmt.escape(body)}</span>` : ""}</div>`;
  }

  function card(title, { sub = "", actions = "", body = "", flush = false, id = "" } = {}) {
    return `<section class="card" ${id ? `id="${id}"` : ""}>
      ${title ? `<header class="card-head">
        <div><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
        ${actions ? `<div class="spacer row-actions">${actions}</div>` : ""}
      </header>` : ""}
      <div class="card-body ${flush ? "flush" : ""}">${body}</div>
    </section>`;
  }

  /** מאזין לאירוע על כל האלמנטים שתואמים לסלקטור. */
  function on(root, selector, event, handler) {
    root.querySelectorAll(selector).forEach((el) => el.addEventListener(event, handler));
  }

  return { icon, avatar, initials, tint, delta, empty, card, on, PATHS };
})();
