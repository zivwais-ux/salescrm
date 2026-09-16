/* ============================================================================
   לוח בקרה — התמונה הראשונה של הבוקר: כמה נמכר, מול מה, מי הזיז את המחזור,
   ומי דורש טיפול היום.
   ========================================================================== */
window.ViewDashboard = (function () {
  // איזה גרף מוצג כרגע כטבלה. נשמר בין ציורים כדי שהבחירה לא תתאפס.
  const asTable = new Set();

  function kpi(label, value, foot, iconName) {
    return `<section class="card kpi">
      <div class="kpi-label">${iconName ? UI.icon(iconName, 14) : ""}${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-foot">${foot || ""}</div>
    </section>`;
  }

  /** כרטיס גרף עם מתג בין תצוגה גרפית לטבלה. */
  function chartCard(id, title, sub, { extra = "" } = {}) {
    const showTable = asTable.has(id);
    return UI.card(title, {
      sub,
      actions: `${extra}
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

  /** רשימת לקוחות מלאה — בלי לקצץ, עם גלילה פנימית כשהיא ארוכה. */
  function customerRows(items, { value, note }) {
    return `<div class="list list-scroll">${items.map((c) => `
      <div class="list-row" data-customer="${Fmt.escape(c.no)}">
        ${UI.avatar(c.name)}
        <div class="grow">
          <div class="list-title ellipsis">${Fmt.escape(c.name)}</div>
          <div class="list-sub ellipsis">${note(c)}</div>
        </div>
        <div class="list-value">${value(c)}</div>
      </div>`).join("")}</div>`;
  }

  function render(root, ctx) {
    const view = Metrics.overview(ctx);
    const period = `ינואר–${Fmt.month(view.lastMonth)}`;
    const prior = `${view.priorYear}`;
    const openTasks = Store.state.activities.filter((a) => !a.done);
    const today = new Date().toISOString().slice(0, 10);

    // מי הזיז את המחזור: חמשת התורמים הגדולים מול חמשת הגורעים.
    const movers = [...view.growing.slice(0, 6),
                    ...view.shrinking.slice(0, 6)].sort((a, b) => b.delta - a.delta);

    root.innerHTML = `
      <section class="hero">
        <div class="hero-main">
          <div class="hero-label">מכירות ${view.year} · ${period}</div>
          <div class="hero-value">${Fmt.money(view.totalYtd)}</div>
          <div class="hero-meta">
            ${UI.delta(view.changePct)}
            <span class="hint">מול ${Fmt.money(view.totalPrior)} בתקופה המקבילה ב-${prior}</span>
          </div>
          <div class="hero-meta">
            <span class="badge">${Fmt.number(view.active.length)} לקוחות פעילים</span>
            <span class="badge">ממוצע ${Fmt.shortMoney(view.avgMonth)} לחודש</span>
          </div>
        </div>
        <div class="hero-chart" id="chart-cumulative"></div>
      </section>

      <div class="grid cols-4">
        ${kpi("הפרש מול אשתקד", Fmt.signed(view.delta),
              `על פני ${view.lastMonth} חודשים`, "trendUp")}
        ${kpi("תחזית לסוף השנה", Fmt.money(view.runRate),
              `סגירת ${prior}: ${Fmt.shortMoney(view.priorFullYear)}`, "target")}
        ${kpi("ריכוז 10 הגדולים", `${view.top10Share.toFixed(0)}%`,
              `${Fmt.shortMoney(Metrics.sum(view.top10.map((c) => c.ytd)))} מהמחזור`, "users")}
        ${view.targetTotal
          ? kpi("עמידה ביעד", `${(view.targetPct || 0).toFixed(0)}%`,
                `פער ${Fmt.signed(view.totalYtd - view.targetTotal)}`, "target")
          : kpi("לקוחות חדשים השנה", Fmt.number(view.newCustomers.length),
                `${Fmt.shortMoney(Metrics.sum(view.newCustomers.map((c) => c.ytd)))} מחזור חדש`,
                "spark")}
      </div>

      <div class="grid cols-2">
        ${chartCard("chart-months", "מכירות לפי חודש", `${view.year} מול ${prior}`)}
        ${chartCard("chart-movers", "מי הזיז את המחזור",
                    `השינוי הגדול ביותר מול ${prior}, בשקלים`)}
      </div>

      <div class="grid cols-2">
        ${chartCard("chart-top", "10 הלקוחות הגדולים", `${period} ${view.year}`)}
        ${chartCard("chart-agents", "פילוח לפי סוכן", `${period} ${view.year}`)}
      </div>

      <div class="grid cols-2">
        ${UI.card("דורש טיפול", {
          sub: `ירידה של 35% ומעלה מול אשתקד, או לקוח שהפסיק לקנות`,
          actions: `<span class="badge ${view.atRisk.length ? "down" : "up"}">${
            Fmt.number(view.atRisk.length)}</span>`,
          flush: true,
          body: view.atRisk.length
            ? customerRows(view.atRisk, {
                value: (c) => `<span class="delta down">${Fmt.signed(c.delta)}</span>`,
                note: (c) => (c.ytd === 0
                  ? `לא קנה השנה · ${Fmt.money(c.priorYtd)} ב-${prior}`
                  : `${Fmt.money(c.ytd)} מול ${Fmt.money(c.priorYtd)} · ${
                      Fmt.percent(c.changePct, 0)}`),
              })
            : UI.empty("אין לקוחות בירידה מהותית", "כל התיק יציב מול אשתקד.", "check"),
        })}

        ${UI.card("שקט על הקו", {
          sub: "לקוחות פעילים שלא קנו חודשיים ומעלה",
          actions: `<span class="badge ${view.quiet.length ? "warn" : "up"}">${
            Fmt.number(view.quiet.length)}</span>`,
          flush: true,
          body: view.quiet.length
            ? customerRows(view.quiet, {
                value: (c) => Fmt.money(c.ytd),
                note: (c) => `מכירה אחרונה ${Fmt.month(c.lastActive)} · ${
                  c.monthsSinceSale} חודשים ללא פעילות`,
              })
            : UI.empty("כולם קנו לאחרונה", "אין לקוח פעיל ששקט חודשיים.", "check"),
        })}
      </div>

      ${UI.card("משימות פתוחות", {
        sub: openTasks.length ? "לפי תאריך המעקב" : "",
        actions: `<button class="btn btn-sm" data-goto="activity">כל הפעילות</button>`,
        flush: true,
        body: openTasks.length
          ? `<div class="list">${openTasks
              .slice()
              .sort((a, b) => (a.follow_up_on || "9999").localeCompare(b.follow_up_on || "9999"))
              .map((a) => `
                <div class="list-row" data-customer="${Fmt.escape(a.party_no)}">
                  <span class="dot" style="background:var(--${
                    a.follow_up_on && a.follow_up_on < today ? "down" : "accent"})"></span>
                  <div class="grow">
                    <div class="list-title ellipsis">${Fmt.escape(a.title)}</div>
                    <div class="list-sub ellipsis">${
                      Fmt.escape(Store.partyName(a.party_no))}</div>
                  </div>
                  <span class="badge ${
                    a.follow_up_on && a.follow_up_on < today ? "down" : ""}">${
                    a.follow_up_on ? Fmt.date(a.follow_up_on) : ViewActivity.KINDS[a.kind]
                  }</span>
                </div>`).join("")}</div>`
          : UI.empty("אין משימות פתוחות", "רישום חדש נפתח מכרטיס הלקוח.", "check"),
      })}`;

    /* --- ציור הגרפים, כל אחד עם תאום טבלאי --- */
    Charts.cumulative(root.querySelector("#chart-cumulative"), [
      { label: `${view.year}`, values: view.monthsCur.slice(0, view.lastMonth),
        color: Charts.color("--accent"), fill: true },
      { label: prior, values: view.monthsPrior, color: Charts.color("--chart-prior"),
        dashed: true },
    ], Fmt.SHORT, { height: 150, side: 40 });

    const panes = {
      "chart-months": {
        chart: (host) => Charts.bars(host, [
          { label: `${view.year}`, values: view.monthsCur, color: Charts.color("--accent") },
          { label: prior, values: view.monthsPrior, color: Charts.color("--chart-prior") },
        ], Fmt.SHORT, { height: 250 }),
        table: () => Charts.table(["חודש", `${view.year}`, prior, "שינוי"],
          Fmt.MONTHS.map((m, i) => {
            const cur = view.monthsCur[i];
            const prev = view.monthsPrior[i];
            return [m, cur ? Fmt.money(cur) : "—", prev ? Fmt.money(prev) : "—",
                    cur || prev ? UI.delta(Metrics.change(cur, prev)) : "—"];
          })),
      },
      "chart-movers": {
        chart: (host) => Charts.diverging(host, movers.map((c) => ({
          no: c.no, label: c.name, value: c.delta, current: c.ytd, prior: c.priorYtd,
        }))),
        table: () => Charts.table(["לקוח", "שינוי", `${view.year}`, prior],
          movers.map((c) => [Fmt.escape(c.name),
            `<span class="delta ${c.delta >= 0 ? "up" : "down"}">${Fmt.signed(c.delta)}</span>`,
            Fmt.money(c.ytd), Fmt.money(c.priorYtd)])),
      },
      "chart-top": {
        chart: (host) => Charts.ranking(host, view.top10.map((c) => ({
          no: c.no, label: c.name, value: c.ytd,
          display: `${Fmt.money(c.ytd)} &nbsp;${UI.delta(c.changePct)}`,
        }))),
        table: () => Charts.table(["#", "לקוח", `${view.year}`, "נתח מהמחזור"],
          view.top10.map((c, i) => [String(i + 1), Fmt.escape(c.name), Fmt.money(c.ytd),
            `${((c.ytd / view.totalYtd) * 100).toFixed(1)}%`])),
      },
      "chart-agents": {
        chart: (host) => Charts.stacked(host, view.byAgent.list.map((a) => ({
          name: a.name, value: a.value, count: a.count,
        }))),
        table: () => Charts.table(["סוכן", "מחזור", "נתח"],
          view.byAgent.list.map((a) => [Fmt.escape(a.name), Fmt.money(a.value),
            `${((a.value / (view.byAgent.total || 1)) * 100).toFixed(1)}%`])),
      },
    };

    Object.entries(panes).forEach(([id, pane]) => {
      const host = root.querySelector(`#${id}`);
      if (!host) return;
      if (asTable.has(id)) {
        host.classList.add("flush");
        host.innerHTML = `<div class="chart-table">${pane.table()}</div>`;
      } else {
        host.classList.remove("flush");
        host.innerHTML = "";
        pane.chart(host);
      }
    });

    UI.on(root, "[data-view-chart]", "click", (e) => {
      asTable.delete(e.currentTarget.dataset.viewChart);
      render(root, ctx);
    });
    UI.on(root, "[data-view-table]", "click", (e) => {
      asTable.add(e.currentTarget.dataset.viewTable);
      render(root, ctx);
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
  }

  return { render };
})();
