/* ============================================================================
   חישובי ניתוח. כל הפונקציות עובדות מול Store ומחזירות אובייקטים מוכנים לתצוגה.
   ========================================================================== */
window.Metrics = (function () {
  /** מסנן תנועות לפי שנה/סוכן. agent === "all" מבטל את הסינון. */
  function rows({ year, agent }) {
    return Store.sales().filter((s) => (
      (year === undefined || s.y === year) && (!agent || agent === "all" || s.agent === agent)
    ));
  }

  /** סיכום לכל לקוח בשנה: סה"כ, פירוט חודשי, משלמים. */
  function byCustomer({ year, agent }) {
    const map = new Map();
    rows({ year, agent }).forEach((s) => {
      let entry = map.get(s.c);
      if (!entry) {
        entry = { no: s.c, name: Store.partyName(s.c), total: 0,
                  months: Array(12).fill(0), payers: new Map() };
        map.set(s.c, entry);
      }
      entry.total += s.a;
      entry.months[s.m - 1] += s.a;
      entry.payers.set(s.p, (entry.payers.get(s.p) || 0) + s.a);
    });
    return map;
  }

  /** סכום לפי חודש (מערך של 12). */
  function monthly({ year, agent }) {
    const out = Array(12).fill(0);
    rows({ year, agent }).forEach((s) => { out[s.m - 1] += s.a; });
    return out;
  }

  const sum = (list) => list.reduce((a, b) => a + b, 0);
  const upto = (months, last) => sum(months.slice(0, last));

  /** אחוז שינוי; מחזיר null כשאין בסיס להשוואה. */
  function change(current, prior) {
    if (!prior) return current ? null : 0;
    return ((current - prior) / Math.abs(prior)) * 100;
  }

  /**
   * התמונה המלאה לשנה נבחרת מול השנה שקדמה לה, מוגבלת לאותם חודשים
   * ("עד כה"), כדי שההשוואה תהיה הוגנת גם באמצע שנה.
   */
  function overview({ year, agent }) {
    const priorYear = year - 1;
    const lastMonth = Store.lastMonth(year);
    const current = byCustomer({ year, agent });
    const prior = byCustomer({ year: priorYear, agent });

    const customers = [];
    const seen = new Set([...current.keys(), ...prior.keys()]);
    seen.forEach((no) => {
      const cur = current.get(no);
      const prev = prior.get(no);
      const curMonths = cur ? cur.months : Array(12).fill(0);
      const prevMonths = prev ? prev.months : Array(12).fill(0);
      const ytd = upto(curMonths, lastMonth);
      const priorYtd = upto(prevMonths, lastMonth);
      const activeMonths = curMonths.filter((v) => v > 0).length;
      const lastActive = curMonths.reduce((acc, v, i) => (v > 0 ? i + 1 : acc), 0);
      customers.push({
        no,
        name: Store.partyName(no),
        profile: (Store.party(no) || {}).profile || {},
        months: curMonths,
        priorMonths: prevMonths,
        total: cur ? cur.total : 0,
        priorTotal: prev ? prev.total : 0,
        ytd,
        priorYtd,
        delta: ytd - priorYtd,
        changePct: change(ytd, priorYtd),
        activeMonths,
        lastActive,
        monthsSinceSale: lastActive ? lastMonth - lastActive : null,
        payers: cur ? [...cur.payers.entries()].sort((a, b) => b[1] - a[1]) : [],
        target: Store.target(no, year),
        isNew: !priorYtd && ytd > 0,
        isLost: priorYtd > 0 && ytd === 0,
      });
    });
    customers.sort((a, b) => b.ytd - a.ytd);

    const totalYtd = sum(customers.map((c) => c.ytd));
    const totalPrior = sum(customers.map((c) => c.priorYtd));
    const active = customers.filter((c) => c.ytd > 0);
    const top10 = active.slice(0, 10);

    // לקוחות בסיכון: קנו בשנה שעברה, וירדו מהותית או נעלמו השנה.
    const atRisk = customers
      .filter((c) => c.priorYtd >= 5000 && (c.ytd === 0 || (c.changePct !== null && c.changePct <= -35)))
      .sort((a, b) => a.delta - b.delta);

    const growing = customers
      .filter((c) => c.delta > 0 && c.priorYtd > 0)
      .sort((a, b) => b.delta - a.delta);

    // לקוחות שקטים: היו פעילים השנה אך לא קנו בחודשיים האחרונים שנסגרו.
    const quiet = active
      .filter((c) => c.monthsSinceSale !== null && c.monthsSinceSale >= 2)
      .sort((a, b) => b.ytd - a.ytd);

    const monthsCur = monthly({ year, agent });
    const monthsPrior = monthly({ year: priorYear, agent });
    const runRate = lastMonth ? (totalYtd / lastMonth) * 12 : 0;
    const targetTotal = sum(customers.map((c) => c.target));

    return {
      year, priorYear, lastMonth,
      customers, active,
      totalYtd, totalPrior,
      changePct: change(totalYtd, totalPrior),
      delta: totalYtd - totalPrior,
      priorFullYear: sum(monthsPrior),
      monthsCur, monthsPrior,
      avgMonth: lastMonth ? totalYtd / lastMonth : 0,
      runRate,
      targetTotal,
      targetPct: targetTotal ? (totalYtd / targetTotal) * 100 : null,
      top10,
      top10Share: totalYtd ? (sum(top10.map((c) => c.ytd)) / totalYtd) * 100 : 0,
      atRisk,
      growing,
      quiet,
      newCustomers: customers.filter((c) => c.isNew).sort((a, b) => b.ytd - a.ytd),
      lostCustomers: customers.filter((c) => c.isLost).sort((a, b) => b.priorYtd - a.priorYtd),
      bestMonth: monthsCur.reduce((best, v, i) => (v > monthsCur[best] ? i : best), 0),
    };
  }

  /** פירוט חודשי של לקוח בודד לאורך כל השנים. */
  function customerHistory(no) {
    const years = Store.years();
    return years.map((year) => {
      const months = Array(12).fill(0);
      Store.sales().filter((s) => s.c === no && s.y === year)
        .forEach((s) => { months[s.m - 1] += s.a; });
      return { year, months, total: sum(months) };
    });
  }

  return { rows, byCustomer, monthly, overview, customerHistory, change, sum };
})();
