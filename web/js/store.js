/* ============================================================================
   שכבת הנתונים.

   הכול נשמר במחשב של המשתמש (localStorage), ונטען בפעם הראשונה מקובץ
   dataset.js שנבנה מדוחות ה-PDF. אין שרת ואין חשבון להקים: פותחים את
   הכתובת והמערכת עובדת, גם בלי אינטרנט. הגיבוי והניוד הם קובץ האקסל.
   ========================================================================== */
window.Store = (function () {
  const cfg = window.APP_CONFIG;
  const listeners = new Set();

  const state = {
    agents: [],
    parties: new Map(),   // party_no -> { no, name, profile }
    sales: new Map(),     // key(c,p,agent,y,m) -> { c, p, agent, y, m, a, source }
    targets: new Map(),   // `${no}|${year}` -> amount
    activities: [],
    // שם המערכת והסניף ניתנים לעריכה מתוך האפליקציה, ולכן הם חלק מהמצב
    // שנשמר ומגובה — ולא קבועים בקוד.
    settings: {},
    savedAt: null,
    seedVersion: 0,
  };

  // אותו צמד לקוח–משלם יכול להופיע באותו חודש אצל שני סוכנים, ולכן הסוכן הוא
  // חלק מזהות התנועה ולא רק תכונה שלה. אותו צמד גם מופיע פעמיים באותו חודש
  // כששורה אחת תומחרה במטבע אחר — ולכן גם המטבע מזהה, אחרת שורה אחת דורסת
  // את השנייה והסכום השנתי מפסיק להתאים לדוח.
  const saleKey = (c, p, agent, y, m, cur) => (
    `${c}|${p}|${agent}|${y}|${m}${cur ? `|${cur}` : ""}`);
  const defaultAgent = () => (state.agents[0] || {}).no;
  const emptyProfile = () => ({ status: "active", tier: "", segment: "", contact_name: "",
                                contact_phone: "", contact_email: "", notes: "" });

  function notify() {
    listeners.forEach((fn) => fn(state));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error("לא ניתן לטעון את ספריית האקסל"));
      document.head.appendChild(el);
    });
  }

  /* אחסון הדפדפן זורק שגיאה בחלון פרטי או כשאחסון חסום, ולכן כל גישה
     עוברת דרך העטיפות האלה והמערכת ממשיכה לעבוד גם בלעדיהן. */
  function readStorage(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.warn("שמירה מקומית נכשלה", err);
      return false;
    }
  }

  /**
   * פורש את קובץ הזינוך. הוא דחוס — סוכנים ולקוחות מופיעים פעם אחת,
   * וכל תנועה מפנה אליהם לפי מיקום ברשימה:
   *   [מיקום הלקוח, מיקום המשלם, מיקום הסוכן, שנה, חודש, סכום]
   */
  function seedSales() {
    const seed = window.GADOT_DATASET;
    const partyNo = seed.parties.map(([no]) => no);
    const agentNo = seed.agents.map(([no]) => no);
    return seed.sales.map(([c, p, agent, y, m, a, cur]) => {
      const sale = { c: partyNo[c], p: partyNo[p], agent: agentNo[agent],
                     y, m, a, source: "erp" };
      // הדוח מתמחר מעט שורות במטבע אחר ומחבר אותן לסיכומים כמו שהן. השורה
      // נושאת את המטבע שלה כדי שמסך הנתונים יוכל להצביע עליהן.
      if (cur) sale.cur = cur;
      return sale;
    });
  }

  function seedFromDataset() {
    const seed = window.GADOT_DATASET;
    state.agents = seed.agents.map(([no, name]) => ({ no, name }));
    state.parties = new Map(seed.parties.map(([no, name]) => [
      no, { no, name, profile: emptyProfile() },
    ]));
    state.sales = new Map(seedSales().map((sale) => [
      saleKey(sale.c, sale.p, sale.agent, sale.y, sale.m, sale.cur), sale]));
    state.targets = new Map();
    state.activities = [];
    state.settings = {};
    state.seedVersion = seed.seed_version || 1;
  }

  /**
   * זרע חדש על נתונים שכבר שמורים בדפדפן.
   *
   * דוח חדש מוסיף שנים ומתקן קריאה של שנים קיימות, אבל מה שנרשם כאן ביד —
   * עריכות, יעדים, פרטי לקוחות ורישומי פעילות — אינו נמצא באף דוח ואסור לו
   * להימחק. ולכן: שורות ה-ERP מוחלפות במלואן, ושורה שאדם הקליד גוברת על
   * שורת הדוח באותו מפתח.
   */
  function mergeSeed() {
    const had = new Set([...state.sales.values()].map((s) => s.y));
    const manual = [...state.sales.values()].filter((s) => s.source === "manual");
    state.sales = new Map(seedSales().map((sale) => [
      saleKey(sale.c, sale.p, sale.agent, sale.y, sale.m, sale.cur), sale]));
    manual.forEach((s) => state.sales.set(
      saleKey(s.c, s.p, s.agent, s.y, s.m, s.cur), s));

    const seed = window.GADOT_DATASET;
    state.agents = seed.agents.map(([no, name]) => ({ no, name }));
    seed.parties.forEach(([no, name]) => {
      const held = state.parties.get(no);
      // שם שהמשתמש שינה ביד נשאר שלו; שאר הלקוחות מקבלים את שם הדוח האחרון.
      if (!held) state.parties.set(no, { no, name, profile: emptyProfile() });
      else if (!held.renamed) held.name = name;
    });
    state.seedVersion = seed.seed_version || 1;
    return { years: seed.years.filter((y) => !had.has(y)), kept: manual.length };
  }

  function serialize() {
    return {
      version: 2,
      agents: state.agents,
      parties: [...state.parties.values()],
      sales: [...state.sales.values()],
      targets: [...state.targets.entries()],
      activities: state.activities,
      settings: state.settings,
      seedVersion: state.seedVersion,
      savedAt: new Date().toISOString(),
    };
  }

  function hydrate(raw) {
    state.agents = raw.agents || [];
    state.parties = new Map((raw.parties || []).map((p) => [
      p.no, { ...p, profile: { ...emptyProfile(), ...(p.profile || {}) } },
    ]));
    state.sales = new Map((raw.sales || []).map((s) => [
      saleKey(s.c, s.p, s.agent, s.y, s.m, s.cur), s]));
    state.targets = new Map(raw.targets || []);
    state.activities = raw.activities || [];
    state.settings = raw.settings || {};
    state.savedAt = raw.savedAt || null;
    state.seedVersion = raw.seedVersion || 0;
  }

  function persist() {
    state.savedAt = new Date().toISOString();
    writeStorage(cfg.storageKey, JSON.stringify(serialize()));
  }

  /** בונה מחדש את מפת התנועות אחרי שינוי שנוגע למפתח שלהן. */
  function rewriteSales(change) {
    const next = new Map();
    state.sales.forEach((sale) => {
      const row = change(sale);
      next.set(saleKey(row.c, row.p, row.agent, row.y, row.m, row.cur), row);
    });
    state.sales = next;
  }

  /* --------------------------------------------------------- היסטוריית ביטול */
  // מחזיקים את התמונה שלפני כל שינוי, כדי שטעות בהקלדה לא תעלה בנתונים.
  const undoStack = [];

  function snapshot(label) {
    undoStack.push({ label, data: JSON.stringify(serialize()) });
    // כל צילום הוא עותק מלא של המצב, וחמש שנות תנועות שוקלות. שתים־עשרה
    // פעולות אחורה מכסות כל טעות הקלדה סבירה בלי להחזיק עשרות עותקים בזיכרון.
    if (undoStack.length > 12) undoStack.shift();
  }

  /** כל שינוי עובר כאן: צילום מצב, ביצוע, שמירה, רענון המסך. */
  function commit(label, work) {
    snapshot(label);
    work();
    persist();
    notify();
  }

  const api = {
    state,

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    init() {
      const saved = readStorage(cfg.storageKey);
      if (saved) {
        try { hydrate(JSON.parse(saved)); } catch (err) { seedFromDataset(); }
      } else {
        seedFromDataset();
      }
      const seed = window.GADOT_DATASET;
      if (state.seedVersion < (seed.seed_version || 1)) {
        state.merged = saved ? mergeSeed() : null;
      }
      persist();
      notify();
      return state;
    },

    /* --------------------------------------------------------------- קריאה */
    parties: () => [...state.parties.values()],
    party: (no) => state.parties.get(no),
    partyName: (no) => (state.parties.get(no) || {}).name || no,
    sales: () => [...state.sales.values()],
    agentName(no) {
      const agent = state.agents.find((a) => a.no === no);
      return agent ? agent.name : `סוכן ${no}`;
    },
    years() {
      return [...new Set([...state.sales.values()].map((s) => s.y))].sort();
    },
    lastMonth(year) {
      const months = [...state.sales.values()]
        .filter((s) => s.y === year && s.a).map((s) => s.m);
      return months.length ? Math.max(...months) : 12;
    },
    target: (no, year) => state.targets.get(`${no}|${year}`) || 0,

    /** שם המערכת והסניף — מה שנערך גובר על ברירת המחדל שבקוד. */
    settings: () => ({ name: cfg.name, branch: cfg.branch, ...state.settings }),

    setSettings(patch) {
      commit("עדכון שם המערכת", () => {
        state.settings = { ...state.settings, ...patch };
      });
    },

    /** השנים שהדוחות מכסים, גם אם אין להן עדיין תנועות במערכת. */
    seedYears: () => (window.GADOT_DATASET.years || []).slice(),

    /**
     * עד איזה חודש השנה נספרת.
     *
     * הדוח קובע את הרצפה, אבל חודש שהוזן ביד מרחיב אותה: מרגע שנרשמה מכירה
     * באוקטובר, אוקטובר הוא חלק מהתקופה בכל המסכים. בלי זה נתון שהוזן היה
     * נשמר במערכת ולא נספר בשום סיכום.
     */
    closedMonth(year) {
      const closed = (window.GADOT_DATASET.last_closed_month || {})[String(year)] || 0;
      const entered = [...state.sales.values()]
        .filter((s) => s.y === year && s.a).map((s) => s.m);
      return Math.max(closed, entered.length ? Math.max(...entered) : 0) || 12;
    },

    /**
     * המשלם והסוכן שרשומים ללקוח בתנועה האחרונה שלו.
     *
     * הזנה חדשה נשענת עליהם כברירת מחדל, אחרת אותו לקוח היה מתפצל לשתי
     * שורות — אחת של הדוח ואחת של ההזנה — ומפסיק להצטבר לשורה אחת.
     */
    lastKnown(customerNo) {
      let best = null;
      state.sales.forEach((sale) => {
        if (sale.c !== customerNo) return;
        if (!best || sale.y > best.y || (sale.y === best.y && sale.m > best.m)) best = sale;
      });
      return { payer: best ? best.p : customerNo,
               agent: best ? best.agent : defaultAgent() };
    },

    /** סיכומי הבקרה כפי שהודפסו בדוח המקורי, לפי שנה. */
    control: (year) => ((window.GADOT_DATASET.control || {})[String(year)] || null),

    /* --------------------------------------------------------------- כתיבה */
    setSale(customerNo, payerNo, year, month, amount, agentNo) {
      const agent = agentNo || defaultAgent();
      const key = saleKey(customerNo, payerNo, agent, year, month);
      const value = Math.round(Fmt.parseAmount(amount) * 100) / 100;
      commit(`עדכון ${Fmt.month(month)} · ${api.partyName(customerNo)}`, () => {
        if (!value) {
          state.sales.delete(key);
          return;
        }
        // ערך שאדם הקליד הוא ידני מכאן והלאה, מה שמבדיל אותו בייצוא.
        state.sales.set(key, { c: customerNo, p: payerNo, agent, y: year, m: month,
                               a: value, source: "manual" });
      });
    },

    /**
     * הזנה של חודש שלם בפעולה אחת.
     *
     * שורה אחת בהיסטוריית הביטול לכל החודש, ולא אחת לכל לקוח: מי שהזין
     * ארבעים לקוחות ורוצה לחזור בו מתכוון לחודש, לא לשורה הארבעים.
     */
    setMonth(year, month, rows, label) {
      commit(label || `הזנת ${Fmt.month(month)} ${year}`, () => {
        rows.forEach((row) => {
          const c = String(row.c).trim();
          const p = String(row.p || c).trim();
          const agent = row.agent || defaultAgent();
          const value = Math.round(Fmt.parseAmount(row.a) * 100) / 100;
          const key = saleKey(c, p, agent, year, month);
          if (!value) state.sales.delete(key);
          else {
            state.sales.set(key, { c, p, agent, y: year, m: month, a: value,
                                   source: "manual" });
          }
        });
      });
    },

    /**
     * ייבוא של ייצוא מה-ERP — קובץ שנגרר פנימה או טבלה שהודבקה.
     *
     * חודש שמגיע בייבוא מוחלף במלואו ולא מתמזג: הייצוא הוא התמונה המלאה של
     * אותו חודש, ומיזוג היה משאיר מתחת לחדש שורות ישנות של לקוחות שירדו
     * מהדוח, או כפילות של אותה מכירה תחת סוכן שהשתנה. לקוחות וסוכנים שאינם
     * מוכרים נפתחים כאן, אחרת השורה היתה נכנסת בלי שם.
     *
     * הכול בפעולת ביטול אחת: מי שייבא את החודש הלא נכון מבטל אותו, לא
     * מאה שורות.
     */
    applyImport(payload, label) {
      const months = payload.months || [];
      commit(label || `ייבוא ${months.length} חודשים`, () => {
        (payload.parties || []).forEach((party) => {
          const no = String(party.no).trim();
          if (!no || state.parties.has(no)) return;
          state.parties.set(no, { no, name: String(party.name || no).trim() || no,
                                  profile: emptyProfile() });
        });
        (payload.agents || []).forEach((agent) => {
          const no = String(agent.no).trim();
          if (!no || state.agents.some((a) => a.no === no)) return;
          state.agents = [...state.agents, { no, name: String(agent.name || no).trim() || no }];
        });
        months.forEach((month) => {
          const y = Number(month.year);
          const m = Number(month.month);
          [...state.sales.entries()].forEach(([key, sale]) => {
            if (sale.y === y && sale.m === m) state.sales.delete(key);
          });
          (month.rows || []).forEach((row) => {
            const c = String(row.c).trim();
            const p = String(row.p || c).trim();
            const agent = String(row.agent || "").trim() || defaultAgent();
            const cur = String(row.cur || "").trim();
            const a = Math.round(Fmt.parseAmount(row.a) * 100) / 100;
            // שורה באפס נשמרת: הדוח הדפיס את הלקוח באותו חודש, וזו עובדה
            // שונה מ"לא הופיע בכלל". רק שורה בלי לקוח אינה שורה.
            if (!c) return;
            const key = saleKey(c, p, agent, y, m, cur);
            const held = state.sales.get(key);
            // אותו מפתח פעמיים בקובץ מצטבר, כדי שסכום החודש יישאר כפי שהודפס.
            state.sales.set(key, { c, p, agent, y, m, cur: cur || undefined,
                                   a: held ? Math.round((held.a + a) * 100) / 100 : a,
                                   source: "import" });
          });
        });
      });
    },

    /* ---------------------------------------------------------------- סוכנים
       הדוח מביא את הסוכנים שיש בו, אבל תיק מתחלף: סוכן חדש מתחיל, סוכן ותיק
       עוזב, ושם נכתב בטעות. שלוש הפעולות האלה מחזיקות את הרשימה מעודכנת בלי
       לגעת בתנועות עצמן, חוץ מהעברה מפורשת של תיק. */
    addAgent(no, name) {
      const id = String(no).trim();
      if (!id) throw new Error("צריך מספר סוכן");
      if (state.agents.some((a) => a.no === id)) throw new Error("מספר הסוכן כבר קיים");
      commit(`הוספת ${name || id}`, () => {
        state.agents = [...state.agents, { no: id, name: String(name).trim() || id }];
      });
    },

    renameAgent(no, name) {
      const agent = state.agents.find((a) => a.no === no);
      if (!agent || !String(name).trim() || String(name).trim() === agent.name) return;
      commit(`שינוי שם ${agent.name}`, () => { agent.name = String(name).trim(); });
    },

    /** מחיקת סוכן. תנועות שלו עוברות לסוכן אחר, או נמחקות אם לא נבחר יעד. */
    removeAgent(no, moveTo) {
      const agent = state.agents.find((a) => a.no === no);
      if (!agent) return;
      commit(`מחיקת ${agent.name}`, () => {
        state.agents = state.agents.filter((a) => a.no !== no);
        [...state.sales.entries()].forEach(([saleKeyValue, sale]) => {
          if (sale.agent !== no) return;
          state.sales.delete(saleKeyValue);
          if (!moveTo) return;
          const moved = { ...sale, agent: moveTo };
          state.sales.set(saleKey(moved.c, moved.p, moveTo, moved.y, moved.m, moved.cur),
                          moved);
        });
      });
    },

    /** מספר לקוח שהשתנה בדוח — כל מה שתלוי בו עובר איתו. */
    changePartyNumber(oldNo, newNo) {
      const id = String(newNo).trim();
      const party = state.parties.get(oldNo);
      if (!party) throw new Error("הלקוח לא נמצא");
      if (!id) throw new Error("צריך מספר לקוח");
      if (id === oldNo) return;
      if (state.parties.has(id)) throw new Error("המספר כבר שייך ללקוח אחר");
      commit(`שינוי מספר ${party.name}`, () => {
        state.parties.delete(oldNo);
        state.parties.set(id, { ...party, no: id });
        rewriteSales((sale) => ({
          ...sale,
          c: sale.c === oldNo ? id : sale.c,
          p: sale.p === oldNo ? id : sale.p,
        }));
        [...state.targets.entries()].forEach(([targetKey, value]) => {
          const [partyNo, year] = targetKey.split("|");
          if (partyNo !== oldNo) return;
          state.targets.delete(targetKey);
          state.targets.set(`${id}|${year}`, value);
        });
        state.activities.forEach((row) => {
          if (row.party_no === oldNo) row.party_no = id;
        });
      });
    },

    /**
     * איחוד שני לקוחות.
     *
     * הדוח מדפיס לפעמים את אותה חברה תחת שני מספרי חשבון. מי שיודע שמדובר
     * באותה חברה יכול לאחד אותם, והסכומים מצטברים לשורה אחת לכל חודש.
     */
    mergeParty(fromNo, intoNo) {
      const from = state.parties.get(fromNo);
      const into = state.parties.get(intoNo);
      if (!from || !into || fromNo === intoNo) throw new Error("צריך שני לקוחות שונים");
      commit(`איחוד ${from.name} לתוך ${into.name}`, () => {
        const merged = new Map();
        state.sales.forEach((sale) => {
          const row = { ...sale,
                        c: sale.c === fromNo ? intoNo : sale.c,
                        p: sale.p === fromNo ? intoNo : sale.p };
          const id = saleKey(row.c, row.p, row.agent, row.y, row.m, row.cur);
          const held = merged.get(id);
          // שתי שורות שהופכות לאותו מפתח מצטברות; אחרת אחת היתה דורסת את השנייה.
          merged.set(id, held
            ? { ...held, a: Math.round((held.a + row.a) * 100) / 100,
                source: held.source === "erp" && row.source === "erp" ? "erp" : "manual" }
            : row);
        });
        state.sales = merged;
        state.parties.delete(fromNo);
        [...state.targets.entries()].forEach(([targetKey, value]) => {
          const [partyNo, year] = targetKey.split("|");
          if (partyNo !== fromNo) return;
          state.targets.delete(targetKey);
          const target = `${intoNo}|${year}`;
          state.targets.set(target, (state.targets.get(target) || 0) + value);
        });
        state.activities.forEach((row) => {
          if (row.party_no === fromNo) row.party_no = intoNo;
        });
      });
    },

    /** מחיקת כל התנועות של חודש, או של שנה שלמה. */
    deletePeriod(year, month) {
      const label = month ? `${Fmt.month(month)} ${year}` : String(year);
      commit(`מחיקת ${label}`, () => {
        [...state.sales.entries()].forEach(([saleKeyValue, sale]) => {
          if (sale.y === year && (!month || sale.m === month)) state.sales.delete(saleKeyValue);
        });
      });
    },

    /** שנה שלמה של לקוח אחד — שנים-עשר חודשים בפעולת ביטול אחת. */
    setCustomerYear(customerNo, year, months, label) {
      const known = api.lastKnown(customerNo);
      commit(label || `עדכון ${year} · ${api.partyName(customerNo)}`, () => {
        Object.entries(months).forEach(([month, raw]) => {
          const m = Number(month);
          const value = Math.round(Fmt.parseAmount(raw) * 100) / 100;
          const key = saleKey(customerNo, known.payer, known.agent, year, m);
          if (!value) state.sales.delete(key);
          else {
            state.sales.set(key, { c: customerNo, p: known.payer, agent: known.agent,
                                   y: year, m, a: value, source: "manual" });
          }
        });
      });
    },

    /** יעדים של שנה — שורה אחת בהיסטוריית הביטול לכל הרשימה. */
    setTargets(year, rows, label) {
      commit(label || `עדכון יעדי ${year}`, () => {
        rows.forEach((row) => {
          const value = Math.round(Fmt.parseAmount(row.value) * 100) / 100;
          if (value) state.targets.set(`${row.no}|${year}`, value);
          else state.targets.delete(`${row.no}|${year}`);
        });
      });
    },

    addParty(no, name) {
      const id = String(no).trim();
      if (!id) throw new Error("צריך מספר לקוח");
      if (state.parties.has(id)) throw new Error("מספר הלקוח כבר קיים במערכת");
      commit(`הוספת ${name || id}`, () => {
        state.parties.set(id, { no: id, name: name.trim() || id, profile: emptyProfile() });
      });
    },

    renameParty(no, name) {
      const party = state.parties.get(no);
      if (!party || !name.trim() || name.trim() === party.name) return;
      commit(`שינוי שם ${party.name}`, () => {
        party.name = name.trim();
        // מסומן כשם של אדם, כדי שדוח חדש לא ידרוס אותו בחזרה.
        party.renamed = true;
      });
    },

    deleteParty(no) {
      const name = api.partyName(no);
      commit(`מחיקת ${name}`, () => {
        state.parties.delete(no);
        [...state.sales.entries()].forEach(([key, sale]) => {
          if (sale.c === no || sale.p === no) state.sales.delete(key);
        });
        state.activities = state.activities.filter((a) => a.party_no !== no);
      });
    },

    updateProfile(no, patch) {
      const party = state.parties.get(no);
      if (!party) return;
      commit(`עדכון ${party.name}`, () => {
        party.profile = { ...party.profile, ...patch };
      });
    },

    setTarget(no, year, amount) {
      const value = Fmt.parseNumber(amount);
      commit(`יעד ${api.partyName(no)}`, () => {
        if (value) state.targets.set(`${no}|${year}`, value);
        else state.targets.delete(`${no}|${year}`);
      });
    },

    addActivity(activity) {
      const row = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        party_no: activity.party_no,
        happened_on: activity.happened_on || new Date().toISOString().slice(0, 10),
        kind: activity.kind || "note",
        title: activity.title,
        body: activity.body || "",
        follow_up_on: activity.follow_up_on || null,
        done: false,
      };
      commit("רישום פעילות", () => { state.activities.unshift(row); });
      return row;
    },

    /** עדכון רישום קיים — תאריך מעקב, כותרת או פירוט. */
    updateActivity(id, patch) {
      const row = state.activities.find((a) => a.id === id);
      if (!row) return;
      commit(`עדכון ${row.title}`, () => Object.assign(row, patch));
    },

    /** דחיית מעקב בימים, מהיום או מתאריך המעקב — המאוחר מביניהם. */
    snoozeActivity(id, days) {
      const row = state.activities.find((a) => a.id === id);
      if (!row) return;
      const today = new Date().toISOString().slice(0, 10);
      const base = new Date(row.follow_up_on && row.follow_up_on > today
        ? row.follow_up_on : today);
      base.setDate(base.getDate() + days);
      const next = base.toISOString().slice(0, 10);
      commit(`דחיית ${row.title}`, () => {
        row.follow_up_on = next;
        row.done = false;
      });
      return next;
    },

    toggleActivity(id) {
      const row = state.activities.find((a) => a.id === id);
      if (!row) return;
      commit(row.done ? "החזרת משימה" : "סימון משימה", () => { row.done = !row.done; });
    },

    deleteActivity(id) {
      commit("מחיקת רישום", () => {
        state.activities = state.activities.filter((a) => a.id !== id);
      });
    },

    /** מייבא שורות מאקסל: [{customer_no, payer_no, year, month, amount}] */
    importRows(rows) {
      commit(`ייבוא ${rows.length} שורות`, () => {
        rows.forEach((row) => {
          const c = String(row.customer_no || "").trim();
          const p = String(row.payer_no || c).trim();
          const y = Number(row.year);
          const m = Number(row.month);
          const a = Math.round(Fmt.parseNumber(row.amount) * 100) / 100;
          if (!c || !y || !m) return;
          if (!state.parties.has(c)) {
            state.parties.set(c, { no: c, name: row.customer_name || c,
                                   profile: emptyProfile() });
          }
          if (!state.parties.has(p)) {
            state.parties.set(p, { no: p, name: row.payer_name || p,
                                   profile: emptyProfile() });
          }
          const agent = row.agent_no || defaultAgent();
          const key = saleKey(c, p, agent, y, m);
          if (!a) state.sales.delete(key);
          else state.sales.set(key, { c, p, agent, y, m, a, source: "manual" });
        });
      });
    },

    /* ---------------------------------------------------------- ביטול ואיפוס */
    canUndo: () => undoStack.length > 0,
    lastAction: () => (undoStack.length ? undoStack[undoStack.length - 1].label : ""),

    undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      hydrate(JSON.parse(entry.data));
      persist();
      notify();
      return entry.label;
    },

    resetToSeed() {
      commit("איפוס הנתונים", seedFromDataset);
    },

    /** ייצוא מלא של מצב המערכת — גיבוי שאפשר לטעון בחזרה. */
    exportState: () => JSON.stringify(serialize(), null, 1),

    importState(json) {
      const raw = JSON.parse(json);
      if (!raw.parties || !raw.sales) throw new Error("הקובץ אינו גיבוי של המערכת");
      commit("טעינת גיבוי", () => hydrate(raw));
    },

    loadScript,
  };

  return api;
})();
