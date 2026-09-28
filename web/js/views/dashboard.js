/* ============================================================================
   לוח בקרה — התמונה הראשונה של הבוקר.

   המסך בנוי משלוש רצועות שעונות על שלוש שאלות לפי סדר:

     1. המצב      — כמה נמכר, מול מה, ולאן זה הולך.
     2. מה לעשות  — מי דורש טיפול היום, עם הפעולה בשורה עצמה.
     3. הפירוט    — הגרפים, למי שרוצה להיכנס פנימה.

   הסדר הזה הוא ההחלטה המרכזית כאן. קודם היו אחת־עשרה קופסאות באותו משקל
   חזותי, והמשימות — הדבר היחיד שבאמת דורש פעולה — ישבו בתחתית, אחרי ארבעה
   גרפים. מי שפותח את המסך בבוקר רוצה לדעת ראשית אם הכול בסדר, ומיד אחר כך
   מה מוטל עליו; הניתוח מחכה לו כשיחפש אותו.
   ========================================================================== */
window.ViewDashboard = (function () {
  // מה מוצג כרגע ברצועת הניתוח, ואיזה גרף הוחלף בטבלה. נשמר בין ציורים.
  const asTable = new Set();
  const ui = { pane: "months", filter: "all" };

  const today = () => new Date().toISOString().slice(0, 10);
  const isPhone = () => window.innerWidth <= 1000;

  /* ------------------------------------------------------- רצועה 1: המצב */

  /**
   * מסילת המדדים.
   *
   * ארבעה מספרים על משטח אחד עם מפרידים, ולא ארבעה כרטיסים: הם עונים יחד
   * על שאלה אחת — "איך השנה נראית" — וארבע מסגרות נפרדות אומרות שאלה נפרדת
   * לכל אחד. לכל מדד נשאר משפט הסבר בשפה פשוטה.
   */
  function stat(label, value, foot, iconName, help) {
    return `<div class="stat">
      <div class="stat-label">
        ${iconName ? UI.icon(iconName, 13) : ""}<span>${label}</span>
        ${help ? `<button class="stat-help" data-help="${Fmt.escape(help)}"
                          aria-label="מה זה אומר">?</button>` : ""}
      </div>
      <div class="stat-value">${value}</div>
      <div class="stat-foot">${foot || ""}</div>
    </div>`;
  }

  function statRail(view, prior) {
    const cmp = view.cmpLabel;
    return `<div class="stat-rail">
      ${!view.hasPrior
        ? stat("החודש החזק", Fmt.month(view.bestMonth + 1),
               Fmt.money(view.monthsCur[view.bestMonth]), "trendUp",
               `אין נתוני ${prior} במאגר, ולכן אין השוואה לשנה קודמת.`)
        : stat("הפרש מול אשתקד", Fmt.signed(view.delta), `${cmp} מול ${prior}`, "trendUp",
               `כמה שקלים מכרנו יותר או פחות מאותם ${view.cmpMonths} חודשים ב-${prior}.`
               + (view.partialMonth
                 ? ` ${Fmt.month(view.partialMonth)} אינו נכלל: הדוח תפס אותו באמצעו,`
                   + " וחודש חצי מול חודש שלם אינו הפרש עסקי אלא תאריכי."
                 : ""))}
      ${stat("תחזית לסוף השנה", Fmt.money(view.runRate),
             view.hasPrior ? `סגירת ${prior}: ${Fmt.shortMoney(view.priorFullYear)}`
               : `על פי ${view.cmpMonths} חודשים`, "target",
             `הממוצע של ${view.cmpMonths} החודשים המלאים כפול 12. זו הערכה גסה — `
             + `אין בה עונתיות${view.partialMonth
               ? `, ו${Fmt.month(view.partialMonth)} לא נספר בה כי הדוח תפס אותו באמצעו`
               : ""}.`)}
      ${stat("תלות בגדולים", `${view.top10Share.toFixed(0)}%`,
             `${Fmt.shortMoney(Metrics.sum(view.top10.map((c) => c.ytd)))} מהמחזור`, "users",
             "איזה חלק מהמחזור מגיע מעשרת הלקוחות הגדולים. ככל שהאחוז גבוה יותר, "
             + "כך אובדן לקוח אחד כואב יותר.")}
      ${view.targetTotal
        ? stat("עמידה ביעד", `${(view.targetPct || 0).toFixed(0)}%`,
               `פער ${Fmt.signed(view.totalYtd - view.targetTotal)}`, "target",
               "המכירות עד כה מול סכום היעדים שהוגדרו בכרטיסי הלקוחות.")
        : !view.hasPrior
        ? stat("לקוחות פעילים", Fmt.number(view.active.length),
               `מתוך ${Fmt.number(view.customers.length)} בתיק`, "users",
               `כמה לקוחות קנו ב-${view.year}.`)
        : stat("לקוחות חדשים", Fmt.number(view.newCustomers.length),
               `${Fmt.shortMoney(Metrics.sum(view.newCustomers.map((c) => c.ytd)))} מחזור חדש`,
               "spark", `לקוחות שקנו ב-${view.year} ולא קנו בכלל ב-${prior}.`)}
    </div>`;
  }

  /** פס השנים: חמש שנים כחמישה עמודונים, הנבחרת מודגשת. */
  function yearsStrip(ctx) {
    const rows = Metrics.yearly({ agent: ctx.agent });
    if (rows.length < 2) return "";
    const max = Math.max(...rows.map((r) => r.total)) || 1;
    return `<div class="years-strip" role="group" aria-label="מעבר בין שנים">
      ${rows.slice().reverse().map((r) => `
        <button class="year-pill ${r.year === ctx.year ? "is-active" : ""}"
                data-set-year="${r.year}" aria-pressed="${r.year === ctx.year}"
                title="${r.year}: ${Fmt.money(r.total)}${r.partial ? " · שנה חלקית" : ""}">
          <span class="year-pill-bar"><i style="height:${
            Math.max(8, (r.total / max) * 100)}%"></i></span>
          <span class="year-pill-label">${r.year}</span>
          <span class="year-pill-value">${Fmt.short(r.total)}</span>
        </button>`).join("")}
    </div>`;
  }

  /* -------------------------------------------------- רצועה 2: מה לעשות */

  /**
   * רשימת הפעולה.
   *
   * שלוש הרשימות שהיו כאן — "דורש טיפול", "שקט על הקו" ומשימות פתוחות —
   * הן למעשה תור עבודה אחד, וההפרדה ביניהן רק חייבה לסרוק שלוש קופסאות
   * ולהחליט לבד מה דחוף. כאן הן מתמזגות לתור אחד לפי דחיפות אמיתית:
   * מעקב שעבר זמנו, לקוח שנעלם, מעקב להיום, ולקוח ששקט.
   *
   * לכל שורה יש פעולה במקום — זה מה שחוסך את מעברי המסך.
   */
  function actionItems(view) {
    const now = today();
    const items = [];

    Store.state.activities.filter((a) => !a.done).forEach((a) => {
      const late = a.follow_up_on && a.follow_up_on < now;
      const due = a.follow_up_on === now;
      items.push({
        kind: "task",
        id: a.id,
        no: a.party_no,
        rank: late ? 0 : due ? 2 : 4,
        name: Store.partyName(a.party_no),
        title: a.title,
        note: a.follow_up_on
          ? `${late ? "עבר זמנו · " : due ? "להיום · " : ""}${Fmt.date(a.follow_up_on)}`
          : ViewActivity.KINDS[a.kind],
        tone: late ? "down" : due ? "warn" : "",
      });
    });

    view.atRisk.forEach((c) => {
      items.push({
        kind: "risk",
        no: c.no,
        rank: 1,
        weight: Math.abs(c.delta),
        name: c.name,
        title: c.name,
        note: c.ytd === 0
          ? `לא קנה השנה · ${Fmt.money(c.priorYtd)} ב-${view.priorYear}`
          : `${Fmt.money(c.ytd)} מול ${Fmt.money(c.priorYtd)} · ${
              Fmt.percent(c.changePct, 0)}`,
        value: `<span class="delta down">${Fmt.signed(c.delta)}</span>`,
        tone: "down",
      });
    });

    view.quiet.forEach((c) => {
      items.push({
        kind: "quiet",
        no: c.no,
        rank: 3,
        weight: c.ytd,
        name: c.name,
        title: c.name,
        note: `מכירה אחרונה ${Fmt.month(c.lastActive)} · ${
          c.monthsSinceSale} חודשים ללא פעילות`,
        value: Fmt.money(c.ytd),
        tone: "warn",
      });
    });

    return items.sort((a, b) => a.rank - b.rank || (b.weight || 0) - (a.weight || 0));
  }

  const FILTERS = [
    ["all", "הכול"],
    ["task", "מעקב"],
    ["risk", "בירידה"],
    ["quiet", "שקטים"],
  ];

  function actionRow(item) {
    return `<div class="act-row" data-customer="${Fmt.escape(item.no)}">
      <span class="act-mark ${item.tone}" aria-hidden="true"></span>
      ${UI.avatar(item.name)}
      <div class="grow">
        <div class="list-title ellipsis">${Fmt.escape(item.title)}</div>
        <div class="list-sub ellipsis">${item.kind === "task"
          ? `${Fmt.escape(item.name)} · ${item.note}` : item.note}</div>
      </div>
      ${item.value ? `<div class="list-value">${item.value}</div>` : ""}
      <div class="act-tools">
        ${item.kind === "task"
          ? `<button class="btn btn-sm" data-done="${item.id}"
                     title="סימון כבוצע">${UI.icon("check", 14)}</button>
             <button class="btn btn-sm" data-snooze="${item.id}"
                     title="דחייה בשבוע">${UI.icon("clock", 14)}</button>`
          : `<button class="btn btn-sm" data-log="${Fmt.escape(item.no)}"
                     title="רישום מעקב">${UI.icon("note", 14)}</button>`}
      </div>
    </div>`;
  }

  function actionBand(items) {
    const counts = FILTERS.map(([key]) => (key === "all"
      ? items.length : items.filter((i) => i.kind === key).length));
    const shown = ui.filter === "all" ? items : items.filter((i) => i.kind === ui.filter);
    const late = items.filter((i) => i.rank === 0).length;

    return UI.card("מה דורש טיפול", {
      sub: items.length
        ? `${Fmt.number(items.length)} פריטים${late ? ` · ${late} עברו את תאריך המעקב` : ""}`
        : "אין מה לטפל בו כרגע",
      actions: `<div class="seg">
          ${FILTERS.map(([key, label], i) => `
            <button data-filter="${key}" class="${ui.filter === key ? "is-active" : ""}">
              ${label}${counts[i] ? ` <span class="chip-count ${
                key === "task" && late ? "is-late" : ""}">${counts[i]}</span>` : ""}
            </button>`).join("")}
        </div>
        <button class="btn btn-sm" data-goto="activity">כל הפעילות</button>`,
      flush: true,
      body: shown.length
        ? `<div class="act-list">${shown.slice(0, 8).map(actionRow).join("")}</div>${
            shown.length > 8 ? `<button class="act-more" data-goto="activity">
              עוד ${Fmt.number(shown.length - 8)} פריטים ברשימה המלאה</button>` : ""}`
        : UI.empty(items.length ? "אין פריטים בסינון הזה" : "הכול מטופל",
            items.length ? "אפשר לחזור לתצוגת הכול."
              : "אין לקוח בירידה מהותית, אין מי ששקט, ואין מעקב פתוח.", "check"),
    });
  }

  /* ------------------------------------------------- רצועה 3: הפירוט */

  const PANES = [
    ["months", "לפי חודש"],
    ["movers", "מי הזיז"],
    ["top", "הגדולים"],
    ["agents", "סוכנים"],
  ];

  function analysisBand(view, prior) {
    const id = `chart-${ui.pane}`;
    const showTable = asTable.has(id);
    const subs = {
      months: view.hasPrior ? `${view.year} מול ${prior}` : `${view.year}`,
      movers: `השינוי הגדול ביותר מול ${prior}, בשקלים`,
      top: `${view.cmpLabel} ${view.year}`,
      agents: `${view.cmpLabel} ${view.year}`,
    };
    return UI.card("ניתוח", {
      sub: subs[ui.pane],
      actions: `<div class="seg">
          ${PANES.map(([key, label]) => `
            <button data-pane="${key}" class="${ui.pane === key ? "is-active" : ""}">${
              label}</button>`).join("")}
        </div>
        <div class="view-toggle" role="group" aria-label="תצוגה">
          <button data-view-chart="${id}" class="${showTable ? "" : "is-active"}"
                  title="תרשים" aria-pressed="${!showTable}">${UI.icon("chart", 15)}</button>
          <button data-view-table="${id}" class="${showTable ? "is-active" : ""}"
                  title="טבלה" aria-pressed="${showTable}">${UI.icon("grid", 15)}</button>
        </div>`,
      flush: true,
      body: `<div class="card-body" id="${id}"></div>`,
    });
  }

  /* -------------------------------------------------------------- ציור */
  function render(root, ctx) {
    const view = Metrics.overview(ctx);
    const period = `ינואר–${Fmt.month(view.lastMonth)}`;
    const prior = `${view.priorYear}`;
    const items = actionItems(view);

    const partial = view.partialMonth
      ? `<span class="badge warn" title="הדוח הופק במהלך החודש, ולכן הוא סופר בו רק חלק מהמשלוחים. הסכום נכון, אבל הוא לא חודש שלם.">${
          UI.icon("alert", 12)} ${Fmt.month(view.partialMonth)} עדיין חלקי</span>`
      : "";

    const movers = [...view.growing.slice(0, 6),
                    ...view.shrinking.slice(0, 6)].sort((a, b) => b.delta - a.delta);

    root.innerHTML = `
      <section class="hero sec-hero">
        <div class="hero-main">
          <div class="hero-label">מכירות ${view.year} · ${period}</div>
          <div class="hero-value">${Fmt.moneyRich(view.totalSold)}</div>
          <div class="hero-meta">
            ${view.hasPrior ? `${UI.delta(view.changePct)}
              <span class="hint">${view.cmpLabel}: ${Fmt.money(view.totalYtd)} מול ${
                Fmt.money(view.totalPrior)} ב-${prior}</span>`
              : `<span class="hint">${prior} אינה במאגר, ולכן אין מול מה להשוות
                 את ${view.year}</span>`}
          </div>
          <div class="hero-meta">
            <span class="badge">${Fmt.number(view.active.length)} לקוחות פעילים</span>
            <span class="badge">ממוצע ${Fmt.shortMoney(view.avgMonth)} לחודש</span>
            ${partial}
            <button class="btn btn-sm" data-goto="entry">${
              UI.icon("upload", 14)} עדכון מקובץ</button>
          </div>
          ${yearsStrip(ctx)}
        </div>
        <div class="hero-chart" id="chart-cumulative"></div>
      </section>

      ${statRail(view, prior)}

      ${actionBand(items)}

      ${analysisBand(view, prior)}`;

    /* --- הגרף שבתוך ההירו --- */
    Charts.cumulative(root.querySelector("#chart-cumulative"), [
      { label: `${view.year}`, values: view.monthsCur.slice(0, view.lastMonth),
        color: Charts.color("--accent"), fill: true },
      ...(view.hasPrior ? [{ label: prior, values: view.monthsPrior,
        color: Charts.color("--chart-prior"), dashed: true }] : []),
    ], Fmt.SHORT, { height: isPhone() ? 132 : 210, side: 40 });

    /* --- רצועת הניתוח: רק החלונית הנבחרת מצוירת --- */
    const panes = {
      months: {
        chart: (host) => Charts.bars(host, [
          { label: `${view.year}`, values: view.monthsCur, color: Charts.color("--accent") },
          ...(view.hasPrior ? [{ label: prior, values: view.monthsPrior,
                                 color: Charts.color("--chart-prior") }] : []),
        ], Fmt.SHORT, { height: 250 }),
        table: () => Charts.table(["חודש", `${view.year}`, prior, "שינוי"],
          Fmt.MONTHS.map((m, i) => {
            const cur = view.monthsCur[i];
            const prev = view.monthsPrior[i];
            return [m, cur ? Fmt.money(cur) : "—", prev ? Fmt.money(prev) : "—",
                    cur || prev ? UI.delta(Metrics.change(cur, prev)) : "—"];
          })),
      },
      movers: {
        chart: (host) => (view.hasPrior
          ? Charts.diverging(host, movers.map((c) => ({
              no: c.no, label: c.name, value: c.delta, current: c.ytd, prior: c.priorYtd })))
          : (host.innerHTML = UI.empty(`אין נתוני ${prior} במאגר`,
              `${view.year} היא השנה הראשונה שיש, ולכן אין מול מה להשוות.`, "chart"))),
        table: () => Charts.table(["לקוח", "שינוי", `${view.year}`, prior],
          movers.map((c) => [Fmt.escape(c.name),
            `<span class="delta ${c.delta >= 0 ? "up" : "down"}">${Fmt.signed(c.delta)}</span>`,
            Fmt.money(c.ytd), Fmt.money(c.priorYtd)])),
      },
      top: {
        chart: (host) => Charts.ranking(host, view.top10.map((c) => ({
          no: c.no, label: c.name, value: c.ytd,
          display: `${Fmt.money(c.ytd)}${
            view.hasPrior ? ` &nbsp;${UI.delta(c.changePct)}` : ""}`,
        }))),
        table: () => Charts.table(["#", "לקוח", `${view.year}`, "נתח מהמחזור"],
          view.top10.map((c, i) => [String(i + 1), Fmt.escape(c.name), Fmt.money(c.ytd),
            `${((c.ytd / view.totalYtd) * 100).toFixed(1)}%`])),
      },
      agents: {
        chart: (host) => Charts.stacked(host, view.byAgent.list.map((a) => ({
          name: a.name, value: a.value, count: a.count,
        }))),
        table: () => Charts.table(["סוכן", "מחזור", "נתח"],
          view.byAgent.list.map((a) => [Fmt.escape(a.name), Fmt.money(a.value),
            `${((a.value / (view.byAgent.total || 1)) * 100).toFixed(1)}%`])),
      },
    };

    const paneId = `chart-${ui.pane}`;
    const host = root.querySelector(`#${paneId}`);
    if (host) {
      if (asTable.has(paneId)) {
        host.classList.add("flush");
        host.innerHTML = `<div class="chart-table">${panes[ui.pane].table()}</div>`;
      } else {
        host.classList.remove("flush");
        host.innerHTML = "";
        panes[ui.pane].chart(host);
      }
    }

    /* ---------------------------------------------------------- קשירה */
    UI.on(root, "[data-pane]", "click", (e) => {
      ui.pane = e.currentTarget.dataset.pane;
      render(root, ctx);
    });
    UI.on(root, "[data-filter]", "click", (e) => {
      ui.filter = e.currentTarget.dataset.filter;
      render(root, ctx);
    });
    UI.on(root, "[data-view-chart]", "click", (e) => {
      asTable.delete(e.currentTarget.dataset.viewChart);
      render(root, ctx);
    });
    UI.on(root, "[data-view-table]", "click", (e) => {
      asTable.add(e.currentTarget.dataset.viewTable);
      render(root, ctx);
    });
    UI.on(root, "[data-set-year]", "click", (e) => {
      App.ctx.year = Number(e.currentTarget.dataset.setYear);
      App.render({ keepScroll: true });
    });

    // פעולות השורה קודמות לפתיחת הכרטיס, ולכן הן עוצרות את ההתפשטות.
    UI.on(root, "[data-done]", "click", (e) => {
      e.stopPropagation();
      Store.toggleActivity(e.currentTarget.dataset.done);
      App.toast("סומן כבוצע", "up", { undo: true });
    });
    UI.on(root, "[data-snooze]", "click", (e) => {
      e.stopPropagation();
      const next = Store.snoozeActivity(e.currentTarget.dataset.snooze, 7);
      App.toast(`המעקב נדחה ל-${Fmt.date(next)}`, "", { undo: true });
    });
    UI.on(root, "[data-log]", "click", (e) => {
      e.stopPropagation();
      ViewActivity.openComposer({ party: e.currentTarget.dataset.log });
    });

    UI.on(root, "[data-customer], .bar-row[data-no]", "click", (e) => {
      const node = e.currentTarget;
      const no = node.dataset.customer || node.dataset.no;
      if (no) App.openCustomer(no);
    });
    UI.on(root, "[data-goto]", "click", (e) => {
      e.stopPropagation();
      App.go(e.currentTarget.dataset.goto);
    });
    UI.on(root, "[data-help]", "click", (e) => {
      e.stopPropagation();
      App.toast(e.currentTarget.dataset.help);
    });
  }

  return { render };
})();
