/* ============================================================================
   שכבת הנתונים.

   שני מצבי עבודה:
     • מקומי  - כל הנתונים בדפדפן (localStorage), נטענים בפעם הראשונה מקובץ
                dataset.js שנבנה מדוחות ה-PDF. עובד גם בלי אינטרנט.
     • Supabase - אותם נתונים בענן. כל שינוי נכתב מיד לטבלאות, וכל מכשיר
                  שמתחבר לאותו פרויקט רואה את אותה תמונה.

   בשני המצבים ה-API זהה, כך שהמסכים לא יודעים מי עומד מאחור.
   ========================================================================== */
window.Store = (function () {
  const cfg = window.APP_CONFIG;
  const listeners = new Set();

  const state = {
    backend: "local",           // local | supabase
    status: "מקומי",
    agents: [],
    parties: new Map(),         // party_no -> { no, name, profile }
    sales: new Map(),           // key(c,p,agent,y,m) -> { c, p, agent, y, m, a, source }
    targets: new Map(),         // `${no}|${year}` -> amount
    activities: [],
    dirty: false,
  };

  // The same customer/payer pair can appear under two agents in the same month,
  // so the agent is part of a sale's identity.
  const saleKey = (c, p, agent, y, m) => `${c}|${p}|${agent}|${y}|${m}`;
  const defaultAgent = () => (state.agents[0] || {}).no;
  const emptyProfile = () => ({ status: "active", tier: "", segment: "", contact_name: "",
                                contact_phone: "", contact_email: "", notes: "" });

  /* ------------------------------------------------------------ helpers -- */
  function notify() {
    listeners.forEach((fn) => fn(state));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`טעינת ${src} נכשלה`));
      document.head.appendChild(el);
    });
  }

  function settings() {
    try {
      return JSON.parse(localStorage.getItem(`${cfg.storageKey}_settings`) || "{}");
    } catch (err) {
      return {};
    }
  }

  function saveSettings(patch) {
    const next = { ...settings(), ...patch };
    localStorage.setItem(`${cfg.storageKey}_settings`, JSON.stringify(next));
    return next;
  }

  function credentials() {
    const saved = settings();
    return {
      url: saved.supabaseUrl || cfg.supabaseUrl,
      key: saved.supabaseAnonKey || cfg.supabaseAnonKey,
    };
  }

  /* --------------------------------------------------------- seed / local */
  function seedFromDataset() {
    const seed = window.GADOT_DATASET;
    state.agents = seed.agents.slice();
    state.parties = new Map(seed.parties.map((p) => [p.no, { ...p, profile: emptyProfile() }]));
    state.sales = new Map(seed.sales.map((s) => [
      saleKey(s.c, s.p, s.agent, s.y, s.m),
      { c: s.c, p: s.p, agent: s.agent, y: s.y, m: s.m, a: s.a, source: "erp" },
    ]));
    state.targets = new Map();
    state.activities = [];
  }

  function serialize() {
    return {
      version: 1,
      agents: state.agents,
      parties: [...state.parties.values()],
      sales: [...state.sales.values()],
      targets: [...state.targets.entries()],
      activities: state.activities,
    };
  }

  function hydrate(raw) {
    state.agents = raw.agents || [];
    state.parties = new Map((raw.parties || []).map((p) => [
      p.no, { ...p, profile: { ...emptyProfile(), ...(p.profile || {}) } },
    ]));
    state.sales = new Map((raw.sales || []).map((s) => [
      saleKey(s.c, s.p, s.agent, s.y, s.m), s]));
    state.targets = new Map(raw.targets || []);
    state.activities = raw.activities || [];
  }

  function persistLocal() {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify(serialize()));
    } catch (err) {
      console.warn("שמירה מקומית נכשלה", err);
    }
  }

  /* ------------------------------------------------------------ supabase */
  let sb = null;

  async function connectSupabase({ url, key }) {
    await loadScript(cfg.supabaseCdn);
    sb = window.supabase.createClient(url, key);
    const { error } = await sb.from("parties").select("party_no").limit(1);
    if (error) throw new Error(error.message);
    state.backend = "supabase";
    state.status = "מסונכרן";
    return sb;
  }

  async function pullSupabase() {
    const pageSize = 1000;
    const readAll = async (table, columns) => {
      const rows = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await sb.from(table).select(columns)
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        rows.push(...data);
        if (data.length < pageSize) return rows;
      }
    };

    const [agents, parties, profiles, sales, targets, activities] = await Promise.all([
      readAll("agents", "agent_no, name"),
      readAll("parties", "party_no, name"),
      readAll("customer_profiles", "*"),
      readAll("sales", "customer_no, payer_no, agent_no, year, month, amount, source"),
      readAll("targets", "party_no, year, month, amount"),
      readAll("activities", "*"),
    ]);

    const profileBy = new Map(profiles.map((p) => [p.party_no, p]));
    state.agents = agents.map((a) => ({ no: a.agent_no, name: a.name }));
    state.parties = new Map(parties.map((p) => [p.party_no, {
      no: p.party_no,
      name: p.name,
      profile: { ...emptyProfile(), ...(profileBy.get(p.party_no) || {}) },
    }]));
    state.sales = new Map(sales.map((s) => [
      saleKey(s.customer_no, s.payer_no, s.agent_no, s.year, s.month),
      { c: s.customer_no, p: s.payer_no, agent: s.agent_no, y: s.year, m: s.month,
        a: Number(s.amount), source: s.source },
    ]));
    state.targets = new Map(targets.filter((t) => t.month === null)
      .map((t) => [`${t.party_no}|${t.year}`, Number(t.amount)]));
    state.activities = activities.map((a) => ({ ...a }));
  }

  /** כתיבה לענן. במצב מקומי זו פעולה ריקה - הכול נשמר ב-localStorage. */
  async function push(table, rows, onConflict) {
    if (state.backend !== "supabase" || !rows.length) return;
    const { error } = await sb.from(table).upsert(rows, { onConflict });
    if (error) throw new Error(error.message);
  }

  async function remove(table, match) {
    if (state.backend !== "supabase") return;
    const { error } = await sb.from(table).delete().match(match);
    if (error) throw new Error(error.message);
  }

  /** כל שינוי עובר דרך כאן: שמירה מקומית, כתיבה לענן, רענון המסך. */
  async function commit(work) {
    let error = null;
    try {
      await work();
    } catch (err) {
      error = err;
      console.error(err);
    }
    persistLocal();
    notify();
    if (error) throw error;
  }

  /* ---------------------------------------------------------------- API -- */
  const api = {
    state,

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async init() {
      const saved = localStorage.getItem(cfg.storageKey);
      if (saved) {
        try {
          hydrate(JSON.parse(saved));
        } catch (err) {
          seedFromDataset();
        }
      } else {
        seedFromDataset();
        persistLocal();
      }

      const creds = credentials();
      if (creds.url && creds.key) {
        try {
          await connectSupabase(creds);
          await pullSupabase();
          persistLocal();
        } catch (err) {
          state.status = `מקומי (החיבור לענן נכשל: ${err.message})`;
        }
      }
      notify();
      return state;
    },

    /* --- קריאה --- */
    parties: () => [...state.parties.values()],
    party: (no) => state.parties.get(no),
    partyName: (no) => (state.parties.get(no) || {}).name || no,
    sales: () => [...state.sales.values()],
    years() {
      return [...new Set([...state.sales.values()].map((s) => s.y))].sort();
    },
    lastMonth(year) {
      const months = [...state.sales.values()].filter((s) => s.y === year && s.a)
        .map((s) => s.m);
      return months.length ? Math.max(...months) : 12;
    },
    target: (no, year) => state.targets.get(`${no}|${year}`) || 0,

    /* --- כתיבה --- */
    setSale(customerNo, payerNo, year, month, amount, agentNo) {
      const agent = agentNo || defaultAgent();
      const key = saleKey(customerNo, payerNo, agent, year, month);
      const existing = state.sales.get(key);
      const value = Math.round(Fmt.parseNumber(amount) * 100) / 100;
      return commit(async () => {
        if (!value) {
          state.sales.delete(key);
          await remove("sales", { customer_no: customerNo, payer_no: payerNo,
                                  agent_no: agent, year, month });
          return;
        }
        // A value a person typed is manual from here on, whatever its origin.
        state.sales.set(key, { c: customerNo, p: payerNo, agent, y: year, m: month,
                               a: value, source: "manual" });
        await push("sales", [{
          customer_no: customerNo, payer_no: payerNo, agent_no: agent,
          year, month, amount: value, source: "manual",
        }], "customer_no,payer_no,agent_no,year,month");
      });
    },

    addParty(no, name) {
      const id = String(no).trim();
      if (!id) throw new Error("חסר מספר לקוח");
      if (state.parties.has(id)) throw new Error("מספר הלקוח כבר קיים");
      return commit(async () => {
        state.parties.set(id, { no: id, name: name.trim() || id, profile: emptyProfile() });
        await push("parties", [{ party_no: id, name: name.trim() || id }], "party_no");
      });
    },

    renameParty(no, name) {
      return commit(async () => {
        const party = state.parties.get(no);
        if (!party) return;
        party.name = name.trim() || party.name;
        await push("parties", [{ party_no: no, name: party.name }], "party_no");
      });
    },

    /** מוחק לקוח ואת כל תנועות המכירה שלו. */
    deleteParty(no) {
      return commit(async () => {
        state.parties.delete(no);
        [...state.sales.entries()].forEach(([key, sale]) => {
          if (sale.c === no || sale.p === no) state.sales.delete(key);
        });
        state.activities = state.activities.filter((a) => a.party_no !== no);
        await remove("sales", { customer_no: no });
        await remove("sales", { payer_no: no });
        await remove("parties", { party_no: no });
      });
    },

    updateProfile(no, patch) {
      return commit(async () => {
        const party = state.parties.get(no);
        if (!party) return;
        party.profile = { ...party.profile, ...patch };
        await push("customer_profiles",
          [{ party_no: no, ...party.profile, updated_at: new Date().toISOString() }],
          "party_no");
      });
    },

    setTarget(no, year, amount) {
      const value = Fmt.parseNumber(amount);
      return commit(async () => {
        if (!value) {
          state.targets.delete(`${no}|${year}`);
          await remove("targets", { party_no: no, year });
          return;
        }
        state.targets.set(`${no}|${year}`, value);
        await push("targets", [{ party_no: no, year, month: null, amount: value }],
                   "party_no,year,month");
      });
    },

    addActivity(activity) {
      const row = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
        party_no: activity.party_no,
        happened_on: activity.happened_on || new Date().toISOString().slice(0, 10),
        kind: activity.kind || "note",
        title: activity.title,
        body: activity.body || "",
        follow_up_on: activity.follow_up_on || null,
        done: false,
      };
      return commit(async () => {
        state.activities.unshift(row);
        await push("activities", [row], "id");
      });
    },

    toggleActivity(id) {
      return commit(async () => {
        const row = state.activities.find((a) => a.id === id);
        if (!row) return;
        row.done = !row.done;
        await push("activities", [row], "id");
      });
    },

    deleteActivity(id) {
      return commit(async () => {
        state.activities = state.activities.filter((a) => a.id !== id);
        await remove("activities", { id });
      });
    },

    /** מייבא שורות מאקסל: [{customer_no, payer_no, year, month, amount}] */
    importRows(rows) {
      return commit(async () => {
        const batch = [];
        rows.forEach((row) => {
          const c = String(row.customer_no || "").trim();
          const p = String(row.payer_no || c).trim();
          const y = Number(row.year);
          const m = Number(row.month);
          const a = Math.round(Fmt.parseNumber(row.amount) * 100) / 100;
          if (!c || !y || !m) return;
          if (!state.parties.has(c)) {
            state.parties.set(c, { no: c, name: row.customer_name || c, profile: emptyProfile() });
          }
          if (!state.parties.has(p)) {
            state.parties.set(p, { no: p, name: row.payer_name || p, profile: emptyProfile() });
          }
          const agent = row.agent_no || defaultAgent();
          if (!a) {
            state.sales.delete(saleKey(c, p, agent, y, m));
            return;
          }
          state.sales.set(saleKey(c, p, agent, y, m),
                          { c, p, agent, y, m, a, source: "manual" });
          batch.push({ customer_no: c, payer_no: p, agent_no: agent,
                       year: y, month: m, amount: a, source: "manual" });
        });
        const parties = [...state.parties.values()]
          .map((x) => ({ party_no: x.no, name: x.name }));
        await push("parties", parties, "party_no");
        await push("sales", batch, "customer_no,payer_no,agent_no,year,month");
      });
    },

    /* --- ענן --- */
    settings,
    saveSettings,
    credentials,
    async connect(url, key) {
      saveSettings({ supabaseUrl: url, supabaseAnonKey: key });
      await connectSupabase({ url, key });
      await pullSupabase();
      persistLocal();
      notify();
    },
    disconnect() {
      saveSettings({ supabaseUrl: "", supabaseAnonKey: "" });
      sb = null;
      state.backend = "local";
      state.status = "מקומי";
      notify();
    },
    /** דוחף את כל התמונה המקומית לענן - לשימוש בהעלאה ראשונית. */
    async pushAll() {
      if (state.backend !== "supabase") throw new Error("אין חיבור ל-Supabase");
      await push("agents", state.agents.map((a) => ({ agent_no: a.no, name: a.name })), "agent_no");
      await push("parties", [...state.parties.values()]
        .map((p) => ({ party_no: p.no, name: p.name })), "party_no");
      const sales = [...state.sales.values()].map((s) => ({
        customer_no: s.c, payer_no: s.p, agent_no: s.agent,
        year: s.y, month: s.m, amount: s.a, source: s.source,
      }));
      for (let i = 0; i < sales.length; i += 500) {
        await push("sales", sales.slice(i, i + 500),
                   "customer_no,payer_no,agent_no,year,month");
      }
    },
    async pull() {
      if (state.backend !== "supabase") throw new Error("אין חיבור ל-Supabase");
      await pullSupabase();
      persistLocal();
      notify();
    },
    /** שומר עותק מעודכן של האקסל ב-Supabase Storage. */
    async uploadWorkbook(blob) {
      if (state.backend !== "supabase") return false;
      const { error } = await sb.storage.from(cfg.exportBucket)
        .upload(cfg.exportPath, blob, { upsert: true, contentType: blob.type });
      if (error) throw new Error(error.message);
      return true;
    },

    resetToSeed() {
      return commit(async () => {
        seedFromDataset();
      });
    },

    loadScript,
  };

  return api;
})();
