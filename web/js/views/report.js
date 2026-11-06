/* ============================================================================
   דוח חודשי — מה ששולחים להנהלה.

   זה המסך היחיד באתר שנועד לצאת ממנו: להדפסה או ל-PDF. לכן הוא נבנה אחרת
   משאר המסכים — בלי ניווט, בלי כפתורים, בלי מצב לילה, ובלי גרפים שתלויים
   בריחוף. כל מספר כתוב, וכל טענה נושאת את ההסבר שלה.

   ההדפסה נעשית בדפדפן עצמו (Ctrl+P → שמירה כ-PDF). אין כאן שום תלות
   חיצונית, בדיוק כמו בשאר המערכת.
   ========================================================================== */
window.ViewReport = (function () {
  const ui = { month: null };

  /** החודש המלא האחרון שיש עליו נתונים — מה שסביר שמדווחים עליו. */
  function defaultMonth(ctx) {
    const closed = Store.closedMonth(ctx.year);
    const partial = Metrics.partialMonth({ year: ctx.year, agent: ctx.agent });
    return partial ? Math.max(1, closed - 1) : closed;
  }

  /** סכום של חודש בודד, לכל הלקוחות או לסוכן אחד. */
  function monthTotal(year, month, agent) {
    return Metrics.sum(Store.sales()
      .filter((s) => s.y === year && s.m === month
        && (agent === "all" || s.agent === agent))
      .map((s) => s.a));
  }

  /** מי הזיז את החודש: ההפרש של כל לקוח מול אותו חודש אשתקד. */
  function movers(year, month, agent) {
    const now = new Map();
    const then = new Map();
    Store.sales().forEach((s) => {
      if (agent !== "all" && s.agent !== agent) return;
      if (s.m !== month) return;
      if (s.y === year) now.set(s.c, (now.get(s.c) || 0) + s.a);
      if (s.y === year - 1) then.set(s.c, (then.get(s.c) || 0) + s.a);
    });
    const book = Metrics.catalog();
    return [...new Set([...now.keys(), ...then.keys()])]
      .filter((no) => !book.buckets.has(no))
      .map((no) => {
        const cur = now.get(no) || 0;
        const prev = then.get(no) || 0;
        return { no, name: Store.partyName(no), cur, prev,
                 delta: Math.round((cur - prev) * 100) / 100 };
      })
      .filter((c) => Math.abs(c.delta) >= 1)
      .sort((a, b) => b.delta - a.delta);
  }

  /* טבלה בתוך מכל נגלל: במובייל הטבלה רחבה מהמסך, ועדיף שתגלול בתוך עצמה
     מאשר שתדחוף את כל העמוד הצידה. בהדפסה המכל שקוף והטבלה נפרסת במלואה. */
  /** פילוח סוכנים לתקופת ההשוואה: מחזור ומספר הלקוחות שבאמת קנו. */
  function agentRows(year, cmpMonths, agent) {
    const money = new Map();
    const clients = new Map();
    const book = Metrics.catalog();
    Store.sales().forEach((s) => {
      if (s.y !== year || s.m > cmpMonths) return;
      if (agent !== "all" && s.agent !== agent) return;
      money.set(s.agent, (money.get(s.agent) || 0) + s.a);
      if (!book.buckets.has(s.c) && s.a) {
        if (!clients.has(s.agent)) clients.set(s.agent, new Set());
        clients.get(s.agent).add(s.c);
      }
    });
    return [...money.entries()]
      .map(([no, value]) => ({ no, name: Store.agentName(no), value,
                               count: (clients.get(no) || new Set()).size }))
      .sort((a, b) => b.value - a.value);
  }

  function table(columns, rows) {
    return `<div class="report-scroll"><table class="report-table">
      <thead><tr>${columns.map((c, i) => (
        `<th class="${i ? "num" : ""}">${c}</th>`)).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((cell, i) => (
        `<td class="${i ? "num" : ""}">${cell}</td>`)).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  function render(root, ctx) {
    if (!ui.month || ui.month > Store.closedMonth(ctx.year)) ui.month = defaultMonth(ctx);
    const month = ui.month;
    const view = Metrics.overview(ctx);
    const settings = Store.settings();

    const cur = monthTotal(ctx.year, month, ctx.agent);
    const prev = monthTotal(ctx.year - 1, month, ctx.agent);
    const changePct = Metrics.change(cur, prev);
    const moved = movers(ctx.year, month, ctx.agent);
    const up = moved.filter((c) => c.delta > 0).slice(0, 8);
    const down = moved.filter((c) => c.delta < 0).slice(-8).reverse();

    // מי דורש טיפול, עם ההסבר — אותה פסיקה שמוצגת בלוח הבקרה ובכרטיס
    const attention = view.customers
      .filter((c) => !c.isBucket)
      .map((c) => ({ c, base: Metrics.baseline(c.no,
        { year: ctx.year, cmpMonths: view.cmpMonths }) }))
      .filter((x) => x.base.verdict === "anomaly")
      .sort((a, b) => a.c.delta - b.c.delta)
      .slice(0, 10);

    const agents = agentRows(ctx.year, view.cmpMonths, ctx.agent);
    const agentsTotal = agents.reduce((sum, a) => sum + a.value, 0);
    const openTasks = Store.state.activities.filter((a) => !a.done);
    const agentLabel = ctx.agent === "all" ? "כל הסוכנים" : Store.agentName(ctx.agent);
    const printed = new Date().toLocaleDateString("he-IL",
      { day: "numeric", month: "long", year: "numeric" });

    root.innerHTML = `
      <div class="report-bar no-print">
        <label class="field">
          <span>חודש הדוח</span>
          <select class="select" id="report-month">
            ${Array.from({ length: Store.closedMonth(ctx.year) }, (_, i) => i + 1)
              .reverse().map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${
                Fmt.month(m)} ${ctx.year}</option>`).join("")}
          </select>
        </label>
        <div class="spacer row-actions">
          <span class="hint">נפתח בחלון ההדפסה של הדפדפן — אפשר לשמור כ-PDF</span>
          <button class="btn btn-primary" id="report-print">${
            UI.icon("file", 15)} הדפסה או PDF</button>
        </div>
      </div>

      <article class="report">
        <header class="report-head">
          <div>
            <div class="report-title">דוח מכירות · ${Fmt.month(month)} ${ctx.year}</div>
            <div class="report-sub">${Fmt.escape(settings.branch)} · ${
              Fmt.escape(agentLabel)}</div>
          </div>
          <div class="report-stamp">
            <div class="report-brand">${Fmt.escape(settings.name)}</div>
            <div class="report-sub">הופק ${printed}</div>
          </div>
        </header>

        <section class="report-lead">
          <div>
            <div class="report-lead-label">מכירות ${Fmt.month(month)}</div>
            <div class="report-lead-value">${Fmt.money(cur)}</div>
            <div class="report-lead-note">${prev
              ? `${Fmt.percent(changePct, 1)} מול ${Fmt.money(prev)} ב-${
                  Fmt.month(month)} ${ctx.year - 1}`
              : `אין ${Fmt.month(month)} ${ctx.year - 1} במאגר להשוואה`}</div>
          </div>
          <div>
            <div class="report-lead-label">מתחילת ${ctx.year} · ${view.cmpLabel}</div>
            <div class="report-lead-value">${Fmt.money(view.totalYtd)}</div>
            <div class="report-lead-note">${view.hasPrior
              ? `${Fmt.percent(view.changePct, 1)} מול ${Fmt.money(view.totalPrior)} ב-${
                  view.priorYear}`
              : "אין שנה קודמת להשוואה"}</div>
          </div>
          <div>
            <div class="report-lead-label">לקוחות פעילים</div>
            <div class="report-lead-value">${Fmt.number(view.active.length)}</div>
            <div class="report-lead-note">מתוך ${Fmt.number(view.customers.length)} בתיק</div>
          </div>
        </section>

        <section class="report-section">
          <h2>מי הזיז את החודש</h2>
          <p class="report-note">ההפרש מול ${Fmt.month(month)} ${ctx.year - 1}, בשקלים.</p>
          <div class="report-cols">
            <div>
              <h3>עלו</h3>
              ${up.length ? table(["לקוח", "החודש", "אשתקד", "הפרש"],
                up.map((c) => [Fmt.escape(c.name), Fmt.money(c.cur), Fmt.money(c.prev),
                  `<span class="up">${Fmt.signed(c.delta)}</span>`]))
                : '<p class="report-note">אין עליות מול אשתקד.</p>'}
            </div>
            <div>
              <h3>ירדו</h3>
              ${down.length ? table(["לקוח", "החודש", "אשתקד", "הפרש"],
                down.map((c) => [Fmt.escape(c.name), Fmt.money(c.cur), Fmt.money(c.prev),
                  `<span class="down">${Fmt.signed(c.delta)}</span>`]))
                : '<p class="report-note">אין ירידות מול אשתקד.</p>'}
            </div>
          </div>
        </section>

        <section class="report-section">
          <h2>דורש טיפול</h2>
          <p class="report-note">לקוחות שחורגים מהדפוס ההיסטורי של עצמם — לא מסף אחיד.
            לצד כל אחד הסיבה שבגללה הוא ברשימה.</p>
          ${attention.length ? table(["לקוח", `${view.cmpLabel} ${ctx.year}`,
            `${view.cmpLabel} ${view.priorYear}`, "הפרש", "למה"],
            attention.map(({ c, base }) => [Fmt.escape(c.name), Fmt.money(c.ytd),
              Fmt.money(c.priorYtd), `<span class="down">${Fmt.signed(c.delta)}</span>`,
              Fmt.escape(base.why)]))
            : '<p class="report-note">אין לקוח שחורג מהדפוס שלו.</p>'}
        </section>

        <section class="report-section">
          <h2>עשרת הגדולים</h2>
          <p class="report-note">${view.cmpLabel} ${ctx.year} · ${
            view.top10Share.toFixed(0)}% מהמחזור מגיעים מהם.</p>
          ${table(["#", "לקוח", `${ctx.year}`, `${view.priorYear}`, "שינוי", "נתח"],
            view.top10.map((c, i) => [String(i + 1), Fmt.escape(c.name), Fmt.money(c.ytd),
              Fmt.money(c.priorYtd),
              view.hasPrior ? Fmt.percent(c.changePct, 1) : "—",
              `${((c.ytd / (view.totalYtd || 1)) * 100).toFixed(1)}%`]))}
        </section>

        <section class="report-section">
          <h2>פילוח לפי סוכן</h2>
          <p class="report-note">${view.cmpLabel} ${ctx.year} · מספר הלקוחות הוא
            לקוחות שקנו בפועל בתקופה.</p>
          ${table(["סוכן", "מחזור", "לקוחות", "נתח"],
            agents.map((a) => [Fmt.escape(a.name), Fmt.money(a.value),
              Fmt.number(a.count),
              `${((a.value / (agentsTotal || 1)) * 100).toFixed(1)}%`]))}
        </section>

        ${openTasks.length ? `<section class="report-section">
          <h2>מעקב פתוח</h2>
          ${table(["משימה", "לקוח", "תאריך מעקב"],
            openTasks.slice(0, 15).map((a) => [Fmt.escape(a.title),
              Fmt.escape(Store.partyName(a.party_no)),
              a.follow_up_on ? Fmt.date(a.follow_up_on) : "—"]))}
        </section>` : ""}

        <footer class="report-foot">
          ${Fmt.escape(settings.name)} · ${Fmt.escape(settings.branch)} ·
          הופק ${printed} · המספרים מתוך דוחות ה-ERP כפי שנקלטו במערכת
        </footer>
      </article>`;

    root.querySelector("#report-month").addEventListener("change", (e) => {
      ui.month = Number(e.target.value);
      render(root, ctx);
    });
    root.querySelector("#report-print").addEventListener("click", () => window.print());
  }

  return { render };
})();
