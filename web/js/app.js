/* ============================================================================
   מעטפת האפליקציה: ניווט, מצב נבחר (שנה/סוכן), כרטיס הלקוח, חיפוש מהיר
   והודעות. כל מסך מקבל את ה-root שלו ומצייר לתוכו.
   ========================================================================== */
window.App = (function () {
  const cfg = window.APP_CONFIG;
  const ctx = { year: null, agent: "all", view: "dashboard" };

  // שבעה מסכים, ארבעה מהם בסרגל התחתון בנייד. ה"תפריט" מחזיק את השאר.
  // `period` מסמן מסך שקורא את השנה הנבחרת — רק שם מוצג בורר השנה.
  const NAV = [
    { id: "dashboard", label: "בית", icon: "dashboard", view: () => ViewDashboard,
      title: "בית", tab: true, period: true },
    { id: "trend", label: "מגמה", icon: "trendUp", view: () => ViewTrend,
      title: "מגמה", tab: true, period: true },
    { id: "customers", label: "לקוחות", icon: "customers", view: () => ViewCustomers,
      title: "לקוחות", tab: true, period: true },
    { id: "entry", label: "הזנה", icon: "plus", view: () => ViewEntry,
      title: "הזנת מכירות", tab: true },
    { id: "activity", label: "משימות", icon: "activity", view: () => ViewActivity,
      title: "משימות" },
    { id: "grid", label: "טבלת חודשים", icon: "grid", view: () => ViewGrid,
      title: "טבלת חודשים", period: true },
    { id: "settings", label: "נתונים וקבצים", icon: "settings", view: () => ViewSettings,
      title: "נתונים וקבצים" },
  ];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  let openCustomerNo = null;
  let drawerTab = "overview";

  const reducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ ניווט
     כל מסך זוכר איפה היה. מי שגלל לתחתית רשימת הלקוחות, פתח כרטיס וחזר,
     מצפה לחזור למקום שבו היה — לא לראש הרשימה. */
  const scrollAt = new Map();

  function go(id) {
    if (!NAV.some((n) => n.id === id)) return;
    if (id === ctx.view) return closeSidebar();
    scrollAt.set(ctx.view, window.scrollY);
    ctx.view = id;
    closeSidebar();
    render({ transition: true, scroll: scrollAt.get(id) || 0 });
  }

  function counts() {
    const view = Metrics.overview(ctx);
    return {
      customers: view.active.length,
      activity: Store.state.activities.filter((a) => !a.done).length,
      dashboard: view.atRisk.length,
    };
  }

  // נקודת ההתראה בסרגל התחתון מסמנת רק דברים שדורשים פעולה. מספר הלקוחות
  // הפעילים אינו התראה, ונקודה אדומה לידו רק מלמדת להתעלם ממנה.
  const ALERTS = new Set(["dashboard", "activity"]);

  /* ------------------------------------------------------------- המעטפת
     סרגל הצד, הכותרת, סרגל ההקשר והסרגל התחתון נבנים פעם אחת בטעינה,
     והמאזינים יושבים על המכל ולא על הכפתורים. מכאן והלאה מתעדכן רק מה
     שבאמת השתנה — הפריט הפעיל, המונים, הכותרת.

     זה מה שמסיר את תחושת ה"קפיצה": בנייה מחדש של המעטפת בכל ניווט הבהבה
     את המסך, איבדה פוקוס, והשליכה את מיקום הגלילה. */
  function buildSidebar() {
    const side = $("#sidebar");
    side.innerHTML = `
      <div class="brand">
        <span class="wordmark" id="brand-name"></span>
        <span class="brand-sub" id="brand-sub"></span>
      </div>

      ${NAV.map((item) => `
        <button class="nav-item" data-nav="${item.id}">
          ${UI.icon(item.icon)}
          <span>${item.label}</span>
          <span class="nav-count" hidden></span>
        </button>`).join("")}

      <div class="sidebar-foot">
        <div class="nav-label" style="padding-top:0">תצוגה</div>
        <div class="seg theme-seg" role="group" aria-label="בהיר או כהה">
          ${[["auto", "אוטומטי"], ["light", "יום"], ["dark", "לילה"]].map(([key, label]) => `
            <button data-theme-set="${key}">${label}</button>`).join("")}
        </div>
        <button class="nav-item" id="export-btn">
          ${UI.icon("download")}<span>ייצוא לאקסל</span>
        </button>
      </div>`;

    side.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) return go(nav.dataset.nav);
      const theme = e.target.closest("[data-theme-set]");
      if (theme) return setTheme(theme.dataset.themeSet);
      if (e.target.closest("#export-btn")) exportExcel();
    });
  }

  function syncSidebar() {
    const n = counts();
    const settings = Store.settings();
    $("#brand-name").textContent = settings.name;
    $("#brand-sub").textContent = settings.branch;

    $$("#sidebar [data-nav]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.nav === ctx.view);
      const count = btn.querySelector(".nav-count");
      const value = n[btn.dataset.nav];
      count.hidden = !value;
      if (value) count.textContent = Fmt.number(value);
    });

    $$("#sidebar [data-theme-set]").forEach((btn) => {
      const on = btn.dataset.themeSet === themePref();
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }

  /**
   * סרגל ההקשר: השנה הנבחרת והסוכן.
   *
   * שתי הבחירות האלה משנות כל מספר שעל המסך, ולכן הן יושבות מעל התוכן ולא
   * בתוך תפריט צד שנסגר: בנייד זה ההבדל בין שתי נגיעות לחמש. עם חמש שנים
   * הבורר הוא טבעת אחת של כפתורים, ולא רשימה נפתחת שמסתירה את מה שיש בה.
   */
  // רשימת השנים והסוכנים משתנה רק כשהנתונים עצמם משתנים, ולכן הסרגל נבנה
  // מחדש רק אז — ובכל שאר הפעמים רק הבחירה מתעדכנת.
  let ctxSignature = "";

  function syncCtxbar() {
    const bar = $("#ctxbar");
    const item = NAV.find((n) => n.id === ctx.view);
    bar.hidden = !item.period;
    if (!item.period) return;

    const years = Store.years();
    const agents = [{ no: "all", name: "כל הסוכנים" }]
      .concat(Store.state.agents.filter((a) => a.no));
    const signature = `${years.join(",")}|${agents.map((a) => `${a.no}:${a.name}`).join(",")}`;

    if (signature !== ctxSignature) {
      ctxSignature = signature;
      bar.innerHTML = `
        <div class="seg year-seg" role="group" aria-label="שנה">
          ${years.slice().reverse().map((y) => `
            <button data-year="${y}">${y}</button>`).join("")}
        </div>
        <label class="field agent-field">
          <span class="no-mobile">סוכן</span>
          <select class="select" id="agent-select">
            ${agents.map((a) => `<option value="${Fmt.escape(a.no)}">${
              Fmt.escape(a.name)}</option>`).join("")}
          </select>
        </label>`;

      bar.addEventListener("click", (e) => {
        const year = e.target.closest("[data-year]");
        if (!year) return;
        ctx.year = Number(year.dataset.year);
        render({ keepScroll: true });
      });
      bar.addEventListener("change", (e) => {
        if (e.target.id !== "agent-select") return;
        ctx.agent = e.target.value;
        render({ keepScroll: true });
      });
    }

    $$("#ctxbar [data-year]").forEach((btn) => {
      const on = Number(btn.dataset.year) === ctx.year;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    const select = $("#agent-select");
    if (select && select.value !== ctx.agent) select.value = ctx.agent;
  }

  function buildHeader() {
    const top = $("#topbar");
    top.innerHTML = `
      <span class="wordmark only-mobile" id="top-brand"></span>
      <div class="page-head">
        <div class="page-title" id="page-title"></div>
        <div class="page-sub" id="page-sub" hidden></div>
      </div>
      <div class="topbar-tools">
        <button class="btn btn-icon only-mobile" id="open-palette-m" aria-label="חיפוש">
          ${UI.icon("search", 17)}</button>
        <button class="btn no-mobile" id="open-palette">
          ${UI.icon("search", 15)}<span>חיפוש לקוח</span>
          <kbd>${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <button class="btn btn-icon" id="undo-btn" aria-label="ביטול הפעולה האחרונה" hidden>
          ${UI.icon("undo", 17)}</button>
        <button class="btn btn-icon btn-primary" id="open-chat" aria-label="שאלה על הנתונים">
          ${UI.icon("chat", 17)}</button>
      </div>`;

    top.addEventListener("click", (e) => {
      if (e.target.closest("#open-palette, #open-palette-m")) return openPalette();
      if (e.target.closest("#undo-btn")) return undoLast();
      if (e.target.closest("#open-chat")) toggleChat();
    });
  }

  function syncHeader() {
    const item = NAV.find((n) => n.id === ctx.view);
    const years = Store.years();
    const sub = ctx.view === "trend"
      ? `${years[0]}–${years[years.length - 1]}${
          ctx.agent === "all" ? "" : ` · ${Store.agentName(ctx.agent)}`}`
      : !item.period ? ""
      : `${ctx.year} · ינואר–${Fmt.month(Metrics.overview(ctx).lastMonth)}${
          ctx.agent === "all" ? "" : ` · ${Store.agentName(ctx.agent)}`}`;

    $("#top-brand").textContent = Store.settings().name;
    $("#page-title").textContent = item.title;
    const subNode = $("#page-sub");
    subNode.hidden = !sub;
    subNode.textContent = sub;

    const undo = $("#undo-btn");
    undo.hidden = !Store.canUndo();
    if (!undo.hidden) undo.title = `ביטול: ${Store.lastAction()}`;
  }

  /** סרגל תחתון בנייד: ארבעה יעדים בלבד, האחרון פותח את השאר. */
  function buildTabbar() {
    const bar = $("#tabbar");
    bar.innerHTML = `
      ${NAV.filter((item) => item.tab).map((item) => `
        <button class="tab-item" data-nav="${item.id}">
          <span class="tab-icon">${UI.icon(item.icon, 21)}${
            ALERTS.has(item.id) ? '<span class="tab-dot" hidden></span>' : ""}</span>
          <span>${item.label}</span>
        </button>`).join("")}
      <button class="tab-item" id="tab-more">
        <span class="tab-icon">${UI.icon("menu", 21)}</span>
        <span>עוד</span>
      </button>`;

    bar.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) return go(nav.dataset.nav);
      if (e.target.closest("#tab-more")) openSidebar();
    });
  }

  function syncTabbar() {
    const n = counts();
    $$("#tabbar [data-nav]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.nav === ctx.view);
      const dot = btn.querySelector(".tab-dot");
      if (dot) dot.hidden = !n[btn.dataset.nav];
    });
    $("#tab-more").classList.toggle("is-active",
      NAV.some((i) => !i.tab && i.id === ctx.view));
  }

  let shellBuilt = false;

  /**
   * מצייר את המסך הפעיל ומסנכרן את המעטפת.
   *
   * `transition` — מעבר רך בין מסכים (ניווט בלבד; לא בעדכון נתונים).
   * `scroll`     — לאן לגלול אחרי הציור.
   * `keepScroll` — להישאר במקום; לשינוי שנה או סוכן, שבו התוכן מתחלף
   *                מתחת לאותה נקודת מבט ואין סיבה לזרוק את הקורא למעלה.
   */
  function render({ transition = false, scroll = null, keepScroll = false } = {}) {
    const years = Store.years();
    if (!ctx.year || !years.includes(ctx.year)) ctx.year = years[years.length - 1];

    if (!shellBuilt) {
      buildSidebar();
      buildHeader();
      buildTabbar();
      shellBuilt = true;
    }
    syncSidebar();
    syncHeader();
    syncCtxbar();
    syncTabbar();

    const at = keepScroll ? window.scrollY : scroll;
    const paint = () => {
      const root = $("#view");
      root.innerHTML = "";
      NAV.find((n) => n.id === ctx.view).view().render(root, ctx);
      if (openCustomerNo) renderCustomerCard(openCustomerNo);
      if (at !== null) window.scrollTo({ top: at });
    };

    // מעבר המסך מצויר על ידי הדפדפן עצמו, ולכן הוא חלק גם כשהמסך כבד.
    // מי שביקש פחות תנועה מקבל החלפה מיידית.
    if (transition && document.startViewTransition && !reducedMotion()) {
      document.startViewTransition(paint);
    } else {
      paint();
    }
  }

  /* ------------------------------------------------------------------ נושא
     ההעדפה נשמרת כ-auto / light / dark, ורק התוצאה נחתמת על ה-HTML. כך יש
     נקודת אמת אחת לצבעים, ומצב "אוטומטי" ממשיך לעקוב אחרי הגדרת המכשיר. */
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function themePref() {
    try { return localStorage.getItem(cfg.themeKey) || "auto"; } catch (err) { return "auto"; }
  }

  function applyTheme() {
    const pref = themePref();
    const dark = pref === "dark" || (pref === "auto" && media.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  function setTheme(pref) {
    try { localStorage.setItem(cfg.themeKey, pref); } catch (err) { /* לא קריטי */ }
    applyTheme();
    render({ keepScroll: true });
    toast(pref === "auto" ? "התצוגה עוקבת אחרי המכשיר"
      : pref === "dark" ? "מצב לילה" : "מצב יום");
  }

  /* --------------------------------------------------------------- הודעות */
  function toast(message, tone = "", { undo = false } = {}) {
    const node = document.createElement("div");
    node.className = "toast";
    node.innerHTML = `${tone ? UI.icon(tone === "down" ? "alert" : "check", 15) : ""}
      <span>${Fmt.escape(message)}</span>
      ${undo ? '<button class="btn btn-sm" style="pointer-events:auto;margin-inline-start:4px">ביטול</button>' : ""}`;
    $("#toast-stack").appendChild(node);
    const remove = () => {
      node.classList.add("is-out");
      setTimeout(() => node.remove(), 220);
    };
    const timer = setTimeout(remove, undo ? 6000 : 2800);
    if (undo) {
      node.querySelector("button").addEventListener("click", () => {
        clearTimeout(timer);
        remove();
        undoLast();
      });
    }
  }

  function undoLast() {
    const label = Store.undo();
    if (label) toast(`בוטל: ${label}`);
  }

  /* ---------------------------------------------------------------- מגירה */
  function openDrawer({ title, sub = "", body, tabs = "", onReady }) {
    $("#drawer-root").innerHTML = `
      <div class="drawer">
        <div class="drawer-backdrop" data-close-drawer></div>
        <section class="drawer-panel" role="dialog" aria-modal="true" aria-label="${
          Fmt.escape(title)}">
          <header class="drawer-head">
            <div style="flex:1;min-width:0">
              <h2 class="ellipsis">${title}</h2>
              ${sub ? `<div class="hint">${sub}</div>` : ""}
            </div>
            <button class="btn btn-icon btn-ghost" data-close-drawer aria-label="סגירה">
              ${UI.icon("close", 17)}</button>
          </header>
          ${tabs}
          <div class="drawer-body">${body}</div>
        </section>
      </div>`;
    const panel = $(".drawer-panel");
    UI.on($("#drawer-root"), "[data-close-drawer]", "click", closeDrawer);
    if (onReady) onReady(panel);
    return panel;
  }

  function closeDrawer() {
    $("#drawer-root").innerHTML = "";
    openCustomerNo = null;
  }

  function openCustomer(no) {
    if (openCustomerNo !== no) drawerTab = "overview";
    openCustomerNo = no;
    renderCustomerCard(no);
  }

  function confirm({ title, body, danger, onConfirm }) {
    openDrawer({
      title,
      body: UI.card("", {
        body: `<p style="color:var(--text-2);line-height:1.65">${Fmt.escape(body)}</p>
          <div class="row-actions" style="margin-top:16px">
            <button class="btn btn-danger" id="do-confirm">${Fmt.escape(danger)}</button>
            <button class="btn" data-close-drawer>ביטול</button>
          </div>`,
      }),
      onReady(panel) {
        panel.querySelector("#do-confirm").addEventListener("click", () => {
          closeDrawer();
          onConfirm();
        });
      },
    });
  }

  /* ------------------------------------------------------------ כרטיס לקוח */
  function renderCustomerCard(no) {
    const party = Store.party(no);
    if (!party) return closeDrawer();
    const view = Metrics.overview(ctx);
    const row = view.customers.find((c) => c.no === no) || {
      months: Array(12).fill(0), priorMonths: Array(12).fill(0), ytd: 0, priorYtd: 0,
      changePct: null, payers: [], target: 0, profile: party.profile, lastActive: 0,
      activeMonths: 0, delta: 0,
    };
    const history = Metrics.customerHistory(no);
    const activities = Store.state.activities.filter((a) => a.party_no === no);
    const statuses = ViewCustomers.STATUS;
    const status = statuses[party.profile.status] || statuses.active;

    const TABS = [["overview", "סקירה"], ["history", "היסטוריה"],
                  ["details", "פרטים"], ["activity", `פעילות${
                    activities.length ? ` · ${activities.length}` : ""}`]];

    const book = Metrics.catalog();
    const link = (target) => `<a href="#" data-customer="${Fmt.escape(target)}">${
      Fmt.escape(Store.partyName(target))} (${Fmt.escape(target)})</a>`;
    const related = [];
    // מה שידוע בוודאות הוא שמספר אחד ממשיך את השני. האם מדובר באתר, בחטיבה
    // או בחשבון המשך של אותה חברה — הדוח אינו אומר, ולכן גם המערכת לא.
    if (row.parent) {
      related.push(book.aliases.has(no)
        ? `אותו שם, שני מספרי חשבון בדוח: גם ${link(row.parent)}`
        : `מספר הלקוח ממשיך את ${link(row.parent)} — בדוח הם שני לקוחות נפרדים`);
    }
    if (row.sites && row.sites.length) {
      const twins = row.sites.filter((siteNo) => book.aliases.has(siteNo));
      const rest = row.sites.filter((siteNo) => !book.aliases.has(siteNo));
      if (twins.length) {
        related.push(`אותו שם, שני מספרי חשבון בדוח: גם ${twins.map(link).join(" · ")}`);
      }
      if (rest.length) {
        related.push(`מספרים שממשיכים את המספר הזה: ${rest.map(link).join(" · ")}`);
      }
    }
    if (book.payerOnly.has(no)) {
      related.push("מופיע בדוח כלקוח משלם בלבד, לא כיעד משלוח");
    }

    const notice = row.isBucket
      ? `<div class="notice warn">${UI.icon("alert", 16)}<div>
           <strong>סל מרוכז, לא לקוח</strong>
           <span>כך הדוח מקבץ מכירות קטנות. המחזור נספר בסיכומים, אבל הרשומה
           מוחרגת מהדירוגים ומרשימות הטיפול — אין כאן חברה אחת להתקשר אליה.</span>
         </div></div>`
      : related.length
        ? `<div class="notice">${UI.icon("users", 16)}<div>${related.join("<br>")}</div></div>`
        : "";

    const panes = {
      overview: `
        ${notice}
        <div class="grid cols-4">
          <section class="card kpi">
            <div class="kpi-label">${ctx.year} · ${view.cmpLabel}</div>
            <div class="kpi-value">${Fmt.money(row.ytd)}</div>
            <div class="kpi-foot">${view.hasPrior
              ? `${UI.delta(row.changePct)}
                 <span>מול ${Fmt.money(row.priorYtd)} ב-${view.priorYear}</span>`
              : `<span>אין ${view.priorYear} במאגר להשוואה</span>`}</div>
          </section>
          <section class="card kpi">
            <div class="kpi-label">חודשים פעילים</div>
            <div class="kpi-value">${row.activeMonths}<span
              style="font-size:14px;color:var(--muted)"> / ${view.lastMonth}</span></div>
            <div class="kpi-foot">מכירה אחרונה ${
              row.lastActive ? Fmt.month(row.lastActive) : "—"}</div>
          </section>
          <section class="card kpi">
            <div class="kpi-label">יעד ${ctx.year}</div>
            <div class="kpi-value">${row.target ? Fmt.money(row.target) : "—"}</div>
            <div class="kpi-foot">${row.target
              ? `${((row.ytd / row.target) * 100).toFixed(0)}% עמידה`
              : "לא הוגדר יעד"}</div>
          </section>
        </div>

        ${UI.card("מכירות לפי חודש", {
          sub: `${ctx.year} מול ${view.priorYear}`,
          body: '<div id="card-chart"></div>',
        })}

        ${row.payers.length > 1 ? UI.card("לקוחות משלמים", {
          sub: `מי שילם בפועל ב-${ctx.year}`,
          flush: true,
          body: `<div class="list">${row.payers.map(([payerNo, amount]) => `
            <div class="list-row" ${payerNo === no ? "" : `data-customer="${
              Fmt.escape(payerNo)}"`}>
              ${UI.avatar(Store.partyName(payerNo))}
              <div class="grow">
                <div class="list-title ellipsis">${Fmt.escape(Store.partyName(payerNo))}</div>
                <div class="list-sub">${Fmt.escape(payerNo)}</div>
              </div>
              <div class="list-value">${Fmt.money(amount)}</div>
            </div>`).join("")}</div>`,
        }) : ""}`,

      history: UI.card("היסטוריה שנתית", {
        sub: `${history[0].year}–${history[history.length - 1].year} · כל שנה וכל חודש`,
        flush: true,
        body: `<div class="card-body" id="card-years"></div>
          <div class="table-wrap"><table>
          <thead><tr><th>שנה</th>${Fmt.SHORT.map((m) => (
            `<th class="num">${m}</th>`)).join("")}<th class="num">סה״כ</th></tr></thead>
          <tbody>${history.map((h) => `
            <tr><td style="font-weight:600">${h.year}</td>${h.months.map((v) => (
              `<td class="num" style="${v ? "" : "color:var(--muted)"}">${
                v ? Fmt.short(v) : "—"}</td>`)).join("")}
            <td class="num" style="font-weight:650">${Fmt.money(h.total)}</td></tr>`).join("")}
          </tbody></table></div>`,
      }),

      details: UI.card("פרטי הלקוח", {
        body: `
          <div class="form-grid">
            <label class="stacked"><span>שם</span>
              <input class="input" id="p-name" value="${Fmt.escape(party.name)}"></label>
            <label class="stacked"><span>מספר לקוח</span>
              <input class="input" id="p-no" inputmode="numeric" dir="ltr"
                     value="${Fmt.escape(party.no)}"></label>
            <label class="stacked"><span>סטטוס</span>
              <select class="select" id="p-status">${Object.entries(statuses).map(([k, v]) => (
                `<option value="${k}" ${(party.profile.status || "active") === k
                  ? "selected" : ""}>${v.label}</option>`)).join("")}</select></label>
            <label class="stacked"><span>דירוג</span>
              <select class="select" id="p-tier">${["", "A", "B", "C"].map((t) => (
                `<option value="${t}" ${party.profile.tier === t ? "selected" : ""}>${
                  t || "—"}</option>`)).join("")}</select></label>
            <label class="stacked"><span>תחום</span>
              <input class="input" id="p-segment"
                     value="${Fmt.escape(party.profile.segment || "")}"></label>
            <label class="stacked"><span>איש קשר</span>
              <input class="input" id="p-contact"
                     value="${Fmt.escape(party.profile.contact_name || "")}"></label>
            <label class="stacked"><span>טלפון</span>
              <input class="input" id="p-phone" type="tel" dir="ltr"
                     value="${Fmt.escape(party.profile.contact_phone || "")}"></label>
            <label class="stacked"><span>אימייל</span>
              <input class="input" id="p-email" type="email" dir="ltr"
                     value="${Fmt.escape(party.profile.contact_email || "")}"></label>
            <label class="stacked"><span>יעד ${ctx.year} (₪)</span>
              <input class="input" id="p-target" inputmode="decimal"
                     value="${row.target || ""}"></label>
          </div>
          <label class="stacked" style="margin-top:13px"><span>הערות</span>
            <textarea id="p-notes">${Fmt.escape(party.profile.notes || "")}</textarea></label>
          <div class="row-actions" style="margin-top:14px">
            <button class="btn btn-primary" id="p-save">שמירה</button>
            <button class="btn" id="p-merge">${UI.icon("users", 15)} איחוד עם לקוח אחר</button>
            <button class="btn btn-danger" id="p-delete">${
              UI.icon("trash", 15)} מחיקת הלקוח</button>
          </div>
          <p class="hint" style="margin-top:10px">שינוי המספר מעביר איתו את כל התנועות,
            היעדים והפעילות. איחוד מצרף לקוח אחר לתוך זה, והסכומים מצטברים.</p>`,
      }),

      activity: `
        ${UI.card("רישום מהיר", {
          body: `
            <div class="form-grid">
              <label class="stacked"><span>סוג</span>
                <select class="select" id="a-kind">${Object.entries(ViewActivity.KINDS)
                  .map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
              <label class="stacked"><span>תזכורת למעקב</span>
                <input class="input" type="date" id="a-follow"></label>
            </div>
            <label class="stacked" style="margin-top:12px"><span>מה קרה</span>
              <input class="input" id="a-title" placeholder="תיאור קצר"></label>
            <div class="row-actions" style="margin-top:12px">
              <button class="btn btn-primary" id="a-add">${
                UI.icon("plus", 15)} הוספת רישום</button>
            </div>`,
        })}
        ${activities.length ? UI.card("", { flush: true, body: `<div class="list">${
          activities.map((a) => `
            <div class="list-item ${a.done ? "done" : ""}">
              <div class="grow" style="flex:1;min-width:0">
                <div class="list-title">${Fmt.escape(a.title)}</div>
                <div class="list-sub">${ViewActivity.KINDS[a.kind] || a.kind} · ${
                  Fmt.dateLong(a.happened_on)}${
                  a.follow_up_on ? ` · מעקב ${Fmt.date(a.follow_up_on)}` : ""}</div>
              </div>
              <button class="btn btn-sm" data-toggle="${a.id}">${
                a.done ? "החזרה" : "בוצע"}</button>
            </div>`).join("")}</div>` })
          : UI.empty("אין רישומים ללקוח הזה", "שיחות, פגישות והצעות מחיר נרשמות כאן.", "note")}`,
    };

    const panel = openDrawer({
      title: Fmt.escape(party.name),
      sub: `מספר לקוח ${Fmt.escape(no)} · <span class="badge ${status.tone}">${
        status.label}</span>`,
      tabs: `<nav class="tabs">${TABS.map(([id, label]) => `
        <button data-tab="${id}" class="${drawerTab === id ? "is-active" : ""}">${
          label}</button>`).join("")}</nav>`,
      body: panes[drawerTab],
      onReady(node) {
        UI.on(node, "[data-tab]", "click", (e) => {
          drawerTab = e.currentTarget.dataset.tab;
          renderCustomerCard(no);
        });
        UI.on(node, "[data-customer]", "click", (e) => openCustomer(e.currentTarget.dataset.customer));
        UI.on(node, "[data-toggle]", "click", (e) => Store.toggleActivity(e.currentTarget.dataset.toggle));

        const yearsChart = node.querySelector("#card-years");
        if (yearsChart) {
          Charts.bars(yearsChart, [{
            label: "מחזור", values: history.map((h) => h.total),
            color: Charts.color("--accent"),
            colorAt: (i) => (history[i].year === ctx.year
              ? Charts.color("--accent") : Charts.color("--chart-prior")),
          }], history.map((h) => String(h.year)),
          { height: 180, labels: true, legend: false });
        }

        const chart = node.querySelector("#card-chart");
        if (chart) {
          Charts.bars(chart, [
            { label: `${ctx.year}`, values: row.months, color: Charts.color("--accent") },
            ...(view.hasPrior ? [{ label: `${view.priorYear}`, values: row.priorMonths,
              color: Charts.color("--chart-prior") }] : []),
          ], Fmt.SHORT, { height: 210, side: 42 });
        }

        const merge = node.querySelector("#p-merge");
        if (merge) {
          merge.addEventListener("click", () => {
            pickCustomer((otherNo) => {
              if (otherNo === no) return toast("צריך לבחור לקוח אחר", "down");
              confirm({
                title: `לאחד את ${Store.partyName(otherNo)} לתוך ${party.name}?`,
                body: `כל התנועות, היעדים והפעילות של ${Store.partyName(otherNo)} `
                  + `(${otherNo}) יעברו ל${party.name} (${no}), והסכומים יצטברו. `
                  + "הלקוח השני יימחק מהרשימה. אפשר לבטל מיד אחרי.",
                danger: "איחוד הלקוחות",
                onConfirm() {
                  try {
                    Store.mergeParty(otherNo, no);
                    toast("הלקוחות אוחדו", "up", { undo: true });
                    openCustomer(no);
                  } catch (err) {
                    toast(err.message, "down");
                  }
                },
              });
            }, { keepDrawer: true });
          });
        }

        const save = node.querySelector("#p-save");
        if (save) {
          save.addEventListener("click", () => {
            const nextNo = node.querySelector("#p-no").value.trim();
            if (nextNo && nextNo !== no) {
              try {
                Store.changePartyNumber(no, nextNo);
              } catch (err) {
                return toast(err.message, "down");
              }
            }
            Store.renameParty(nextNo || no, node.querySelector("#p-name").value);
            const id = node.querySelector("#p-no").value.trim() || no;
            Store.updateProfile(id, {
              status: node.querySelector("#p-status").value,
              tier: node.querySelector("#p-tier").value,
              segment: node.querySelector("#p-segment").value.trim(),
              contact_name: node.querySelector("#p-contact").value.trim(),
              contact_phone: node.querySelector("#p-phone").value.trim(),
              contact_email: node.querySelector("#p-email").value.trim(),
              notes: node.querySelector("#p-notes").value.trim(),
            });
            Store.setTarget(id, ctx.year, node.querySelector("#p-target").value);
            toast("פרטי הלקוח נשמרו", "up");
            if (id !== no) openCustomer(id);
          });

          node.querySelector("#p-delete").addEventListener("click", () => {
            confirm({
              title: `למחוק את ${party.name}?`,
              body: "הלקוח וכל תנועות המכירה שלו יימחקו מהמערכת. אפשר לבטל מיד אחרי.",
              danger: "מחיקת הלקוח",
              onConfirm() {
                Store.deleteParty(no);
                closeDrawer();
                toast("הלקוח נמחק", "", { undo: true });
              },
            });
          });
        }

        const add = node.querySelector("#a-add");
        if (add) {
          add.addEventListener("click", () => {
            const title = node.querySelector("#a-title").value.trim();
            if (!title) return toast("צריך תיאור לרישום", "down");
            Store.addActivity({
              party_no: no,
              kind: node.querySelector("#a-kind").value,
              follow_up_on: node.querySelector("#a-follow").value || null,
              title,
            });
            toast("הרישום נוסף", "up");
          });
        }
      },
    });
    return panel;
  }

  /* ---------------------------------------------------------------- העוזר
     פאנל צד בשולחן העבודה, מסך מלא בנייד. השיחה נשמרת בזיכרון הדף בלבד. */
  let chatOpen = false;
  const chatLog = [];

  function toggleChat() {
    chatOpen = !chatOpen;
    renderChat();
    if (chatOpen) {
      const input = $("#chat-input");
      if (input && window.innerWidth > 1000) input.focus();
    }
  }

  function askAssistant(question) {
    const text = String(question || "").trim();
    if (!text) return;
    chatLog.push({ role: "you", text });
    const answer = Assistant.ask(text, ctx);
    chatLog.push({ role: "beny", answer });
    renderChat();
    const body = $("#chat-body");
    if (body) body.scrollTop = body.scrollHeight;
  }

  function renderChat() {
    const root = $("#chat-root");
    if (!chatOpen) {
      root.innerHTML = "";
      document.body.classList.remove("chat-open");
      return;
    }
    document.body.classList.add("chat-open");

    const intro = `
      <div class="chat-intro">
        <div class="chat-hello">
          <span class="wordmark small">${Fmt.escape(Store.settings().name)}</span>
          <p>שאלו אותי על הנתונים. אני שולף את התשובה מהמערכת — לא ממציא מספרים,
             ואם אין לי כיסוי לשאלה אני אומר את זה.</p>
        </div>
        <div class="ans-suggest">
          ${Assistant.SUGGESTIONS.map((q) => (
            `<button class="ans-chip" data-ask="${Fmt.escape(q)}">${Fmt.escape(q)}</button>`
          )).join("")}
        </div>
      </div>`;

    root.innerHTML = `
      <div class="chat-scrim" data-close-chat></div>
      <aside class="chat" role="complementary" aria-label="עוזר הנתונים">
        <header class="chat-head">
          <div>
            <div class="chat-title">שאלה על הנתונים</div>
            <div class="hint">${ctx.year} · ${ctx.agent === "all"
              ? "כל הסוכנים" : Fmt.escape(Store.agentName(ctx.agent))}</div>
          </div>
          <button class="btn btn-icon btn-ghost" data-close-chat aria-label="סגירה">
            ${UI.icon("close", 17)}</button>
        </header>

        <div class="chat-body" id="chat-body">
          ${chatLog.length ? chatLog.map((entry) => (
            entry.role === "you"
              ? `<div class="bubble you">${Fmt.escape(entry.text)}</div>`
              : `<div class="bubble beny">
                   <div class="ans-title">${entry.answer.title}</div>
                   ${entry.answer.body || ""}
                 </div>`
          )).join("") : intro}
        </div>

        <form class="chat-form" id="chat-form">
          <input class="input" id="chat-input" autocomplete="off"
                 placeholder="למשל: מי דורש טיפול?">
          <button class="btn btn-primary btn-icon" type="submit" aria-label="שליחה">
            ${UI.icon("send", 17)}</button>
        </form>
      </aside>`;

    UI.on(root, "[data-close-chat]", "click", toggleChat);
    UI.on(root, "[data-ask]", "click", (e) => askAssistant(e.currentTarget.dataset.ask));
    UI.on(root, "[data-open]", "click", (e) => {
      if (window.innerWidth <= 1000) toggleChat();
      openCustomer(e.currentTarget.dataset.open);
    });
    UI.on(root, "[data-goto]", "click", (e) => {
      if (window.innerWidth <= 1000) toggleChat();
      go(e.currentTarget.dataset.goto);
    });
    $("#chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#chat-input");
      askAssistant(input.value);
      input.value = "";
    });
  }

  /* ---------------------------------------------------------- חיפוש מהיר
     אותו חלון משמש גם כבורר לקוח: ברשימה של מאות שמות, שדה חיפוש שמסנן תוך
     כדי הקלדה הוא הדרך היחידה שאפשר לקרוא לה מהירה. `onChoose` מקבל את
     הבחירה במקום לפתוח את כרטיס הלקוח. */
  function pickCustomer(onChoose, options = {}) {
    openPalette({ onChoose, ...options });
  }

  function openPalette({ onChoose = null } = {}) {
    const view = Metrics.overview(ctx);
    const byNo = new Map(view.customers.map((c) => [c.no, c]));
    let active = 0;
    let matches = [];

    const results = () => {
      const term = $("#palette-input").value.trim().toLowerCase();
      const pool = Store.parties();
      matches = (term
        ? pool.filter((p) => p.name.toLowerCase().includes(term) || p.no.includes(term))
        : view.customers.slice(0, 8).map((c) => Store.party(c.no)).filter(Boolean)
      ).slice(0, 30);
      active = 0;
      paint();
    };

    const paint = () => {
      $("#palette-results").innerHTML = matches.length ? matches.map((p, i) => {
        const row = byNo.get(p.no);
        return `<div class="palette-row ${i === active ? "is-active" : ""}" data-i="${i}">
          ${UI.avatar(p.name)}
          <div class="grow">
            <div class="list-title ellipsis">${Fmt.escape(p.name)}</div>
            <div class="list-sub">${Fmt.escape(p.no)}</div>
          </div>
          ${row && row.ytd ? `<span class="num hint">${Fmt.money(row.ytd)}</span>` : ""}
        </div>`;
      }).join("") : UI.empty("אין תוצאות", "", "search");

      UI.on($("#palette-results"), ".palette-row", "click", (e) => {
        choose(Number(e.currentTarget.dataset.i));
      });
    };

    const close = () => { $("#palette-root").innerHTML = ""; };
    const choose = (i) => {
      const party = matches[i];
      if (!party) return;
      close();
      if (onChoose) onChoose(party.no);
      else openCustomer(party.no);
    };

    $("#palette-root").innerHTML = `
      <div class="palette">
        <div class="palette-backdrop" data-close-palette></div>
        <div class="palette-box" role="dialog" aria-modal="true" aria-label="חיפוש לקוח">
          <input class="palette-input" id="palette-input" placeholder="חיפוש לקוח לפי שם או מספר…"
                 autocomplete="off">
          <div class="palette-results" id="palette-results"></div>
          <div class="palette-hint">
            <span><kbd>↑</kbd><kbd>↓</kbd> ניווט</span>
            <span><kbd>Enter</kbd> פתיחה</span>
            <span><kbd>Esc</kbd> סגירה</span>
          </div>
        </div>
      </div>`;

    $(".palette-backdrop").addEventListener("click", close);
    const input = $("#palette-input");
    input.addEventListener("input", results);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return close();
      if (e.key === "Enter") return choose(active);
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      active = Math.max(0, Math.min(matches.length - 1,
        active + (e.key === "ArrowDown" ? 1 : -1)));
      paint();
      const node = $(`.palette-row[data-i="${active}"]`);
      if (node) node.scrollIntoView({ block: "nearest" });
    });
    results();
    input.focus();
  }

  /* ----------------------------------------------------------------- קבצים */
  function saveAs(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    // העוגן חייב לשרוד את הלחיצה, אחרת הדפדפן מוותר על שם הקובץ שנבחר.
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 2000);
  }

  async function exportExcel() {
    toast("מכין את הקובץ…");
    try {
      const result = await Excel.download(ctx.agent);
      toast(result.format === "xlsx" ? "הקובץ ירד למחשב"
        : "הקובץ ירד במבנה Excel XML (אין גישה לספריית xlsx)", "up");
    } catch (err) {
      toast(`הייצוא נכשל: ${err.message}`, "down");
    }
  }

  /* ------------------------------------------------------------- סרגל צד */
  function openSidebar() {
    $("#sidebar").classList.add("is-open");
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.addEventListener("click", closeSidebar);
    document.body.appendChild(scrim);
  }

  function closeSidebar() {
    $("#sidebar").classList.remove("is-open");
    document.querySelectorAll(".scrim").forEach((n) => n.remove());
  }

  /* ------------------------------------------------------------- אתחול */
  function init() {
    Store.init();

    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return openPalette();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        return undoLast();
      }
      if (e.key === "Escape") {
        if ($("#palette-root").innerHTML) return ($("#palette-root").innerHTML = "");
        if ($("#drawer-root").innerHTML) return closeDrawer();
        if (chatOpen) return toggleChat();
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        openPalette();
      }
    });

    // כמה מסכים נבנים אחרת בטלפון ובמחשב (טבלת החודשים, למשל). סיבוב המכשיר
    // או שינוי גודל החלון חוצים את הגבול, ולכן המסך נבנה מחדש — אבל רק
    // כשחוצים אותו, ולא בכל פיקסל של גרירה.
    let phone = window.innerWidth <= 1000;
    window.addEventListener("resize", () => {
      const now = window.innerWidth <= 1000;
      if (now === phone) return;
      phone = now;
      render({ keepScroll: true });
    });

    // מצב "אוטומטי" ממשיך לעקוב אחרי המכשיר גם בלי רענון.
    media.addEventListener("change", () => {
      if (themePref() === "auto") {
        applyTheme();
        render({ keepScroll: true });
      }
    });

    // כל שינוי בנתונים מצייר מחדש את המסך הפעיל ואת כרטיס הלקוח הפתוח.
    // שינוי נתונים אינו ניווט: הקורא נשאר במקום שבו היה.
    Store.onChange(() => render({ keepScroll: true }));
    render();

    // דוח חדש שנכנס לנתונים ששמורים במכשיר — נאמר במפורש, אחרת המספרים
    // פשוט משתנים בלי הסבר.
    const merged = Store.state.merged;
    if (merged && merged.years.length) {
      toast(`נוספו נתוני ${merged.years.join(", ")} — העריכות והרישומים שלך נשמרו`, "up");
    }
  }

  return { init, render, go, toast, confirm, openDrawer, closeDrawer, openCustomer,
           pickCustomer, exportExcel, saveAs, toggleChat, ask: askAssistant, ctx };
})();

document.addEventListener("DOMContentLoaded", () => {
  try {
    App.init();
  } catch (err) {
    console.error(err);
    document.querySelector("#view").innerHTML =
      `<div class="card"><div class="card-body">${
        UI.empty("טעינת המערכת נכשלה", err.message, "alert")}</div></div>`;
  }
});
