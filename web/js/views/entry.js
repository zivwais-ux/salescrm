/* ============================================================================
   הזנת חודש.

   הדוח מגיע פעם בתקופה, והחודש שאחריו נמצא רק אצל מי שמכר אותו. המסך הזה
   הוא המקום להקליד אותו: בוחרים חודש, ומקבלים רשימה של הלקוחות עם מה שהם
   קנו באותו חודש אשתקד ובחודש שעבר — כך שכל שורה נכנסת מול הקשר ולא לתוך
   שדה ריק. הכול נשמר בפעולה אחת, ומאותו רגע החודש הוא חלק מהמערכת: התקופה
   מתרחבת, ההשוואות כוללות אותו, והוא יוצא לאקסל ככל חודש אחר.

   שני דברים שנשמרים כאן בקפדנות:
     • מה שהוקלד מסומן כידני לעד, כדי שמסך הנתונים יוכל להראות במה המערכת
       כבר שונה מהדוח המקורי.
     • הזנה יורשת את המשלם והסוכן מהתנועה האחרונה של אותו לקוח, אחרת אותו
       לקוח היה מתפצל לשתי שורות שלא מצטברות.
   ========================================================================== */
window.ViewEntry = (function () {
  const ui = {
    tab: "list",
    year: null,
    month: null,
    search: "",
    scope: "likely",
    paste: "",
    // טיוטה לכל חודש בנפרד, כדי שמעבר בין חודשים לא ימחק מה שהוקלד.
    drafts: new Map(),
  };

  const key = () => `${ui.year}|${ui.month}`;
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

  /** מה שהוקלד ועוד לא נשמר, מול מה שכבר רשום באותו חודש. */
  function pending() {
    const out = [];
    draft().forEach((raw, no) => {
      const value = Math.round(Fmt.parseAmount(raw) * 100) / 100;
      const current = Metrics.sum(Store.sales()
        .filter((s) => s.c === no && s.y === ui.year && s.m === ui.month).map((s) => s.a));
      if (Math.abs(value - current) > 0.005) out.push({ no, value, current });
    });
    return out;
  }

  /* ------------------------------------------------------------------ ציור */
  function periodBar() {
    const years = Store.years();
    const next = years[years.length - 1] + 1;
    const options = [...years, next];
    return `<div class="entry-period">
      <label class="field">
        <span>שנה</span>
        <select class="select" id="entry-year">
          ${options.map((y) => `<option ${y === ui.year ? "selected" : ""}>${y}</option>`)
            .join("")}
        </select>
      </label>
      <div class="seg month-seg" role="group" aria-label="חודש">
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
      </div>
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

  function pasteTab() {
    return UI.card("הדבקה מאקסל", {
      sub: "עמודה של לקוח (מספר או שם) ועמודה של סכום — מה שמעתיקים מגיליון",
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

    const list = candidates();
    const waiting = pending();
    const added = waiting.reduce((sum, r) => sum + (r.value - r.current), 0);
    const monthTotal = Metrics.sum(Store.sales()
      .filter((s) => s.y === ui.year && s.m === ui.month).map((s) => s.a)) + added;
    const lastYearTotal = Metrics.sum(Store.sales()
      .filter((s) => s.y === ui.year - 1 && s.m === ui.month).map((s) => s.a));
    const changePct = Metrics.change(monthTotal, lastYearTotal);

    root.innerHTML = `
      <section class="card">
        <header class="card-head">
          <div>
            <h3>הזנת מכירות · ${Fmt.month(ui.month)} ${ui.year}</h3>
            <div class="sub">${Store.years().includes(ui.year)
              ? "מה שיוזן נשמר לצד נתוני הדוח ומסומן כהזנה ידנית"
              : `${ui.year} אינה בדוחות — מה שיוזן יפתח אותה במערכת`}</div>
          </div>
          <div class="spacer no-mobile">
            <nav class="tabs">
              ${[["list", "רשימת לקוחות"], ["paste", "הדבקה מאקסל"]].map(([id, label]) => `
                <button data-tab="${id}" class="${ui.tab === id ? "is-active" : ""}">${
                  label}</button>`).join("")}
            </nav>
          </div>
        </header>
        <nav class="tabs only-mobile-flex">
          ${[["list", "רשימת לקוחות"], ["paste", "הדבקה מאקסל"]].map(([id, label]) => `
            <button data-tab="${id}" class="${ui.tab === id ? "is-active" : ""}">${
              label}</button>`).join("")}
        </nav>
        <div class="card-body">${periodBar()}</div>
      </section>

      ${ui.tab === "paste" ? pasteTab() : UI.card("", {
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

      <div class="save-bar ${waiting.length ? "is-on" : ""}">
        <div class="save-facts">
          <b>${Fmt.number(waiting.length)}</b> שורות ממתינות לשמירה
          <span class="hint">· ${Fmt.signed(added)} · ${Fmt.month(ui.month)} יסתכם ב-${
            Fmt.money(monthTotal)}${lastYearTotal
              ? ` (${Fmt.percent(changePct, 1)} מול ${Fmt.money(lastYearTotal)} אשתקד)` : ""}</span>
        </div>
        <div class="row-actions">
          <button class="btn" id="entry-clear">ניקוי</button>
          <button class="btn btn-primary" id="entry-save">${
            UI.icon("check", 15)} שמירת ${Fmt.month(ui.month)}</button>
        </div>
      </div>`;

    /* ---------------------------------------------------------------- קשירה */
    root.querySelector("#entry-year").addEventListener("change", (e) => {
      ui.year = Number(e.target.value);
      render(root, ctx);
    });
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
    UI.on(root, "[data-no]", "keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const fields = [...root.querySelectorAll("[data-no]")];
      const next = fields[fields.indexOf(e.target) + 1];
      if (next) next.focus();
      else root.querySelector("#entry-save").focus();
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

    root.querySelector("#entry-clear").addEventListener("click", () => {
      if (!pending().length) return App.toast("אין מה לנקות");
      App.confirm({
        title: `לנקות את ההזנה של ${Fmt.month(ui.month)}?`,
        body: "מה שהוקלד ולא נשמר יימחק. נתונים שכבר נשמרו לא ייגעו.",
        danger: "ניקוי ההזנה",
        onConfirm() {
          clearDraft();
          render(root, ctx);
        },
      });
    });

    root.querySelector("#entry-save").addEventListener("click", () => save(root, ctx));

    const pasteBtn = root.querySelector("#paste-read");
    if (pasteBtn) {
      const box = root.querySelector("#paste-box");
      box.addEventListener("input", () => { ui.paste = box.value; });
      pasteBtn.addEventListener("click", () => showPaste(root, ctx, readPaste(box.value)));
    }
  }

  /** מרענן רק את סרגל השמירה, כדי שההקלדה לא תיקטע בציור מחדש. */
  function paintBar(root) {
    const bar = root.querySelector(".save-bar");
    if (!bar) return;
    const waiting = pending();
    const added = waiting.reduce((sum, r) => sum + (r.value - r.current), 0);
    bar.classList.toggle("is-on", waiting.length > 0);
    bar.querySelector(".save-facts").innerHTML = `
      <b>${Fmt.number(waiting.length)}</b> שורות ממתינות לשמירה
      <span class="hint">· ${Fmt.signed(added)}</span>`;
  }

  function save(root, ctx) {
    const waiting = pending();
    if (!waiting.length) return App.toast("אין שינויים להזין", "down");
    const rows = waiting.map((row) => {
      const known = Store.lastKnown(row.no);
      return { c: row.no, p: known.payer, agent: known.agent, a: row.value };
    });
    Store.setMonth(ui.year, ui.month, rows);
    clearDraft();
    App.toast(`${Fmt.month(ui.month)} ${ui.year} נשמר · ${waiting.length} לקוחות`,
              "up", { undo: true });
    render(root, ctx);
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
