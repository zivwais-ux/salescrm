/* ============================================================================
   חישובי ניתוח. כל הפונקציות עובדות מול Store ומחזירות אובייקטים מוכנים לתצוגה.
   ========================================================================== */
window.Metrics = (function () {
  /**
   * קטלוג הגופים: מי לקוח, מי רק משלם, ומה היחס ביניהם.
   *
   * שני דברים שהדוח לא אומר במפורש ומשנים את הפרשנות:
   *   • "לקוחות שונים" אינו לקוח אלא סל מרוכז של מכירות קטנות. המחזור שלו
   *     אמיתי ונספר, אבל אין למי להתקשר — ולכן הוא מוחרג מדירוגים ומרשימות
   *     הטיפול, שם הוא היה תופס מקום של לקוח אמיתי.
   *   • מספר לקוח שהוא קידומת מדויקת של מספר אחר הוא חשבון אב, והארוך ממנו
   *     הוא אתר או חטיבה שלו (קרגל משמר השרון / משמר דוד). הדוח מציג אותם
   *     כשני לקוחות נפרדים, וזה נכון — אבל הקשר ביניהם שווה הצגה.
   */
  let cached = null;

  function catalog() {
    const sales = Store.sales();
    const key = `${sales.length}|${Store.parties().length}`;
    if (cached && cached.key === key) return cached;

    const shipTo = new Set(sales.map((s) => s.c));
    const payers = new Set(sales.map((s) => s.p));
    const numbers = Store.parties().map((p) => p.no).sort();

    const parentOf = new Map();
    const sitesOf = new Map();
    numbers.forEach((a) => {
      numbers.forEach((b) => {
        if (a !== b && b.startsWith(a)) {
          parentOf.set(b, a);
          if (!sitesOf.has(a)) sitesOf.set(a, []);
          sitesOf.get(a).push(b);
        }
      });
    });

    const buckets = new Set(Store.parties()
      .filter((p) => /לקוחות שונים|שונים\s*$/.test(p.name))
      .map((p) => p.no));

    cached = { key, shipTo, payers, parentOf, sitesOf, buckets,
               payerOnly: new Set([...payers].filter((no) => !shipTo.has(no))) };
    return cached;
  }

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
      const book = catalog();
      customers.push({
        no,
        name: Store.partyName(no),
        isBucket: book.buckets.has(no),
        parent: book.parentOf.get(no) || null,
        sites: book.sitesOf.get(no) || [],
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

    // הסל המרוכז נספר במחזור אבל לא בדירוגים וברשימות הפעולה.
    const real = customers.filter((c) => !c.isBucket);
    const top10 = real.filter((c) => c.ytd > 0).slice(0, 10);

    // לקוחות בסיכון: קנו בשנה שעברה, וירדו מהותית או נעלמו השנה.
    // הסף של 5,000 ₪ מסנן לקוחות מזדמנים שירידה אצלם אינה אומרת דבר.
    customers.forEach((c) => {
      c.atRisk = !c.isBucket && c.priorYtd >= 5000
        && (c.ytd === 0 || (c.changePct !== null && c.changePct <= -35));
      // שקט על הקו: פעיל השנה, אך לא קנה בחודשיים האחרונים שנסגרו.
      c.isQuiet = !c.isBucket && c.ytd > 0
        && c.monthsSinceSale !== null && c.monthsSinceSale >= 2;
    });

    const atRisk = customers.filter((c) => c.atRisk).sort((a, b) => a.delta - b.delta);

    const growing = real
      .filter((c) => c.delta > 0 && c.priorYtd > 0)
      .sort((a, b) => b.delta - a.delta);

    const shrinking = real
      .filter((c) => c.delta < 0 && c.priorYtd > 0)
      .sort((a, b) => a.delta - b.delta);

    const quiet = customers.filter((c) => c.isQuiet).sort((a, b) => b.ytd - a.ytd);

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
      shrinking,
      newCustomers: real.filter((c) => c.isNew).sort((a, b) => b.ytd - a.ytd),
      lostCustomers: real.filter((c) => c.isLost).sort((a, b) => b.priorYtd - a.priorYtd),
      byAgent: agentSplit({ year, agent }),
      bestMonth: monthsCur.reduce((best, v, i) => (v > monthsCur[best] ? i : best), 0),
    };
  }

  /**
   * פילוח לפי סוכן לשנה נתונה. הסוכנים הזניחים מקופלים ל"אחר" — ארבע
   * קטגוריות על מסך אחד כבר קשות להבחנה, ושני סוכנים כאן הם שברירי אחוז.
   */
  function agentSplit({ year, agent }) {
    const totals = new Map();
    rows({ year, agent }).forEach((s) => {
      totals.set(s.agent, (totals.get(s.agent) || 0) + s.a);
    });
    const all = [...totals.entries()]
      .map(([no, value]) => ({ no, name: Store.agentName(no), value }))
      .sort((a, b) => b.value - a.value);
    const total = sum(all.map((a) => a.value));
    const major = all.filter((a) => a.value / (total || 1) >= 0.02);
    const minor = all.filter((a) => a.value / (total || 1) < 0.02);
    const list = major.slice(0, 3);
    const rest = [...major.slice(3), ...minor];
    if (rest.length) {
      list.push({ no: "other", name: rest.length === 1 ? rest[0].name : "סוכנים נוספים",
                  value: sum(rest.map((a) => a.value)), count: rest.length });
    }
    return { list, total };
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

  return { rows, byCustomer, monthly, overview, customerHistory, agentSplit,
           catalog, change, sum };
})();
