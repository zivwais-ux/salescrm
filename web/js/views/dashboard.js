/* ============================================================================
   לוח בקרה: התמונה שבני רואה ראשונה בבוקר.
   ========================================================================== */
window.ViewDashboard = (function () {
  function kpi(label, value, foot) {
    return `<div class="card kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-foot">${foot || ""}</div>
    </div>`;
  }

  function deltaTag(pct) {
    if (pct === null || pct === undefined) return '<span class="badge">חדש</span>';
    const cls = pct >= 0 ? "up" : "down";
    return `<span class="delta ${cls}">${Fmt.percent(pct, 1)}</span>`;
  }

  function customerList(items, { valueOf, noteOf, emptyText }) {
    if (!items.length) return `<p class="empty">${emptyText}</p>`;
    return `<div class="list">${items.map((c) => `
      <div class="list-item row-link" data-customer="${Fmt.escape(c.no)}">
        <div>
          <strong>${Fmt.escape(c.name)}</strong>
          <span class="sub">${noteOf(c)}</span>
        </div>
        <div class="num">${valueOf(c)}</div>
      </div>`).join("")}</div>`;
  }

  function render(root, ctx) {
    const view = Metrics.overview(ctx);
    const monthLabels = Fmt.SHORT;
    const yearLabel = `${view.year}`;
    const periodLabel = `ינואר–${Fmt.month(view.lastMonth)}`;

    root.innerHTML = `
      <div class="stack">
        <div class="grid grid-kpi">
          ${kpi(`מכירות ${yearLabel} (${periodLabel})`, Fmt.money(view.totalYtd),
                `לעומת ${Fmt.money(view.totalPrior)} ב-${view.priorYear} · ${
                  view.changePct === null ? "—" : `<span class="delta ${
                    view.changePct >= 0 ? "up" : "down"}">${Fmt.percent(view.changePct, 1)}</span>`}`)}
          ${kpi("הפרש מול אשתקד", `${view.delta >= 0 ? "+" : ""}${Fmt.money(view.delta)}`,
                `ממוצע חודשי ${Fmt.money(view.avgMonth)}`)}
          ${kpi("לקוחות פעילים", Fmt.number(view.active.length),
                `מתוך ${Fmt.number(view.customers.length)} לקוחות בתיק · ${
                  view.newCustomers.length} חדשים השנה`)}
          ${kpi("תחזית לסוף השנה", Fmt.money(view.runRate),
                `לפי קצב נוכחי · ${view.priorYear} נסגרה ב-${Fmt.money(view.priorFullYear)}`)}
          ${kpi("ריכוז 10 הגדולים", `${view.top10Share.toFixed(0)}%`,
                `${Fmt.money(Metrics.sum(view.top10.map((c) => c.ytd)))} מתוך המחזור`)}
          ${view.targetTotal ? kpi("עמידה ביעד", `${(view.targetPct || 0).toFixed(0)}%`,
                `יעד ${Fmt.money(view.targetTotal)} · פער ${
                  Fmt.money(view.totalYtd - view.targetTotal)}`)
            : kpi("החודש החזק ביותר", Fmt.month(view.bestMonth + 1),
                Fmt.money(view.monthsCur[view.bestMonth]))}
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-head">
              <h3>מכירות לפי חודש</h3>
              <p>${yearLabel} מול ${view.priorYear}</p>
            </div>
            <div id="chart-months"></div>
          </div>
          <div class="card">
            <div class="card-head">
              <h3>מצטבר מתחילת השנה</h3>
              <p>כמה נמכר עד סוף כל חודש</p>
            </div>
            <div id="chart-cumulative"></div>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-head">
              <h3>10 הלקוחות הגדולים</h3>
              <p>${periodLabel} ${yearLabel}</p>
            </div>
            <div id="chart-top"></div>
          </div>
          <div class="card">
            <div class="card-head">
              <h3>הצמיחה הגדולה ביותר</h3>
              <p>תוספת בשקלים מול אשתקד</p>
            </div>
            <div id="chart-growth"></div>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-head">
              <h3>דורש טיפול</h3>
              <p>ירידה של 35% ומעלה, או לקוח שנעלם</p>
            </div>
            ${customerList(view.atRisk.slice(0, 8), {
              valueOf: (c) => `<span class="delta down">${Fmt.money(c.delta)}</span>`,
              noteOf: (c) => (c.ytd === 0
                ? `לא קנה השנה · ${Fmt.money(c.priorYtd)} ב-${view.priorYear}`
                : `${Fmt.money(c.ytd)} מול ${Fmt.money(c.priorYtd)} · ${Fmt.percent(c.changePct, 0)}`),
              emptyText: "אין לקוחות בירידה מהותית. מצוין.",
            })}
          </div>
          <div class="card">
            <div class="card-head">
              <h3>שקט על הקו</h3>
              <p>לקוחות פעילים שלא קנו חודשיים ומעלה</p>
            </div>
            ${customerList(view.quiet.slice(0, 8), {
              valueOf: (c) => Fmt.money(c.ytd),
              noteOf: (c) => `מכירה אחרונה: ${Fmt.month(c.lastActive)} · ${
                c.monthsSinceSale} חודשים ללא פעילות`,
              emptyText: "כל הלקוחות הפעילים קנו לאחרונה.",
            })}
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-head">
              <h3>לקוחות חדשים ב-${yearLabel}</h3>
              <p>לא קנו ב-${view.priorYear}</p>
            </div>
            ${customerList(view.newCustomers.slice(0, 8), {
              valueOf: (c) => `<span class="delta up">${Fmt.money(c.ytd)}</span>`,
              noteOf: (c) => `${c.activeMonths} חודשי פעילות`,
              emptyText: "עוד לא נפתחו לקוחות חדשים השנה.",
            })}
          </div>
          <div class="card">
            <div class="card-head">
              <h3>משימות פתוחות</h3>
              <p>מתוך מסך המשימות</p>
            </div>
            ${openTasks()}
          </div>
        </div>
      </div>`;

    Charts.groupedBars(root.querySelector("#chart-months"), [
      { label: yearLabel, values: view.monthsCur, color: Charts.COLORS.current },
      { label: `${view.priorYear}`, values: view.monthsPrior, color: Charts.COLORS.prior },
    ], monthLabels);

    Charts.cumulativeLines(root.querySelector("#chart-cumulative"), [
      { label: yearLabel, values: view.monthsCur.slice(0, view.lastMonth),
        color: Charts.COLORS.current },
      { label: `${view.priorYear}`, values: view.monthsPrior, color: Charts.COLORS.prior },
    ], monthLabels);

    Charts.ranking(root.querySelector("#chart-top"), view.top10.map((c) => ({
      no: c.no, label: c.name, value: c.ytd,
      display: `${Fmt.money(c.ytd)} ${deltaTag(c.changePct)}`,
    })));

    Charts.ranking(root.querySelector("#chart-growth"), view.growing.slice(0, 10).map((c) => ({
      no: c.no, label: c.name, value: c.delta,
      display: `<span class="delta up">+${Fmt.money(c.delta)}</span>`,
    })), { colorBy: () => Charts.COLORS.good });

    root.querySelectorAll("[data-customer], .bar-item[data-no]").forEach((node) => {
      const no = node.dataset.customer || node.dataset.no;
      if (!no) return;
      node.classList.add("row-link");
      node.addEventListener("click", () => App.openCustomer(no));
    });
  }

  function openTasks() {
    const open = Store.state.activities.filter((a) => !a.done).slice(0, 8);
    if (!open.length) return '<p class="empty">אין משימות פתוחות.</p>';
    return `<div class="list">${open.map((a) => `
      <div class="list-item row-link" data-customer="${Fmt.escape(a.party_no)}">
        <div>
          <strong>${Fmt.escape(a.title)}</strong>
          <span class="sub">${Fmt.escape(Store.partyName(a.party_no))} · ${
            a.follow_up_on ? `מעקב ל-${Fmt.date(a.follow_up_on)}` : Fmt.date(a.happened_on)}</span>
        </div>
        <span class="badge">${Fmt.escape(a.kind)}</span>
      </div>`).join("")}</div>`;
  }

  return { render };
})();
