/* ============================================================================
   הזנת חודש.

   הדוח מגיע פעם בתקופה, והחודש שאחריו נמצא רק אצל מי שמכר אותו. המסך הזה
   הוא המקום להקליד אותו: בוחרים חודש, ומקבלים רשימה של הלקוחות עם מה שהם
   קנו באותו חודש אשתקד ובחודש שעבר — כך שכל שורה נכנסת מול הקשר ולא לתוך
   שדה ריק. הכול נשמר בפעולה אחת, ומאותו רגע החודש הוא חלק מהמערכת: התקופה
   מתרחבת, ההשוואות כוללות אותו, והוא יוצא לאקסל ככל חודש אחר.

   הדרך הקצרה ביותר היא "מקובץ": מייצאים את החודש מה-ERP, גוררים את הקובץ
   פנימה או מדביקים את הטבלה, ורואים בדיוק מה ייכנס לפני שמאשרים. אין מה
   להתאים ידנית — העמודות מזוהות לפי הכותרות שלהן והחודש נקרא מתוך הטבלה.

   שני דברים שנשמרים כאן בקפדנות:
     • מה שהוקלד מסומן כידני לעד, כדי שמסך הנתונים יוכל להראות במה המערכת
       כבר שונה מהדוח המקורי.
     • הזנה יורשת את המשלם והסוכן מהתנועה האחרונה של אותו לקוח, אחרת אותו
       לקוח היה מתפצל לשתי שורות שלא מצטברות.
   ========================================================================== */
