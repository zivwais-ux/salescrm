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

  /**
   * החודש האחרון בשנה כשהוא עדיין לא מלא.
   *
   * דוח שהופק באמצע החודש סופר רק את מה שנשלח עד אותו יום, וספטמבר 2026
   * אכן מראה 387 אלף מול כ-1.4 מיליון בחודש רגיל. הסכום עצמו נכון ונשאר
   * כמו שהוא — אבל חודש כזה אסור שייכנס לממוצע או לתחזית, שם הוא היה גורר
   * את כל השנה כלפי מטה ומציג ירידה שלא קרתה. הזיהוי הוא יחסי: פחות
   * ממחצית החציון של ששת החודשים שלפניו.
   */
  function partialMonth({ year, agent } = {}) {
    const last = Store.closedMonth(year);
    if (!last || last < 4) return null;
    const months = monthly({ year, agent });
    const before = months.slice(Math.max(0, last - 7), last - 1).filter((v) => v > 0);
    if (before.length < 3) return null;
    const sorted = before.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return months[last - 1] > 0 && months[last - 1] < median * 0.5 ? last : null;
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
    const lastMonth = Store.closedMonth(year);
    // כל השוואה נמדדת על חודשים מלאים בלבד. חודש שהדוח תפס באמצעו מוריד את
    // הצד האחד של ההשוואה ולא את השני, וההפרש שנוצר אינו עסקי אלא תאריכי:
    // ינואר–ספטמבר 2026 מול 2025 נראה כירידה של 6.5%, בעוד ינואר–אוגוסט —
    // אותם חודשים מלאים בשתי השנים — מראים 0.1%.
    const partial = partialMonth({ year, agent });
    const cmpMonths = partial ? lastMonth - 1 : lastMonth;
    // לשנה הראשונה במאגר אין מול מה להשוות. אפס אינו "לא קנו אשתקד" אלא
    // "איננו יודעים", ולכן כל לקוח היה נצבע כחדש והמחזור כולו כצמיחה.
    const hasPrior = Store.years().includes(priorYear);
    const current = byCustomer({ year, agent });
    const prior = byCustomer({ year: priorYear, agent });

    const customers = [];
    const seen = new Set([...current.keys(), ...prior.keys()]);
    seen.forEach((no) => {
      const cur = current.get(no);
      const prev = prior.get(no);
      const curMonths = cur ? cur.months : Array(12).fill(0);
      const prevMonths = prev ? prev.months : Array(12).fill(0);
      const ytd = upto(curMonths, cmpMonths);
      const priorYtd = upto(prevMonths, cmpMonths);
      const changePct = hasPrior ? change(ytd, priorYtd) : null;
      const sold = upto(curMonths, lastMonth);
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
        // מה שנמכר בפועל עד היום, כולל חודש חלקי — להצגה, לא להשוואה.
        sold,
        total: cur ? cur.total : 0,
        priorTotal: prev ? prev.total : 0,
        ytd,
        priorYtd,
        delta: hasPrior ? ytd - priorYtd : 0,
        changePct,
        activeMonths,
        lastActive,
        monthsSinceSale: lastActive ? lastMonth - lastActive : null,
        payers: cur ? [...cur.payers.entries()].sort((a, b) => b[1] - a[1]) : [],
        target: Store.target(no, year),
        isNew: hasPrior && !priorYtd && ytd > 0,
        isLost: hasPrior && priorYtd > 0 && ytd === 0,
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
      c.atRisk = hasPrior && !c.isBucket && c.priorYtd >= 5000
        && (c.ytd === 0 || (c.changePct !== null && c.changePct <= -35));
      // שקט על הקו: פעיל השנה, אך לא קנה בחודשיים האחרונים שנסגרו.
      c.isQuiet = !c.isBucket && c.ytd > 0
        && c.monthsSinceSale !== null && c.monthsSinceSale >= 2;
    });

    const atRisk = customers.filter((c) => c.atRisk).sort((a, b) => a.delta - b.delta);

    const growing = real
      .filter((c) => hasPrior && c.delta > 0 && c.priorYtd > 0)
      .sort((a, b) => b.delta - a.delta);

    const shrinking = real
      .filter((c) => hasPrior && c.delta < 0 && c.priorYtd > 0)
      .sort((a, b) => a.delta - b.delta);

    const quiet = customers.filter((c) => c.isQuiet).sort((a, b) => b.ytd - a.ytd);

    const monthsCur = monthly({ year, agent });
    const monthsPrior = monthly({ year: priorYear, agent });
    // ממוצע ותחזית נבנים על אותם חודשים מלאים.
    const fullTotal = sum(monthsCur.slice(0, cmpMonths));
    const runRate = cmpMonths ? (fullTotal / cmpMonths) * 12 : 0;
    const targetTotal = sum(customers.map((c) => c.target));

    return {
      year, priorYear, lastMonth, hasPrior,
      customers, active,
      totalYtd, totalPrior,
      changePct: hasPrior ? change(totalYtd, totalPrior) : null,
      delta: hasPrior ? totalYtd - totalPrior : null,
      priorFullYear: sum(monthsPrior),
      monthsCur, monthsPrior,
      avgMonth: cmpMonths ? fullTotal / cmpMonths : 0,
      partialMonth: partial,
      cmpMonths,
      // התקופה שההשוואה מדברת עליה, לשימוש בכותרות.
      cmpLabel: `ינואר–${Fmt.month(cmpMonths)}`,
      totalSold: sum(monthsCur.slice(0, lastMonth)),
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

  /* ------------------------------------------------------------ רב-שנתי ---
     חמש שנים אינן "עוד נתונים" אלא שאלה אחרת: לא כמה נמכר החודש, אלא לאן
     העסק הולך. שלוש צורות עונות עליה, ולכל אחת תפקיד משלה — סך שנתי (גודל),
     שנים-עשר חודשים מתגלגלים (מגמה בלי רעש עונתי), וחודש מול שנה (עונתיות). */

  /** סך המכירות בכל שנה, עם השינוי מול השנה שלפניה. */
  function yearly({ agent } = {}) {
    const years = Store.years();
    const out = years.map((year) => {
      const months = monthly({ year, agent });
      return { year, months, total: sum(months), closed: Store.closedMonth(year) };
    });
    out.forEach((row, i) => {
      const prior = out[i - 1];
      row.prior = prior ? prior.total : null;
      row.changePct = prior ? change(row.total, prior.total) : null;
      row.delta = prior ? row.total - prior.total : null;
      // שנה שעוד לא נסגרה אינה בת-השוואה לשנה מלאה, ולכן היא מסומנת ככזו.
      row.partial = row.closed < 12;
    });
    return out;
  }

  /**
   * שנים-עשר חודשים מתגלגלים: בכל נקודה, כמה נמכר בשנה שהסתיימה בה.
   * זו הצורה שמראה מגמה בלי שהעונתיות תצייר גלים שאין להם משמעות.
   */
  function rolling12({ agent } = {}) {
    const years = Store.years();
    const flat = [];
    years.forEach((year) => {
      const months = monthly({ year, agent });
      const closed = Store.closedMonth(year);
      months.slice(0, closed).forEach((value, i) => flat.push({ year, month: i + 1, value }));
    });
    return flat.map((point, i) => ({
      ...point,
      // רק נקודה שיש מאחוריה שנה שלמה מקבלת ערך; אחרת הקו היה מטפס
      // מאפס בתחילת הסדרה ומצייר "צמיחה" שלא קרתה.
      rolling: i >= 11 ? sum(flat.slice(i - 11, i + 1).map((p) => p.value)) : null,
    }));
  }

  /** מטריצת חודש מול שנה — הבסיס לגרף העונתיות. */
  function seasonality({ agent } = {}) {
    const years = Store.years();
    const rows = years.map((year) => ({
      year, months: monthly({ year, agent }), closed: Store.closedMonth(year),
    }));
    const max = Math.max(1, ...rows.flatMap((r) => r.months));
    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const values = rows.filter((r) => r.closed > i).map((r) => r.months[i]);
      return values.length ? sum(values) / values.length : 0;
    });
    return { rows, max, byMonth, avg: sum(byMonth) / 12 };
  }

  /** פילוח הסוכנים בכל שנה — אותם גוונים לאותו סוכן בכל השנים. */
  function agentYears({ agent } = {}) {
    const years = Store.years();
    const totals = new Map();
    Store.sales().forEach((s) => {
      if (agent && agent !== "all" && s.agent !== agent) return;
      totals.set(s.agent, (totals.get(s.agent) || 0) + s.a);
    });
    const order = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([no]) => no);
    const major = order.slice(0, 3);
    const rows = years.map((year) => {
      const split = new Map();
      rows_(year).forEach((s) => {
        const key = major.includes(s.agent) ? s.agent : "other";
        split.set(key, (split.get(key) || 0) + s.a);
      });
      const items = major.map((no, i) => ({
        no, name: Store.agentName(no), value: split.get(no) || 0, color: series(i),
      }));
      if (split.get("other")) {
        items.push({ no: "other", name: "סוכנים נוספים", value: split.get("other"),
                     color: series(3) });
      }
      return { year, items, total: sum(items.map((i) => i.value)) };
    });
    return { rows, major };

    function rows_(year) {
      return Store.sales().filter((s) => s.y === year
        && (!agent || agent === "all" || s.agent === agent));
    }
  }

  const series = (i) => (window.Charts ? Charts.series(i) : "");

  /**
   * מי צמח ומי נשחק לאורך השנים: השוואה בין השנה האחרונה שנסגרה לבין
   * השנה המקבילה לה חמש שנים קודם, על אותם חודשים בדיוק.
   */
  function trajectory({ agent } = {}) {
    const years = Store.years();
    if (years.length < 2) return { from: null, to: null, rising: [], falling: [] };
    const to = years[years.length - 1];
    const from = years[0];
    // אותם חודשים בדיוק בשתי השנים, ובלי חודש שהדוח תפס באמצעו.
    const partial = partialMonth({ year: to, agent });
    const months = Math.min(Store.closedMonth(to) - (partial ? 1 : 0),
                            Store.closedMonth(from));
    const book = catalog();
    const at = (year) => {
      const map = new Map();
      rows({ year, agent }).forEach((s) => {
        if (s.m <= months) map.set(s.c, (map.get(s.c) || 0) + s.a);
      });
      return map;
    };
    const first = at(from);
    const last = at(to);
    // מסלול כל לקוח לאורך השנים נבנה במעבר אחד על התנועות: מעבר ללקוח ולשנה
    // היה עולה מיליוני השוואות על חמש שנות נתונים.
    const path = new Map();
    const slot = new Map(years.map((year, i) => [year, i]));
    rows({ agent }).forEach((s) => {
      let line = path.get(s.c);
      if (!line) path.set(s.c, line = Array(years.length).fill(0));
      line[slot.get(s.y)] += s.a;
    });
    const list = [...new Set([...first.keys(), ...last.keys()])]
      .filter((no) => !book.buckets.has(no))
      .map((no) => {
        const start = first.get(no) || 0;
        const end = last.get(no) || 0;
        return { no, name: Store.partyName(no), start, end, delta: end - start,
                 changePct: change(end, start),
                 years: path.get(no) || Array(years.length).fill(0) };
      });
    return {
      from, to, months,
      rising: list.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta),
      falling: list.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta),
    };
  }

  /** מסלול כל לקוח לאורך השנים, במעבר אחד על התנועות. */
  function yearPaths({ agent } = {}) {
    const years = Store.years();
    const slot = new Map(years.map((year, i) => [year, i]));
    const map = new Map();
    rows({ agent }).forEach((s) => {
      let line = map.get(s.c);
      if (!line) map.set(s.c, line = Array(years.length).fill(0));
      line[slot.get(s.y)] += s.a;
    });
    return { years, map };
  }

  /** שורות שהדוח תמחר במטבע אחר — מסומנות, לא מוסתרות. */
  function foreign() {
    return Store.sales().filter((s) => s.cur).map((s) => ({
      ...s, name: Store.partyName(s.c),
    })).sort((a, b) => b.y - a.y || b.a - a.a);
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
           yearly, rolling12, seasonality, agentYears, trajectory, yearPaths, foreign,
           partialMonth,
           catalog, change, sum };
})();
