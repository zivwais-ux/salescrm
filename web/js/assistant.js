/* ============================================================================
   העוזר של BENY.

   זה אינו מודל שפה ואין לו גישה לרשת: הוא מנוע שאילתות שרץ על הנתונים
   שבמערכת. כל מספר בתשובה נשלף מהחישוב החי — ולכן הוא לא יכול להמציא נתון,
   וגם לא יכול לענות על שאלה שאין לה כיסוי בנתונים. כשהוא לא מבין, הוא אומר
   זאת ומציע שאלות שכן יש להן תשובה.
   ========================================================================== */
window.Assistant = (function () {
  const MONTHS = Fmt.MONTHS;

  /* ------------------------------------------------------------- עזרי שפה */
  const strip = (text) => String(text || "")
    .replace(/[֑-ׇ]/g, "")           // ניקוד
    .replace(/["'`״׳(),.?!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const has = (text, ...words) => words.some((w) => text.includes(w));

  /** מזהה שנה מפורשת בשאלה, אחרת השנה שנבחרה במסך. */
  function readYear(text, ctx) {
    const explicit = text.match(/\b(20\d{2})\b/);
    if (explicit) {
      const year = Number(explicit[1]);
      if (Store.years().includes(year)) return year;
    }
    if (has(text, "אשתקד", "שנה שעברה", "שעברה")) {
      const prior = ctx.year - 1;
      return Store.years().includes(prior) ? prior : ctx.year;
    }
    return ctx.year;
  }

  /** כל השנים שנזכרו בשאלה במפורש, לפי סדר הופעתן. */
  function readYears(text) {
    return [...new Set((text.match(/\b20\d{2}\b/g) || []).map(Number))]
      .filter((y) => Store.years().includes(y));
  }

  const TREND_WORDS = ["מגמה", "לאורך השנים", "לאורך הזמן", "כל השנים", "חמש שנים",
                       "היסטוריה", "שנים אחורה", "מאז"];

  /** מזהה חודש בשם או במספר. */
  function readMonth(text) {
    const index = MONTHS.findIndex((m) => text.includes(m));
    if (index >= 0) return index + 1;
    const short = Fmt.SHORT.findIndex((m) => new RegExp(`\\b${m}\\b`).test(text));
    return short >= 0 ? short + 1 : null;
  }

  /** מזהה סוכן לפי שם או חלק ממנו. */
  function readAgent(text) {
    return Store.state.agents.find((a) => {
      const parts = strip(a.name).split(" ").filter((w) => w.length > 2);
      return parts.some((w) => text.includes(w));
    }) || null;
  }

  /* מילים שמופיעות גם בשאלות וגם בשמות חברות. התאמה עליהן בלבד אינה זיהוי
     לקוח — בלעדיהן "מי הלקוחות הגדולים" נתפס כחברה בשם "לקוחות שונים". */
  const GENERIC = new Set(["לקוח", "לקוחות", "חברה", "חברת", "בעמ", "שונים", "כללי",
                           "ישראל", "השנה", "שנה", "חודש", "מכירות", "מחזור"]);

  /**
   * מזהה לקוח בשאלה. בוחר את ההתאמה החזקה ביותר, כדי ש"מור תעשיות פלסטיק"
   * לא ייתפס כחברה אחרת שגם בשמה "תעשיות", ותומך גם בחיפוש לפי מספר לקוח.
   */
  function readCustomer(text) {
    const byNumber = text.match(/\b(\d{8,10})\b/);
    if (byNumber && Store.party(byNumber[1])) return Store.party(byNumber[1]);

    let best = null;
    Store.parties().forEach((party) => {
      const name = strip(party.name);
      const words = name.split(" ")
        // מספר בתוך שם חברה ("תביעה משפטית 2024") אינו סימן מזהה: שנה בשאלה
        // היא שנה, ולא הלקוח ששמו נגמר באותו מספר.
        .filter((w) => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w));
      if (!words.length) return;
      const hits = words.filter((w) => text.includes(w));
      // דרוש לפחות סימן מזהה אחד באורך משמעותי, לא רק שבריר משותף.
      if (!hits.some((w) => w.length >= 4)) return;
      const score = hits.join("").length + (text.includes(name) ? 100 : 0);
      // ארבע אותיות הן שם חברה שלם ("קרגל"), ולכן הן די והותר לזיהוי.
      if (score >= 4 && (!best || score > best.score)) best = { party, score };
    });
    return best ? best.party : null;
  }

  /* --------------------------------------------------------- בניית תשובות */
  const chip = (no, label) => `<button class="ans-chip" data-open="${
    Fmt.escape(no)}">${Fmt.escape(label)}</button>`;

  function line(label, value) {
    return `<div class="ans-line"><span>${label}</span><b class="num">${value}</b></div>`;
  }

  function customerList(items, valueOf) {
    if (!items.length) return '<p class="ans-note">אין לקוחות שעונים על זה.</p>';
    return `<div class="ans-list">${items.map((c, i) => `
      <button class="ans-row" data-open="${Fmt.escape(c.no)}">
        <span class="rank">${i + 1}</span>
        <span class="grow ellipsis">${Fmt.escape(c.name)}</span>
        <span class="num">${valueOf(c)}</span>
      </button>`).join("")}</div>`;
  }

  /* ------------------------------------------------------------- שאלות */
  /**
   * כל ערך ברשימה: זיהוי, ותשובה שנבנית מהנתונים.
   * הסדר קובע — הכלל הראשון שמתאים הוא שעונה. כוונות רשימה מפורשות
   * ("מי דורש טיפול", "מי הגדולים") נבדקות לפני זיהוי שם לקוח, אחרת שאלה
   * כללית על לקוחות נתפסת כשאלה על חברה מסוימת.
   */
  const RULES = [
    {
      id: "risk",
      match: (t) => has(t, "סיכון", "דורש טיפול", "ירדו", "ירידה", "נטש", "עזב", "הפסיק"),
      answer(t, ctx) {
        const view = Metrics.overview(ctx);
        return {
          title: `${view.atRisk.length} לקוחות דורשים טיפול`,
          body: '<p class="ans-note">ירידה של 35% ומעלה מול אשתקד, או לקוח שהפסיק לקנות.</p>'
            + customerList(view.atRisk.slice(0, 8),
                (c) => `<span class="delta down">${Fmt.signed(c.delta)}</span>`)
            + (view.atRisk.length > 8
                ? '<button class="ans-chip" data-goto="dashboard">הרשימה המלאה</button>' : ""),
        };
      },
    },
    {
      id: "quiet",
      match: (t) => has(t, "שקט", "לא קנו", "לא קנה", "לא הזמין", "נעלמו"),
      answer(t, ctx) {
        const view = Metrics.overview(ctx);
        return {
          title: `${view.quiet.length} לקוחות שקטים`,
          body: '<p class="ans-note">פעילים השנה, אבל לא קנו חודשיים ומעלה.</p>'
            + customerList(view.quiet.slice(0, 8), (c) => Fmt.money(c.ytd)),
        };
      },
    },
    {
      id: "new",
      match: (t) => has(t, "חדשים", "חדש") && has(t, "לקוח", "לקוחות"),
      answer(t, ctx) {
        const view = Metrics.overview(ctx);
        return {
          title: `${view.newCustomers.length} לקוחות חדשים ב-${view.year}`,
          body: `<p class="ans-note">לא קנו ב-${view.priorYear}. סך הכול ${
            Fmt.money(Metrics.sum(view.newCustomers.map((c) => c.ytd)))}.</p>`
            + customerList(view.newCustomers.slice(0, 8), (c) => Fmt.money(c.ytd)),
        };
      },
    },
    {
      id: "growing",
      match: (t) => has(t, "צמח", "צומח", "עלו", "עלייה", "גדל", "השתפר"),
      answer(t, ctx) {
        const view = Metrics.overview(ctx);
        return {
          title: "הצמיחה הגדולה ביותר",
          body: `<p class="ans-note">תוספת בשקלים מול ${view.priorYear}.</p>`
            + customerList(view.growing.slice(0, 8),
                (c) => `<span class="delta up">${Fmt.signed(c.delta)}</span>`),
        };
      },
    },
    {
      id: "top",
      match: (t) => has(t, "גדול", "גדולים", "מוביל", "מובילים", "הכי"),
      answer(t, ctx) {
        const view = Metrics.overview(ctx);
        return {
          title: `הלקוחות הגדולים · ${view.year}`,
          body: customerList(view.top10, (c) => Fmt.money(c.ytd))
            + `<p class="ans-note">עשרת הגדולים הם ${
              view.top10Share.toFixed(0)}% מהמחזור.</p>`,
        };
      },
    },
    {
      id: "agents",
      match: (t) => has(t, "סוכנים", "לפי סוכן", "חלוקה"),
      answer(t, ctx) {
        const view = Metrics.overview(ctx);
        return {
          title: `פילוח לפי סוכן · ${view.year}`,
          body: view.byAgent.list.map((a) => line(Fmt.escape(a.name),
            `${Fmt.money(a.value)} · ${
              ((a.value / (view.byAgent.total || 1)) * 100).toFixed(1)}%`)).join(""),
        };
      },
    },
    {
      id: "forecast",
      match: (t) => has(t, "תחזית", "נסגור", "סוף השנה", "צפי"),
      answer(t, ctx) {
        const view = Metrics.overview(ctx);
        return {
          title: `תחזית לסוף ${view.year}`,
          body: line("לפי הקצב הנוכחי", Fmt.money(view.runRate))
            + line(`מכירות עד ${Fmt.month(view.lastMonth)}`, Fmt.money(view.totalYtd))
            + line(`כל ${view.priorYear}`, Fmt.money(view.priorFullYear))
            + `<p class="ans-note">התחזית היא ממוצע ${view.lastMonth} החודשים שנסגרו,
               מוכפל ב-12. אין בה עונתיות.</p>`,
        };
      },
    },
    {
      id: "customer",
      match: (t) => !!readCustomer(t),
      answer(t, ctx) {
        const party = readCustomer(t);
        const year = readYear(t, ctx);
        const view = Metrics.overview({ ...ctx, year });
        const row = view.customers.find((c) => c.no === party.no);
        if (!row || (!row.ytd && !row.priorYtd)) {
          return { title: `ל${party.name} אין תנועות ב-${year}`,
                   body: chip(party.no, "פתיחת הכרטיס") };
        }
        if (has(t, ...TREND_WORDS)) {
          const history = Metrics.customerHistory(party.no).slice().reverse();
          return {
            title: `${party.name} · לאורך השנים`,
            body: history.map((h) => line(String(h.year), Fmt.money(h.total))).join("")
              + chip(party.no, "פתיחת הכרטיס"),
          };
        }
        const month = readMonth(t);
        if (month) {
          return {
            title: `${party.name} · ${MONTHS[month - 1]} ${year}`,
            body: line("מכירות בחודש", Fmt.money(row.months[month - 1]))
              + line(`${MONTHS[month - 1]} ${year - 1}`, Fmt.money(row.priorMonths[month - 1]))
              + chip(party.no, "פתיחת הכרטיס"),
          };
        }
        return {
          title: `${party.name} · ${year}`,
          body: line(`מתחילת השנה (עד ${Fmt.month(view.lastMonth)})`, Fmt.money(row.sold))
            + line(view.cmpLabel, Fmt.money(row.ytd))
            + line(`${view.cmpLabel} ב-${year - 1}`, Fmt.money(row.priorYtd))
            + line("שינוי", row.changePct === null ? "לקוח חדש" : Fmt.percent(row.changePct, 1))
            + line(`חודשים פעילים מתוך ${view.lastMonth}`, String(row.activeMonths))
            + line("מכירה אחרונה", row.lastActive ? Fmt.month(row.lastActive) : "—")
            + (row.target ? line("יעד השנה", Fmt.money(row.target)) : "")
            + chip(party.no, "פתיחת הכרטיס"),
        };
      },
    },
    {
      id: "agent",
      match: (t) => !!readAgent(t) && has(t, "מכר", "מחזור", "כמה", "סוכן", "עשה"),
      answer(t, ctx) {
        const agent = readAgent(t);
        const year = readYear(t, ctx);
        const total = Metrics.sum(Metrics.rows({ year, agent: agent.no }).map((s) => s.a));
        const priorTotal = Metrics.sum(
          Metrics.rows({ year: year - 1, agent: agent.no }).map((s) => s.a));
        const customers = new Set(
          Metrics.rows({ year, agent: agent.no }).map((s) => s.c)).size;
        return {
          title: `${agent.name} · ${year}`,
          body: line("מחזור בשנה", Fmt.money(total))
            + line(`כל ${year - 1}`, Fmt.money(priorTotal))
            + line("לקוחות שקנו", Fmt.number(customers)),
        };
      },
    },
    {
      // השוואה בין שתי שנים שנאמרו במפורש. הבדיקה קודמת לשאלת ה"כמה" הכללית,
      // אחרת "כמה מכרנו ב-2022 לעומת 2025" היה נענה על שנה אחת בלבד.
      id: "compare",
      match: (t) => readYears(t).length >= 2,
      answer(t, ctx) {
        const [a, b] = readYears(t).sort((x, y) => x - y);
        const rows = Metrics.yearly({ agent: ctx.agent });
        const first = rows.find((r) => r.year === a);
        const second = rows.find((r) => r.year === b);
        const months = Math.min(first.closed, second.closed);
        const upto = (row) => Metrics.sum(row.months.slice(0, months));
        const partial = months < 12;
        return {
          title: `${a} מול ${b}`,
          body: line(`${a}${partial ? ` · ינואר–${Fmt.month(months)}` : ""}`,
              Fmt.money(upto(first)))
            + line(`${b}${partial ? ` · ינואר–${Fmt.month(months)}` : ""}`,
              Fmt.money(upto(second)))
            + line("שינוי", Fmt.percent(Metrics.change(upto(second), upto(first)), 1))
            + line("הפרש", Fmt.signed(upto(second) - upto(first)))
            + (partial ? `<p class="ans-note">ההשוואה על ${months} החודשים הראשונים
                 בכל שנה, כי ${b} עדיין נספרת.</p>` : "")
            + '<button class="ans-chip" data-goto="trend">מסך המגמה</button>',
        };
      },
    },
    {
      // תמונת חמש השנים. נבדקת אחרי זיהוי לקוח, כדי ש"מה המגמה של קרגל"
      // יישאר שאלה על קרגל.
      id: "trend",
      match: (t) => has(t, ...TREND_WORDS),
      answer(t, ctx) {
        const rows = Metrics.yearly({ agent: ctx.agent });
        const roll = Metrics.rolling12({ agent: ctx.agent });
        const last = roll[roll.length - 1] || {};
        const prev = roll[roll.length - 13] || {};
        return {
          title: `המגמה · ${rows[0].year}–${rows[rows.length - 1].year}`,
          body: rows.slice().reverse().map((r) => line(
            `${r.year}${r.partial ? ` (${r.closed} חודשים)` : ""}`,
            `${Fmt.money(r.total)}${r.changePct === null ? ""
              : ` · ${Fmt.percent(r.changePct, 1)}`}`)).join("")
            + (last.rolling ? `<p class="ans-note">שנים-עשר החודשים האחרונים:
                ${Fmt.money(last.rolling)}${prev.rolling
                  ? `, מול ${Fmt.money(prev.rolling)} ב-12 שלפניהם` : ""}.</p>` : "")
            + '<button class="ans-chip" data-goto="trend">מסך המגמה</button>',
        };
      },
    },
    {
      id: "month",
      match: (t) => !!readMonth(t) && has(t, "כמה", "מכרנו", "מחזור", "היה", "מכירות"),
      answer(t, ctx) {
        const month = readMonth(t);
        const year = readYear(t, ctx);
        const view = Metrics.overview({ ...ctx, year });
        const cur = view.monthsCur[month - 1];
        const prev = view.monthsPrior[month - 1];
        return {
          title: `${MONTHS[month - 1]} ${year}`,
          body: line("סך המכירות", Fmt.money(cur))
            + line(`${MONTHS[month - 1]} ${year - 1}`, Fmt.money(prev))
            + line("שינוי", Fmt.percent(Metrics.change(cur, prev), 1)),
        };
      },
    },
    {
      id: "total",
      match: (t) => has(t, "כמה", "מחזור", "סך", "סהכ", "מכרנו", "מכירות"),
      answer(t, ctx) {
        const year = readYear(t, ctx);
        const view = Metrics.overview({ ...ctx, year });
        return {
          title: `מכירות ${year}`,
          body: line(`מתחילת השנה (עד ${Fmt.month(view.lastMonth)})`, Fmt.money(view.totalSold))
            + line(`${view.cmpLabel}`, Fmt.money(view.totalYtd))
            + line(`${view.cmpLabel} ב-${year - 1}`, Fmt.money(view.totalPrior))
            + line("שינוי", Fmt.percent(view.changePct, 1))
            + line("לקוחות פעילים", Fmt.number(view.active.length))
            + line("ממוצע לחודש", Fmt.money(view.avgMonth))
            + (view.partialMonth ? `<p class="ans-note">${Fmt.month(view.partialMonth)}
                ${year} עדיין חלקי בדוח, ולכן ההשוואה היא על ${view.cmpMonths}
                החודשים המלאים בשתי השנים.</p>` : ""),
        };
      },
    },
  ];

  const SUGGESTIONS = [
    "כמה מכרנו השנה?",
    "מי דורש טיפול?",
    "מי הלקוחות הגדולים?",
    "מי לא קנה חודשיים?",
    "כמה מכר קונברפלקס?",
    "מה המגמה בחמש השנים?",
    "כמה מכרנו ב-2022 לעומת 2025?",
    "מה התחזית לסוף השנה?",
  ];

  /** מקבל שאלה ומחזיר תשובה שנבנתה מהנתונים, או הודעת "לא הבנתי". */
  function ask(question, ctx) {
    const text = strip(question);
    if (!text) return null;
    const rule = RULES.find((r) => {
      try { return r.match(text, ctx); } catch (err) { return false; }
    });
    if (!rule) {
      return {
        title: "לא הצלחתי לפענח את השאלה",
        body: '<p class="ans-note">אני עונה רק ממה שיש בנתונים, ולא ממציא. '
          + 'אפשר לנסות כך:</p>'
          + `<div class="ans-suggest">${SUGGESTIONS.map((q) => (
              `<button class="ans-chip" data-ask="${Fmt.escape(q)}">${
                Fmt.escape(q)}</button>`)).join("")}</div>`,
        unmatched: true,
      };
    }
    return { ...rule.answer(text, ctx), rule: rule.id };
  }

  return { ask, SUGGESTIONS };
})();