window.ViewEntry = (function () {
  const ui = {
    // ארבע דרכים להזין את אותם נתונים, לפי מה שיש ביד: קובץ או טבלה שהודבקה,
    // חודש שלם של לקוחות, לקוח אחד לאורך שנה, או יעדי השנה. הקובץ ראשון כי
    // הוא הדרך שאינה דורשת הקלדה בכלל.
    mode: "file",
    customer: null,
    tab: "list",
    year: null,
    month: null,
    search: "",
    scope: "likely",
    paste: "",
    // התוכנית שנקראה מקובץ או מהדבקה, לפני שאושרה.
    plan: null,
    planFrom: "",
    reading: false,
    error: "",
    // טיוטה לכל חודש בנפרד, כדי שמעבר בין חודשים לא ימחק מה שהוקלד.
    drafts: new Map(),
  };

  // טיוטה נפרדת לכל מה שנערך: חודש, לקוח-בשנה, או יעדי שנה.
  const key = () => (ui.mode === "file" ? "file"
    : ui.mode === "customer" ? `c${ui.customer}|${ui.year}`
    : ui.mode === "targets" ? `t|${ui.year}`
    : `${ui.year}|${ui.month}`);
  const DRAFT_KEY = "beny_entry_draft_v1";

  /**
   * הטיוטה שורדת סגירת דפדפן.
   *
   * הזנה של חודש היא ארבעים שורות הקלדה; אם לשונית שנסגרה באמצע מוחקת אותן,
   * המסך הזה לא שווה כלום. היא נשמרת בנפרד מהנתונים, ונמחקת ברגע שנשמרה.
   */
  function loadDrafts() {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
      Object.entries(raw).forEach(([period, rows]) => {
        ui.drafts.set(period, new Map(Object.entries(rows)));
      });
    } catch (err) { /* אחסון חסום — עובדים בלעדיו */ }
  }

  function saveDrafts() {
    const out = {};
    ui.drafts.forEach((rows, period) => {
      if (rows.size) out[period] = Object.fromEntries(rows);
    });
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(out)); }
    catch (err) { /* אחסון חסום — עובדים בלעדיו */ }
  }

  function draft() {
    if (!ui.drafts.has(key())) ui.drafts.set(key(), new Map());
    return ui.drafts.get(key());
  }

  function setDraft(no, value) {
    draft().set(no, value);
    saveDrafts();
  }

  function clearDraft() {
    ui.drafts.delete(key());
    saveDrafts();
  }

  /** החודש שאחרי האחרון שיש בו נתונים — מה שסביר שמזינים עכשיו. */
  function defaultPeriod() {
    const years = Store.years();
    const year = years[years.length - 1];
    const last = Store.closedMonth(year);
    return last >= 12 ? { year: year + 1, month: 1 } : { year, month: last + 1 };
  }

  /** כל מה שצריך לדעת על לקוח בחודש הנבחר. */
  function candidates() {
    const book = Metrics.catalog();
    const sales = Store.sales();
    const prevMonth = ui.month === 1 ? 12 : ui.month - 1;
    const prevMonthYear = ui.month === 1 ? ui.year - 1 : ui.year;

    const now = new Map();
    const rowsFor = new Map();
    const lastYear = new Map();
    const before = new Map();
    const recent = new Map();

    sales.forEach((s) => {
      if (s.y === ui.year && s.m === ui.month) {
        now.set(s.c, (now.get(s.c) || 0) + s.a);
        rowsFor.set(s.c, (rowsFor.get(s.c) || 0) + 1);
      }
      if (s.y === ui.year - 1 && s.m === ui.month) {
        lastYear.set(s.c, (lastYear.get(s.c) || 0) + s.a);
      }
      if (s.y === prevMonthYear && s.m === prevMonth) {
        before.set(s.c, (before.get(s.c) || 0) + s.a);
      }
      // פעילות בשנה האחרונה — הבסיס למיון וללקוחות ש"סביר שיקנו".
      const age = (ui.year - s.y) * 12 + (ui.month - s.m);
      if (age > 0 && age <= 12) recent.set(s.c, (recent.get(s.c) || 0) + s.a);
    });

    const list = Store.parties()
      .filter((p) => book.shipTo.has(p.no) || now.has(p.no) || draft().has(p.no))
      .map((p) => ({
        no: p.no,
        name: p.name,
        isBucket: book.buckets.has(p.no),
        current: now.get(p.no) || 0,
        rows: rowsFor.get(p.no) || 0,
        lastYear: lastYear.get(p.no) || 0,
        before: before.get(p.no) || 0,
        recent: recent.get(p.no) || 0,
      }));

    const term = ui.search.trim().toLowerCase();
    const scoped = list.filter((c) => {
      if (term) return c.name.toLowerCase().includes(term) || c.no.includes(term);
      if (ui.scope === "all") return true;
      if (ui.scope === "filled") return c.current > 0 || draft().has(c.no);
      // "סביר": מי שקנה בחודש המקביל אשתקד, בחודש שעבר, או כבר הוזן עכשיו.
      return c.lastYear > 0 || c.before > 0 || c.current > 0 || draft().has(c.no);
    });

    return scoped.sort((a, b) => (b.lastYear + b.before) - (a.lastYear + a.before)
      || b.recent - a.recent || a.name.localeCompare(b.name, "he"));
  }

  /** מה שהוקלד ועוד לא נשמר, מול מה שכבר רשום. */
  function pending() {
    const out = [];
    draft().forEach((raw, id) => {
      const value = Math.round(Fmt.parseAmount(raw) * 100) / 100;
      const current = ui.mode === "customer" ? monthOf(ui.customer, ui.year, Number(id))
        : ui.mode === "targets" ? Store.target(id, ui.year)
        : monthOf(id, ui.year, ui.month);
      if (Math.abs(value - current) > 0.005) out.push({ no: id, value, current });
    });
    return out;
  }

  /** כמה רשום ללקוח באותו חודש, על פני כל המשלמים והסוכנים שלו. */
  function monthOf(customerNo, year, month) {
    return Metrics.sum(Store.sales()
      .filter((s) => s.c === customerNo && s.y === year && s.m === month).map((s) => s.a));
  }

  function modeTitle() {
    if (ui.mode === "customer") {
      return `הזנה לפי לקוח · ${ui.customer ? Fmt.escape(Store.partyName(ui.customer))
        : "בחירת לקוח"} · ${ui.year}`;
    }
    if (ui.mode === "file") return "עדכון מקובץ";
    if (ui.mode === "targets") return `יעדים שנתיים · ${ui.year}`;
    return `הזנת מכירות · ${Fmt.month(ui.month)} ${ui.year}`;
  }

  /* ------------------------------------------------------------------ ציור */
  function monthStrip() {
    return `<div class="seg month-seg" role="group" aria-label="חודש">
      ${Fmt.SHORT.map((label, i) => {
        const month = i + 1;
        const has = Store.sales().some((s) => s.y === ui.year && s.m === month && s.a);
        const open = (ui.drafts.get(`${ui.year}|${month}`) || new Map()).size > 0;
        return `<button data-month="${month}" class="${month === ui.month ? "is-active" : ""}"
                        title="${Fmt.month(month)}${has ? " · יש נתונים" : ""}${
                          open ? " · טיוטה שלא נשמרה" : ""}">
          ${label}${has || open
            ? `<i class="month-dot ${open ? "is-draft" : ""}"></i>` : ""}</button>`;
      }).join("")}
    </div>`;
  }

  function periodBar() {
    const years = Store.years();
    const next = years[years.length - 1] + 1;
    const options = [...years, next];
    const yearField = `<label class="field">
        <span>שנה</span>
        <select class="select" id="entry-year">
          ${options.map((y) => `<option ${y === ui.year ? "selected" : ""}>${y}</option>`)
            .join("")}
        </select>
      </label>`;

    // בקובץ החודש נקרא מתוך הטבלה עצמה, ולכן אין כאן מה לבחור. רשת הביטחון
    // לטבלה בלי עמודת חודש יושבת ליד אזור הגרירה, בשורה קטנה, ולא ככותרת
    // המסך: מי שגורר קובץ תקין לא אמור לפגוש שלב שאין לו בו החלטה.
    if (ui.mode === "file") return "";

    if (ui.mode !== "month") {
      return `<div class="entry-period">
        <label class="field">
          <span>שנה</span>
          <select class="select" id="entry-year">
            ${options.map((y) => `<option ${y === ui.year ? "selected" : ""}>${y}</option>`)
              .join("")}
          </select>
        </label>
        ${ui.mode === "customer" ? `
          <button class="btn" id="entry-pick">${UI.icon("customers", 15)}
            <span class="ellipsis" style="max-width:220px">${ui.customer
              ? Fmt.escape(Store.partyName(ui.customer)) : "בחירת לקוח"}</span></button>
          ${ui.customer ? `<span class="hint">מספר ${Fmt.escape(ui.customer)}</span>` : ""}`
          : `<span class="hint">יעד שנתי לכל לקוח — ההשוואה מולו מופיעה בלוח הבקרה
             ובכרטיס הלקוח</span>`}
      </div>`;
    }
    return `<div class="entry-period">
      ${yearField}
      ${monthStrip()}
    </div>`;
  }

  function listRow(c) {
    const typed = draft().has(c.no) ? draft().get(c.no) : "";
    const value = typed !== "" ? Math.round(Fmt.parseAmount(typed) * 100) / 100 : null;
    const changed = value !== null && Math.abs(value - c.current) > 0.005;
    const split = c.rows > 1;
    // בטלפון נשאר רק המספר שבאמת עוזר להקליד — אותו חודש אשתקד.
    const hint = c.lastYear || c.before
      ? `<span>${c.lastYear
          ? `${Fmt.monthShort(ui.month)} ${ui.year - 1}: ${Fmt.money(c.lastYear)}` : "אשתקד —"}</span>${
          c.before ? `<span class="no-mobile"> · חודש קודם: ${Fmt.money(c.before)}</span>` : ""}`
      : "<span>אין תנועה קודמת להשוואה</span>";

    return `<div class="entry-row ${changed ? "is-changed" : ""} ${
      c.current ? "is-filled" : ""}">
      ${UI.avatar(c.name)}
      <div class="grow">
        <div class="entry-name ellipsis">${Fmt.escape(c.name)}${
          c.isBucket ? ' <span class="badge warn">סל מרוכז</span>' : ""}</div>
        <div class="entry-hint ellipsis">${hint}</div>
      </div>
      ${split ? `<div class="entry-split hint">מפוצל בין ${c.rows} שורות ·
          <button class="btn btn-sm" data-goto-grid="${Fmt.escape(c.no)}">בטבלת החודשים</button>
        </div>`
        : `<label class="entry-field">
            <input class="input num" inputmode="decimal" data-no="${Fmt.escape(c.no)}"
                   value="${Fmt.escape(typed !== "" ? typed
                     : (c.current ? Fmt.number(c.current) : ""))}"
                   data-raw="${c.current || ""}"
                   placeholder="0" aria-label="${Fmt.escape(c.name)}">
            ${c.current ? `<span class="entry-was">רשום: ${Fmt.money(c.current)}</span>` : ""}
          </label>`}
    </div>`;
  }

  /** לקוח אחד, שנים-עשר חודשים. */
  function customerBody() {
    if (!ui.customer) {
      return UI.card("", { body: UI.empty("צריך לבחור לקוח",
        "בוחרים לקוח, ומקלידים את שנים-עשר החודשים שלו בבת אחת.", "customers") });
    }
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const current = months.map((m) => monthOf(ui.customer, ui.year, m));
    const prior = months.map((m) => monthOf(ui.customer, ui.year - 1, m));
    const typedTotal = months.reduce((sum, m) => {
      const raw = draft().get(String(m));
      return sum + (raw !== undefined ? Math.round(Fmt.parseAmount(raw) * 100) / 100
                                      : current[m - 1]);
    }, 0);
    const priorTotal = Metrics.sum(prior);

    return UI.card("", {
      flush: true,
      body: `
        <div class="toolbar">
          <span class="hint">${Fmt.money(typedTotal)} ב-${ui.year}${priorTotal
            ? ` · ${Fmt.money(priorTotal)} ב-${ui.year - 1} · ${
                Fmt.percent(Metrics.change(typedTotal, priorTotal), 1)}` : ""}</span>
          <div class="spacer row-actions">
            <button class="btn btn-sm" id="entry-open-card">${
              UI.icon("file", 15)} כרטיס הלקוח</button>
          </div>
        </div>
        <div class="entry-list">
          ${months.map((m) => {
            const typed = draft().has(String(m)) ? draft().get(String(m)) : "";
            const value = typed !== "" ? Math.round(Fmt.parseAmount(typed) * 100) / 100 : null;
            const changed = value !== null && Math.abs(value - current[m - 1]) > 0.005;
            return `<div class="entry-row ${changed ? "is-changed" : ""}">
              <div class="grow">
                <div class="entry-name">${Fmt.month(m)} ${ui.year}</div>
                <div class="entry-hint">${prior[m - 1]
                  ? `${Fmt.monthShort(m)} ${ui.year - 1}: ${Fmt.money(prior[m - 1])}`
                  : `אין תנועה ב-${Fmt.monthShort(m)} ${ui.year - 1}`}</div>
              </div>
              <label class="entry-field">
                <input class="input num" inputmode="decimal" data-no="${m}"
                       value="${Fmt.escape(typed !== "" ? typed
                         : (current[m - 1] ? Fmt.number(current[m - 1]) : ""))}"
                       data-raw="${current[m - 1] || ""}"
                       placeholder="0" aria-label="${Fmt.month(m)}">
              </label>
            </div>`;
          }).join("")}
        </div>`,
    });
  }

  /** יעד שנתי לכל לקוח. */
  function targetsBody() {
    const book = Metrics.catalog();
    const sold = new Map();
    const soldPrior = new Map();
    Store.sales().forEach((s) => {
      if (s.y === ui.year) sold.set(s.c, (sold.get(s.c) || 0) + s.a);
      if (s.y === ui.year - 1) soldPrior.set(s.c, (soldPrior.get(s.c) || 0) + s.a);
    });
    const term = ui.search.trim().toLowerCase();
    const list = Store.parties()
      .filter((p) => book.shipTo.has(p.no) && !book.buckets.has(p.no))
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.no.includes(term))
      .map((p) => ({ no: p.no, name: p.name, target: Store.target(p.no, ui.year),
                     sold: sold.get(p.no) || 0, prior: soldPrior.get(p.no) || 0 }))
      .filter((c) => ui.scope !== "filled" || c.target || draft().has(c.no))
      .sort((a, b) => (b.target || b.prior) - (a.target || a.prior) || b.sold - a.sold);

    const totalTarget = list.reduce((sum, c) => {
      const raw = draft().get(c.no);
      return sum + (raw !== undefined ? Math.round(Fmt.parseAmount(raw) * 100) / 100
                                      : c.target);
    }, 0);

    return UI.card("", {
      flush: true,
      body: `
        <div class="toolbar toolbar-wrap">
          <label class="search">
            ${UI.icon("search", 15)}
            <input class="input" type="search" id="entry-search"
                   placeholder="חיפוש לקוח" value="${Fmt.escape(ui.search)}">
          </label>
          <div class="seg">
            ${[["likely", "כל הלקוחות"], ["filled", "עם יעד"]].map(([id, label]) => `
              <button data-scope="${id}" class="${ui.scope === id ? "is-active" : ""}">${
                label}</button>`).join("")}
          </div>
          <div class="spacer row-actions">
            <span class="hint">סך היעדים: ${Fmt.money(totalTarget)}</span>
          </div>
        </div>
        <div class="entry-list">
          ${list.length ? list.map((c) => {
            const typed = draft().has(c.no) ? draft().get(c.no) : "";
            const value = typed !== "" ? Math.round(Fmt.parseAmount(typed) * 100) / 100 : null;
            const changed = value !== null && Math.abs(value - c.target) > 0.005;
            const target = value !== null ? value : c.target;
            return `<div class="entry-row ${changed ? "is-changed" : ""}">
              ${UI.avatar(c.name)}
              <div class="grow">
                <div class="entry-name ellipsis">${Fmt.escape(c.name)}</div>
                <div class="entry-hint ellipsis">מכר ${Fmt.money(c.sold)} ב-${ui.year}${
                  c.prior ? ` · ${Fmt.money(c.prior)} ב-${ui.year - 1}` : ""}${
                  target ? ` · ${((c.sold / target) * 100).toFixed(0)}% מהיעד` : ""}</div>
              </div>
              <label class="entry-field">
                <input class="input num" inputmode="decimal" data-no="${Fmt.escape(c.no)}"
                       value="${Fmt.escape(typed !== "" ? typed
                         : (c.target ? Fmt.number(c.target) : ""))}"
                       data-raw="${c.target || ""}"
                       placeholder="ללא יעד" aria-label="${Fmt.escape(c.name)}">
              </label>
            </div>`;
          }).join("") : UI.empty("אין לקוחות בסינון הזה", "", "search")}
        </div>`,
    });
  }

  /* ------------------------------------------------------------- מקובץ
     מסך אחד לכל הדרך: גוררים או מדביקים, רואים בדיוק מה ייכנס ובמה זה שונה
     ממה שרשום היום, ומאשרים. אין מיפוי עמודות ואין שלבים — מה שיוצא מה-ERP
     נכנס כמו שהוא. */

  const isPhone = () => window.innerWidth <= 1000;

  function dropCard() {
    const years = Store.years();
    const options = [...years, years[years.length - 1] + 1];
    return UI.card("", {
      body: `
        <div class="dropzone" id="drop-zone">
          <div class="drop-icon">${UI.icon("upload", 26)}</div>
          <b class="drop-title">${isPhone() ? "העלאת הקובץ מה-ERP"
            : "גררו לכאן את הקובץ מה-ERP"}</b>
          <div class="drop-sub">${isPhone()
            ? "או הדביקו את הטבלה בתיבה שלמטה"
            : `או הדביקו את הטבלה מאקסל —
               <kbd>Ctrl</kbd>+<kbd>V</kbd> בכל מקום במסך`}</div>
          <div class="row-actions drop-actions">
            <button class="btn btn-primary" id="file-pick">${
              UI.icon("file", 15)} בחירת קובץ מהמחשב</button>
          </div>
          <div class="drop-note hint">xlsx או csv · העמודות מזוהות לפי הכותרות
            שלהן, והחודש נקרא מתוך הטבלה</div>
          <input type="file" id="file-input" class="visually-hidden"
                 accept=".xlsx,.xlsm,.csv,.txt,.tsv">
        </div>
        <div class="drop-fallback hint">
          החודש נקרא מתוך הטבלה. אם אין בה עמודת חודש, השורות ייכנסו ל־
          <select class="select select-sm" id="entry-month" aria-label="חודש ברירת מחדל">
            ${Fmt.MONTHS.map((name, i) => `<option value="${i + 1}" ${
              i + 1 === ui.month ? "selected" : ""}>${name}</option>`).join("")}
          </select>
          <select class="select select-sm" id="entry-year" aria-label="שנת ברירת מחדל">
            ${options.map((y) => `<option ${y === ui.year ? "selected" : ""}>${y}</option>`)
              .join("")}
          </select>
        </div>
        ${ui.error ? `<div class="notice down" style="margin-top:12px">${
          UI.icon("alert", 15)} ${Fmt.escape(ui.error)}</div>` : ""}
        <details class="drop-paste" ${isPhone() ? "open" : ""}>
          <summary>אפשר גם להדביק כאן</summary>
          <textarea id="drop-paste-box" style="min-height:140px;font-family:inherit"
            placeholder="מדביקים את הטבלה כולה, עם שורת הכותרות">${
            Fmt.escape(ui.paste)}</textarea>
          <div class="row-actions" style="margin-top:10px">
            <button class="btn" id="drop-paste-read">${
              UI.icon("check", 15)} בדיקת הטבלה</button>
          </div>
        </details>`,
    });
  }

  /**
   * מה יזוז בפועל, לקוח אחר לקוח.
   *
   * "933,905 במקום 387,322" אומר שהחודש גדל, אבל לא אומר אצל מי. מי שמאשר
   * החלפה של חודש שלם רוצה לראות את השורות שזזות — ובמיוחד את מי שהיה ונעלם
   * מהקובץ, כי זו הטעות היקרה ביותר שאפשר לעשות כאן בלי לשים לב.
   */
  function changeBlock(planned) {
    const rows = planned.months.flatMap((m) => m.changes.map((c) => ({ ...c, month: m })));
    if (!rows.length) return "";
    const gone = rows.filter((c) => c.gone);
    const top = rows.slice(0, 10);

    return `<div class="plan-block">
      <div class="plan-block-head">מה ישתנה · ${Fmt.number(rows.length)} לקוחות${
        gone.length ? ` · ${Fmt.number(gone.length)} היו ברשום ואינם בקובץ` : ""}</div>
      <div class="list">
        ${top.map((c) => `
          <div class="list-row" data-customer="${Fmt.escape(c.no)}">
            ${UI.avatar(c.name)}
            <div class="grow">
              <div class="list-title ellipsis">${Fmt.escape(c.name)}</div>
              <div class="list-sub">${c.fresh ? "לקוח חדש בחודש הזה"
                : c.gone ? "היה רשום ואינו מופיע בקובץ"
                : `${Fmt.money(c.before)} ← ${Fmt.money(c.after)}`}</div>
            </div>
            <div class="list-value ${c.delta >= 0 ? "up" : "down"}">${Fmt.signed(c.delta)}</div>
          </div>`).join("")}
      </div>
      ${rows.length > top.length ? `<div class="hint" style="padding:10px 4px 0">
        ועוד ${Fmt.number(rows.length - top.length)} לקוחות בשינוי קטן יותר</div>` : ""}
    </div>`;
  }

  /** מה ייכנס, ובמה זה שונה ממה שרשום היום — לפני שמאשרים. */
  function planCard() {
    const p = ui.plan;
    const months = p.months;
    const wipes = months.filter((m) => m.currentRows > 0);

    const monthRows = months.map((m) => {
      const change = m.currentTotal ? Metrics.change(m.total, m.currentTotal) : null;
      return `<div class="list-row">
        <div class="grow">
          <div class="list-title">${Fmt.month(m.month)} ${m.year}</div>
          <div class="list-sub">${Fmt.number(m.rows.length)} שורות ·
            ${Fmt.number(m.customers)} לקוחות${m.currentRows
              ? ` · יחליף ${Fmt.number(m.currentRows)} שורות שרשומות היום`
              : " · חודש חדש במערכת"}</div>
        </div>
        <div class="list-value">
          ${Fmt.money(m.total)}
          ${m.currentTotal ? `<div class="hint">במקום ${Fmt.money(m.currentTotal)}</div>` : ""}
        </div>
        ${change === null ? "" : `<div style="min-width:74px;text-align:left">${
          UI.delta(change)}</div>`}
      </div>`;
    }).join("");

    const names = (list) => list.slice(0, 40)
      .map((x) => `<span class="chip">${Fmt.escape(x.name)}</span>`).join("")
      + (list.length > 40 ? `<span class="hint"> ועוד ${list.length - 40}</span>` : "");

    return UI.card("מה ייכנס למערכת", {
      sub: ui.planFrom,
      flush: true,
      body: `
        <div class="plan-head">
          <div class="plan-fact">
            <span class="hint">שורות בקובץ</span>
            <b>${Fmt.number(p.rowCount)}</b>
          </div>
          <div class="plan-fact">
            <span class="hint">סך המכירות בקובץ</span>
            <b>${Fmt.money(p.total)}</b>
          </div>
          <div class="plan-fact">
            <span class="hint">חודשים</span>
            <b>${months.map((m) => `${Fmt.monthShort(m.month)} ${m.year}`).join(", ") || "—"}</b>
          </div>
        </div>
        <div class="list">${monthRows}</div>
        ${wipes.length ? `<div class="notice" style="margin:0 16px 14px">
          ${UI.icon("alert", 15)} חודש שמגיע בקובץ מוחלף במלואו — הקובץ הוא התמונה
          המלאה שלו. אפשר לבטל בלחיצה אחת אחרי העדכון.</div>` : ""}
        ${changeBlock(p)}
        ${p.parties.length ? `<div class="plan-block">
          <div class="plan-block-head">${Fmt.number(p.parties.length)} לקוחות חדשים ייפתחו</div>
          <div class="chips">${names(p.parties)}</div>
        </div>` : ""}
        ${p.agents.length ? `<div class="plan-block">
          <div class="plan-block-head">${Fmt.number(p.agents.length)} סוכנים חדשים ייפתחו</div>
          <div class="chips">${names(p.agents)}</div>
        </div>` : ""}
        ${p.problems.length ? `<div class="plan-block">
          <div class="plan-block-head down">${Fmt.number(p.problems.length)} שורות לא ייכנסו</div>
          <div class="list">${p.problems.slice(0, 12).map((row) => `
            <div class="list-row">
              <div class="grow"><div class="list-sub ellipsis">${
                Fmt.escape(row.line.slice(0, 90))}</div></div>
              <span class="badge down">${Fmt.escape(row.why)}</span>
            </div>`).join("")}</div>
        </div>` : ""}
        <div class="plan-actions">
          <button class="btn btn-primary btn-lg" id="plan-apply" ${
            p.rowCount ? "" : "disabled"}>${UI.icon("check", 16)} עדכון המערכת</button>
          <button class="btn" id="plan-cancel">ביטול</button>
        </div>`,
    });
  }

  function fileBody() {
    if (ui.reading) {
      return UI.card("", { body: UI.empty("קורא את הקובץ…", "רגע אחד.", "file") });
    }
    return ui.plan ? planCard() : dropCard();
  }

  /** קורא קובץ או טקסט, ומציג את התוכנית. */
  async function read(root, ctx, source) {
    ui.reading = true;
    ui.error = "";
    render(root, ctx);
    const fallback = { year: ui.year, month: ui.month };
    try {
      const planned = typeof source === "string"
        ? Importer.fromText(source, fallback)
        : await Importer.fromFile(source, fallback);
      ui.plan = planned.rowCount || planned.problems.length ? planned : null;
      ui.planFrom = typeof source === "string" ? "מטבלה שהודבקה" : source.name;
      if (!ui.plan) ui.error = "לא נמצאו שורות מכירה בקובץ. צריך עמודת לקוח ועמודת סכום.";
    } catch (err) {
      ui.plan = null;
      ui.error = err.message || "לא ניתן לקרוא את הקובץ";
    }
    ui.reading = false;
    render(root, ctx);
  }

  function applyPlan(root, ctx) {
    const p = ui.plan;
    const label = `ייבוא ${p.months.map((m) => `${Fmt.month(m.month)} ${m.year}`).join(", ")}`;
    Importer.apply(p, label);
    const total = Metrics.sum(p.months.map((m) => m.total));
    ui.plan = null;
    ui.paste = "";
    if (p.months.length) {
      ui.year = p.months[p.months.length - 1].year;
      ui.month = p.months[p.months.length - 1].month;
    }
    App.toast(`${label} · ${Fmt.number(p.rowCount)} שורות · ${Fmt.money(total)}`,
              "up", { undo: true });
    render(root, ctx);
  }

  /** גרירה, בחירת קובץ והדבקה — שלוש דרכים לאותו דבר. */
  function wireFile(root, ctx) {
    const zone = root.querySelector("#drop-zone");
    if (zone) {
      const input = root.querySelector("#file-input");
      root.querySelector("#file-pick").addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        if (input.files[0]) read(root, ctx, input.files[0]);
      });
      ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (e) => {
        e.preventDefault();
        zone.classList.add("is-over");
      }));
      ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (e) => {
        e.preventDefault();
        zone.classList.remove("is-over");
      }));
      zone.addEventListener("drop", (e) => {
        const file = e.dataTransfer.files[0];
        if (file) read(root, ctx, file);
        else {
          const text = e.dataTransfer.getData("text/plain");
          if (text) read(root, ctx, text);
        }
      });

      const box = root.querySelector("#drop-paste-box");
      box.addEventListener("input", () => { ui.paste = box.value; });
      root.querySelector("#drop-paste-read").addEventListener("click", () => {
        if (!box.value.trim()) return App.toast("אין מה לקרוא", "down");
        read(root, ctx, box.value);
      });
    }

    const apply = root.querySelector("#plan-apply");
    if (apply) {
      apply.addEventListener("click", () => applyPlan(root, ctx));
      root.querySelector("#plan-cancel").addEventListener("click", () => {
        ui.plan = null;
        render(root, ctx);
      });
    }

    // הדבקה בכל מקום במסך: מי שהעתיק טבלה מאקסל לא צריך למצוא לאן להדביק.
    if (pasteHandler) document.removeEventListener("paste", pasteHandler);
    pasteHandler = (e) => {
      if (!root.isConnected || ui.mode !== "file" || ui.plan || ui.reading) return;
      const target = e.target;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      const text = (e.clipboardData || window.clipboardData).getData("text");
      if (!text || !text.trim()) return;
      e.preventDefault();
      read(root, ctx, text);
    };
    document.addEventListener("paste", pasteHandler);
  }

  let pasteHandler = null;

  function pasteTab() {
    return UI.card("הדבקה מאקסל", {
      sub: "עמודה של לקוח (מספר או שם) ועמודה של סכום — מה שמעתיקים מגיליון",
      actions: `<nav class="tabs entry-tabs">
        ${[["list", "רשימה"], ["paste", "הדבקה"]].map(([id, label]) => `
          <button data-tab="${id}" class="${ui.tab === id ? "is-active" : ""}">${
            label}</button>`).join("")}
      </nav>`,
      body: `
        <textarea id="paste-box" style="min-height:190px;font-family:inherit"
          placeholder="202509263&#9;124500&#10;קרגל בע&quot;מ&#9;98,300&#10;202507723, 45000"
        >${Fmt.escape(ui.paste)}</textarea>
        <div class="row-actions" style="margin-top:12px">
          <button class="btn btn-primary" id="paste-read">${
            UI.icon("check", 15)} בדיקת השורות</button>
          <span class="hint">אפשר להפריד ב-Tab, בפסיק או בנקודה-פסיק</span>
        </div>
        <div id="paste-result" style="margin-top:14px"></div>`,
    });
  }

  /** מפענח טקסט שהודבק לשורות: מספר לקוח או שם, וסכום. */
  function readPaste(text) {
    const parties = Store.parties();
    const byNo = new Map(parties.map((p) => [p.no, p]));
    const norm = (s) => String(s).replace(/["'`״׳()\-]/g, "").replace(/\s+/g, " ")
      .trim().toLowerCase();
    const byName = new Map();
    parties.forEach((p) => {
      const n = norm(p.name);
      byName.set(n, byName.has(n) ? null : p);   // שם כפול אינו זיהוי
    });

    return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      .map((line) => {
        const parts = line.split(/\t|;|,(?=\s*[^\d])|\s{2,}/).map((x) => x.trim())
          .filter(Boolean);
        const amountText = parts.length > 1 ? parts[parts.length - 1] : "";
        const label = parts.slice(0, -1).join(" ").trim() || parts[0];
        const amount = Math.round(Fmt.parseAmount(amountText) * 100) / 100;
        const digits = (label.match(/\d[\d-]{5,}/) || [])[0];
        const party = (digits && byNo.get(digits))
          || byName.get(norm(label.replace(/\d[\d-]{5,}/, "")))
          || byName.get(norm(label));
        // שורה שלא זוהתה אבל יש בה מספר ושם היא לקוח חדש שאפשר לפתוח מכאן.
        const newName = digits ? label.replace(digits, "").replace(/[,;]/g, "").trim() : "";
        return { line, label, party, amount, digits, newName,
                 canCreate: !party && !!digits && !!amount,
                 problem: !party ? "לא זוהה לקוח" : !amount ? "אין סכום" : "" };
      });
  }

  let restored = false;

  function render(root, ctx) {
    if (!restored) {
      loadDrafts();
      restored = true;
    }
    if (!ui.year) Object.assign(ui, defaultPeriod());
    if (!Store.years().includes(ui.year) && ui.year !== Store.years().slice(-1)[0] + 1) {
      Object.assign(ui, defaultPeriod());
    }

    const list = ui.mode === "month" ? candidates() : [];
    const waiting = pending();

    root.innerHTML = `
      <section class="card">
        <header class="card-head">
          <div>
            <h3>${modeTitle()}</h3>
            <div class="sub">${ui.mode === "file"
              ? "הקובץ מה-ERP נכנס כמו שהוא — בלי הקלדה ובלי התאמות"
              : Store.years().includes(ui.year)
              ? "מה שיוזן נשמר לצד נתוני הדוח ומסומן כהזנה ידנית"
              : `${ui.year} אינה בדוחות — מה שיוזן יפתח אותה במערכת`}</div>
          </div>
          <div class="spacer">
            <div class="seg">
              <button data-mode="file" class="${ui.mode === "file" ? "is-active" : ""}">
                ${UI.icon("upload", 14)} מקובץ</button>
              <span class="seg-div" aria-hidden="true"></span>
              ${[["month", "לפי חודש"], ["customer", "לפי לקוח"], ["targets", "יעדים"]]
                .map(([id, label]) => `<button data-mode="${id}" class="${
                  ui.mode === id ? "is-active" : ""}">${label}</button>`).join("")}
            </div>
          </div>
        </header>
        ${periodBar() ? `<div class="card-body">${periodBar()}</div>` : ""}
      </section>

      ${ui.mode === "file" ? fileBody()
        : ui.mode === "customer" ? customerBody()
        : ui.mode === "targets" ? targetsBody()
        : ui.tab === "paste" ? pasteTab() : UI.card("", {
        flush: true,
        body: `
          <div class="toolbar toolbar-wrap">
            <label class="search">
              ${UI.icon("search", 15)}
              <input class="input" type="search" id="entry-search"
                     placeholder="חיפוש לקוח" value="${Fmt.escape(ui.search)}">
            </label>
            <div class="seg">
              ${[["likely", "סביר שיקנו"], ["filled", "הוזנו"], ["all", "כל הלקוחות"]]
                .map(([id, label]) => `<button data-scope="${id}" class="${
                  ui.scope === id ? "is-active" : ""}">${label}</button>`).join("")}
            </div>
            <div class="spacer row-actions">
              <nav class="tabs entry-tabs">
                ${[["list", "רשימה"], ["paste", "הדבקה"]].map(([id, label]) => `
                  <button data-tab="${id}" class="${ui.tab === id ? "is-active" : ""}">${
                    label}</button>`).join("")}
              </nav>
              <button class="btn" id="entry-new">${UI.icon("plus", 15)}
                <span class="no-mobile">לקוח חדש</span></button>
            </div>
          </div>
          <div class="entry-list">
            ${list.length ? list.map(listRow).join("")
              : UI.empty("אין לקוחות בסינון הזה",
                  "אפשר לעבור לתצוגת כל הלקוחות, או להוסיף לקוח חדש.", "search")}
          </div>`,
      })}

      ${ui.mode === "file" ? "" : `
      <div class="save-bar ${waiting.length ? "is-on" : ""}">
        <div class="save-facts">${barFacts(waiting)}</div>
        <div class="row-actions">
          <button class="btn" id="entry-clear">ניקוי</button>
          <button class="btn btn-primary" id="entry-save">${UI.icon("check", 15)} ${
            ui.mode === "targets" ? `שמירת יעדי ${ui.year}`
              : ui.mode === "customer" ? `שמירת ${ui.year}`
              : `שמירת ${Fmt.month(ui.month)}`}</button>
        </div>
      </div>`}`;

    /* ---------------------------------------------------------------- קשירה */
    UI.on(root, "[data-mode]", "click", (e) => {
      ui.mode = e.currentTarget.dataset.mode;
      if (ui.mode === "file") ui.error = "";
      if (ui.mode === "targets") ui.scope = "likely";
      if (ui.mode === "customer" && !ui.customer) {
        const top = Metrics.overview({ year: ui.year, agent: ctx.agent }).customers[0];
        ui.customer = top ? top.no : (Store.parties()[0] || {}).no;
      }
      render(root, ctx);
    });

    const pick = root.querySelector("#entry-pick");
    if (pick) {
      pick.addEventListener("click", () => App.pickCustomer((no) => {
        ui.customer = no;
        render(root, ctx);
      }));
    }

    const openCard = root.querySelector("#entry-open-card");
    if (openCard) openCard.addEventListener("click", () => App.openCustomer(ui.customer));

    const yearBox = root.querySelector("#entry-year");
    if (yearBox) {
      yearBox.addEventListener("change", (e) => {
        ui.year = Number(e.target.value);
        render(root, ctx);
      });
    }
    const monthBox = root.querySelector("#entry-month");
    if (monthBox) {
      monthBox.addEventListener("change", (e) => { ui.month = Number(e.target.value); });
    }
    UI.on(root, "[data-month]", "click", (e) => {
      ui.month = Number(e.currentTarget.dataset.month);
      render(root, ctx);
    });
    UI.on(root, "[data-tab]", "click", (e) => {
      ui.tab = e.currentTarget.dataset.tab;
      render(root, ctx);
    });
    UI.on(root, "[data-scope]", "click", (e) => {
      ui.scope = e.currentTarget.dataset.scope;
      render(root, ctx);
    });
    UI.on(root, "[data-goto-grid]", "click", () => App.go("grid"));

    const search = root.querySelector("#entry-search");
    if (search) {
      search.addEventListener("input", () => {
        ui.search = search.value;
        render(root, ctx);
        const box = root.querySelector("#entry-search");
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      });
    }

    // בכניסה לשדה מופיע הערך הגולמי, כך שאפשר להקליד עליו בלי למחוק פסיקים.
    UI.on(root, "[data-no]", "focus", (e) => {
      const raw = e.target.dataset.raw;
      if (raw && e.target.value === Fmt.number(Number(raw))) e.target.value = raw;
      e.target.select();
    });

    // הקלדה מעדכנת את הטיוטה בלבד; השמירה היא פעולה מפורשת אחת.
    UI.on(root, "[data-no]", "input", (e) => {
      setDraft(e.target.dataset.no, e.target.value);
      paintBar(root);
    });
    // ניווט בעמודת מספרים הוא אנכי: חצים למעלה ולמטה, Enter קדימה,
    // Shift+Enter אחורה. מי שמקליד ארבעים שורות לא אמור לגעת בעכבר.
    UI.on(root, "[data-no]", "keydown", (e) => {
      const step = e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey) ? 1
        : e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const fields = [...root.querySelectorAll("[data-no]")];
      const next = fields[fields.indexOf(e.target) + step];
      if (next) next.focus();
      else if (step > 0) root.querySelector("#entry-save").focus();
    });
    // ביציאה מהשדה המספר מוצג מסודר, וחשבון שהוקלד מוצג כתוצאה שלו.
    UI.on(root, "[data-no]", "blur", (e) => {
      const raw = e.target.value.trim();
      if (!raw) return;
      const value = Math.round(Fmt.parseAmount(raw) * 100) / 100;
      e.target.value = value ? Fmt.number(value) : "";
      setDraft(e.target.dataset.no, e.target.value);
      paintBar(root);
    });

    const newBtn = root.querySelector("#entry-new");
    if (newBtn) newBtn.addEventListener("click", () => addCustomer(root, ctx));

    wireFile(root, ctx);

    const clearBtn = root.querySelector("#entry-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      if (!pending().length) return App.toast("אין מה לנקות");
      App.confirm({
        title: `לנקות את ההזנה של ${ui.mode === "targets" ? `יעדי ${ui.year}`
          : ui.mode === "customer" ? `${Store.partyName(ui.customer)} ${ui.year}`
          : Fmt.month(ui.month)}?`,
        body: "מה שהוקלד ולא נשמר יימחק. נתונים שכבר נשמרו לא ייגעו.",
        danger: "ניקוי ההזנה",
        onConfirm() {
          clearDraft();
          render(root, ctx);
        },
      });
    });

    const saveBtn = root.querySelector("#entry-save");
    if (saveBtn) saveBtn.addEventListener("click", () => save(root, ctx));

    const pasteBtn = root.querySelector("#paste-read");
    if (pasteBtn) {
      const box = root.querySelector("#paste-box");
      box.addEventListener("input", () => { ui.paste = box.value; });
      pasteBtn.addEventListener("click", () => showPaste(root, ctx, readPaste(box.value)));
    }
  }

  /** מרענן רק את סרגל השמירה, כדי שההקלדה לא תיקטע בציור מחדש. */
  /**
   * מה בדיוק ממתין לשמירה.
   *
   * לא רק "כמה שורות": כמה מהן חדשות, כמה משנות מספר קיים, ומה החודש יסתכם
   * בו אם שומרים. זה מה שמאפשר לזהות טעות הקלדה לפני שהיא נשמרת, ולא אחריה.
   */
  function barFacts(waiting) {
    const added = waiting.reduce((sum, r) => sum + (r.value - r.current), 0);
    const fresh = waiting.filter((r) => !r.current).length;
    const edited = waiting.length - fresh;
    const base = ui.mode === "customer"
      ? Metrics.sum(Store.sales()
          .filter((s) => s.c === ui.customer && s.y === ui.year).map((s) => s.a))
      : Metrics.sum(Store.sales()
          .filter((s) => s.y === ui.year && s.m === ui.month).map((s) => s.a));
    const total = base + added;
    const lastYear = Metrics.sum(Store.sales()
      .filter((s) => s.y === ui.year - 1 && s.m === ui.month).map((s) => s.a));

    const parts = [];
    if (fresh) parts.push(`${Fmt.number(fresh)} חדשות`);
    if (edited) parts.push(`${Fmt.number(edited)} מתוקנות`);

    return `<b>${Fmt.number(waiting.length)}</b> שורות ממתינות לשמירה
      <span class="hint">${parts.length ? `· ${parts.join(" · ")} ` : ""}· ${
        Fmt.signed(added)}${ui.mode === "targets" ? ""
        : ` · ${ui.mode === "customer" ? ui.year : Fmt.month(ui.month)} יסתכם ב-${
            Fmt.money(total)}${lastYear && ui.mode !== "customer"
          ? ` (${Fmt.percent(Metrics.change(total, lastYear), 1)} מול אשתקד)` : ""}`}</span>`;
  }

  function paintBar(root) {
    const bar = root.querySelector(".save-bar");
    if (!bar) return;
    const waiting = pending();
    bar.classList.toggle("is-on", waiting.length > 0);
    bar.querySelector(".save-facts").innerHTML = barFacts(waiting);
  }

  function save(root, ctx) {
    const waiting = pending();
    if (!waiting.length) return App.toast("אין שינויים להזין", "down");

    if (ui.mode === "targets") {
      Store.setTargets(ui.year, waiting.map((row) => ({ no: row.no, value: row.value })));
      clearDraft();
      App.toast(`יעדי ${ui.year} נשמרו · ${waiting.length} לקוחות`, "up", { undo: true });
      return render(root, ctx);
    }

    if (ui.mode === "customer") {
      const months = {};
      waiting.forEach((row) => { months[row.no] = row.value; });
      Store.setCustomerYear(ui.customer, ui.year, months);
      clearDraft();
      App.toast(`${Store.partyName(ui.customer)} · ${ui.year} נשמר · ${
        waiting.length} חודשים`, "up", { undo: true });
      return render(root, ctx);
    }

    const rows = waiting.map((row) => {
      const known = Store.lastKnown(row.no);
      return { c: row.no, p: known.payer, agent: known.agent, a: row.value };
    });
    Store.setMonth(ui.year, ui.month, rows);
    clearDraft();
    App.toast(`${Fmt.month(ui.month)} ${ui.year} נשמר · ${waiting.length} לקוחות`,
              "up", { undo: true });
    return render(root, ctx);
  }

  function showPaste(root, ctx, parsed) {
    const box = root.querySelector("#paste-result");
    if (!parsed.length) {
      box.innerHTML = UI.empty("אין שורות לקרוא", "אפשר להדביק שתי עמודות מהגיליון.", "file");
      return;
    }
    const ok = parsed.filter((r) => !r.problem);
    const newOnes = parsed.filter((r) => r.canCreate);
    box.innerHTML = `
      ${Charts.table(["שורה", "לקוח", "סכום", "מצב"], parsed.map((r) => [
        Fmt.escape(r.line.slice(0, 40)),
        r.party ? Fmt.escape(r.party.name) : `<span class="hint">—</span>`,
        r.amount ? Fmt.money(r.amount) : `<span class="hint">—</span>`,
        r.problem ? `<span class="badge down">${r.problem}</span>`
                  : `<span class="badge up">${UI.icon("check", 12)} זוהה</span>`,
      ]))}
      <div class="row-actions" style="margin-top:12px">
        <button class="btn btn-primary" id="paste-apply" ${ok.length ? "" : "disabled"}>
          העברת ${ok.length} שורות לרשימה</button>
        ${newOnes.length ? `<button class="btn" id="paste-create">${UI.icon("plus", 15)}
          פתיחת ${newOnes.length} לקוחות חדשים</button>` : ""}
        <span class="hint">אפשר לבדוק אותן ברשימה לפני השמירה</span>
      </div>`;
    const create = box.querySelector("#paste-create");
    if (create) {
      create.addEventListener("click", () => {
        let added = 0;
        newOnes.forEach((r) => {
          if (Store.party(r.digits)) return;
          try {
            Store.addParty(r.digits, r.newName || r.digits);
            setDraft(r.digits, String(r.amount));
            added += 1;
          } catch (err) { /* מספר שכבר קיים — מדלגים */ }
        });
        App.toast(added ? `${added} לקוחות נפתחו והועברו לרשימה` : "לא נפתח לקוח חדש",
                  added ? "up" : "down", { undo: !!added });
        ui.tab = "list";
        ui.scope = "filled";
        render(root, ctx);
      });
    }

    const apply = box.querySelector("#paste-apply");
    if (apply) {
      apply.addEventListener("click", () => {
        ok.forEach((r) => setDraft(r.party.no, String(r.amount)));
        ui.tab = "list";
        ui.scope = "filled";
        App.toast(`${ok.length} שורות הועברו לרשימה — נשאר לשמור`, "up");
        render(root, ctx);
      });
    }
  }

  function addCustomer(root, ctx) {
    App.openDrawer({
      title: "לקוח חדש",
      sub: `יתווסף לרשימת ההזנה של ${Fmt.month(ui.month)} ${ui.year}`,
      body: UI.card("", {
        body: `
          <div class="form-grid">
            <label class="stacked"><span>מספר לקוח</span>
              <input class="input" id="e-no" inputmode="numeric"
                     placeholder="המספר כפי שהוא בדוח"></label>
            <label class="stacked"><span>שם הלקוח</span>
              <input class="input" id="e-name" placeholder="שם החברה"></label>
            <label class="stacked"><span>סכום ל${Fmt.month(ui.month)} (₪)</span>
              <input class="input" id="e-amount" inputmode="decimal"
                     placeholder="אפשר גם 1200+840"></label>
            <label class="stacked"><span>סוכן</span>
              <select class="select" id="e-agent">
                ${Store.state.agents.filter((a) => a.no).map((a) => `
                  <option value="${Fmt.escape(a.no)}" ${
                    a.no === (ctx.agent !== "all" ? ctx.agent : "") ? "selected" : ""
                  }>${Fmt.escape(a.name)}</option>`).join("")}
              </select></label>
          </div>
          <div class="row-actions" style="margin-top:14px">
            <button class="btn btn-primary" id="e-save">הוספה</button>
            <button class="btn" data-close-drawer>ביטול</button>
          </div>`,
      }),
      onReady(panel) {
        const add = () => {
          const no = panel.querySelector("#e-no").value.trim();
          const name = panel.querySelector("#e-name").value.trim();
          const amount = panel.querySelector("#e-amount").value.trim();
          try {
            if (!Store.party(no)) Store.addParty(no, name);
            else if (name) Store.renameParty(no, name);
          } catch (err) {
            return App.toast(err.message, "down");
          }
          if (amount) {
            Store.setMonth(ui.year, ui.month, [{
              c: no, p: no, agent: panel.querySelector("#e-agent").value, a: amount,
            }], `הוספת ${name || no} ל${Fmt.month(ui.month)}`);
          }
          App.closeDrawer();
          ui.scope = "filled";
          App.toast(`${name || no} נוסף`, "up", { undo: true });
          render(root, ctx);
        };
        panel.querySelector("#e-save").addEventListener("click", add);
        panel.querySelector("#e-no").focus();
      },
    });
  }

  return { render };
})();
