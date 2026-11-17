/* ============================================================================
   סנכרון בין המכשירים.

   עד כאן המערכת שמרה הכול בדפדפן שבו הוזן, ורק בו. זה עבד כל עוד יש מכשיר
   אחד — וברגע שהמנהל עדכן חודש במחשב והסתכל בטלפון, הטלפון הראה את מה
   שהאתר הגיע איתו. לא תקלה בתצוגה: פשוט שני עותקים נפרדים.

   כאן נוסף עותק שלישי, משותף, בענן. הכללים:

     • המקור המקומי נשאר המקור. הכול נשמר קודם בדפדפן, והאתר עובד בלי רשת
       בדיוק כמו קודם. הענן הוא שכבה מעל, לא תנאי.
     • המצב הוא מסמך אחד שלם, ולכן אין כאן מיזוג של שתי עריכות. יש שמירה
       על גרסה: מי שדוחף מצהיר על הגרסה שראה, ואם בינתיים מכשיר אחר שמר —
       הדחיפה נדחית והמשתמש רואה את זה. דריסה שקטה של עבודה היא בדיוק מה
       שאסור לקרות כאן.
     • אין ספרייה. בקשות fetch רגילות אל שתי פונקציות בשרת, ולכן המערכת
       ממשיכה להיטען מיד וללא תלות.
     • בלי הגדרות בקובץ config — המודול כבוי לגמרי, והאתר מתנהג כמו קודם.

   הקוד הוא הסיסמה. הוא נשמר במכשיר, נשלח לשרת, והשרת שומר רק את הטביעה
   שלו — ולכן הוא לעולם אינו מופיע במסד הנתונים.
   ========================================================================== */
window.Sync = (function () {
  const cfg = (window.APP_CONFIG || {}).sync || null;
  const CODE_KEY = "beny_sync_code";
  const META_KEY = "beny_sync_meta";
  const PUSH_WAIT = 1500;        // המתנה אחרי שינוי, כדי לא לדחוף כל הקלדה
  const POLL = 60000;            // בדיקה תקופתית כל עוד הלשונית פתוחה

  const listeners = new Set();
  const view = {
    on: false,            // האם יש הגדרות וקוד
    status: "off",        // off · idle · busy · error · conflict
    version: 0,
    at: null,             // מתי הענן עודכן לאחרונה
    by: "",               // ומאיזה מכשיר
    error: "",
    pending: false,       // יש שינוי מקומי שעוד לא נדחף
  };

  let timer = null;
  let poller = null;
  let adopting = false;   // בזמן אימוץ מצב מהענן אין לדחוף אותו בחזרה
  let watching = false;   // מאזין אחד לשינויים, גם אחרי חיבור מחדש

  /* ------------------------------------------------------------- אחסון */
  function read(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* חסום */ }
  }

  const code = () => (read(CODE_KEY) || "").trim();

  function meta() {
    try { return JSON.parse(read(META_KEY) || "{}"); } catch (err) { return {}; }
  }

  function setMeta(patch) {
    write(META_KEY, JSON.stringify({ ...meta(), ...patch }));
  }

  /** שם שמסביר בהודעה מאיזה מכשיר הגיע העדכון. */
  function deviceName() {
    const saved = meta().device;
    if (saved) return saved;
    const phone = /iphone|ipad|android|mobile/i.test(navigator.userAgent);
    const name = phone ? "טלפון" : "מחשב";
    setMeta({ device: name });
    return name;
  }

  function watch() {
    if (watching) return;
    watching = true;
    Store.onChange(() => schedule());
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(view); } catch (err) { console.warn(err); }
    });
  }

  function set(patch) {
    Object.assign(view, patch);
    emit();
  }

  /* -------------------------------------------------------------- רשת */
  async function call(fn, body) {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text.slice(0, 160) || `שגיאת שרת ${res.status}`);
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  /** מאמץ מצב שהגיע מהענן, בלי שהאימוץ עצמו ייחשב לשינוי מקומי. */
  function adopt(payload, row, label) {
    adopting = true;
    try {
      Store.adoptState(payload, label);
    } finally {
      adopting = false;
    }
    setMeta({ version: row.version, at: row.updated_at, pending: false });
    set({ version: row.version, at: row.updated_at, by: row.updated_by || "",
          status: "idle", error: "", pending: false });
  }

  /* ------------------------------------------------------------ פעולות */
  async function pull({ silent = true } = {}) {
    if (!view.on) return null;
    set({ status: "busy", error: "" });
    try {
      const row = await call("beny_pull", { p_code: code() });
      if (!row) {                      // חדר ריק — המכשיר הזה הראשון
        set({ status: "idle" });
        return null;
      }
      const known = meta().version || 0;
      if (row.version > known) {
        // בענן יש חדש — אבל אם במכשיר הזה יש שינוי שעוד לא עלה, אימוץ היה
        // מוחק אותו. זו התנגשות, והיא נאמרת במקום להיסגר לבד.
        if (view.pending || view.status === "conflict") {
          set({ status: "conflict", version: row.version, at: row.updated_at,
                by: row.updated_by || "", pending: true });
          return row;
        }
        adopt(row.payload, row, `סנכרון מ${row.updated_by || "מכשיר אחר"}`);
        if (!silent) App.toast(`הנתונים עודכנו מ${row.updated_by || "הענן"}`, "up");
        return row;
      }
      set({ status: "idle", version: row.version, at: row.updated_at,
            by: row.updated_by || "" });
      return row;
    } catch (err) {
      set({ status: "error", error: err.message });
      return null;
    }
  }

  async function push({ force = false } = {}) {
    if (!view.on) return false;
    set({ status: "busy", error: "" });
    try {
      // null אומר לשרת "דרוס" — נשלח רק אחרי הכרעה מפורשת של המשתמש
      // או כשהחדר עוד ריק.
      const row = await call("beny_push", {
        p_code: code(),
        p_payload: Store.snapshotState(),
        p_base: force ? null : (meta().version || 0),
        p_by: deviceName(),
      });
      if (!row) throw new Error("השרת לא ענה");

      if (row.ok === false) {
        // מכשיר אחר שמר בינתיים. לא דורסים — שואלים.
        set({ status: "conflict", version: row.version, at: row.updated_at,
              by: row.updated_by || "", pending: true });
        return false;
      }
      setMeta({ version: row.version, at: row.updated_at, pending: false });
      set({ status: "idle", version: row.version, at: row.updated_at,
            by: row.updated_by || "", pending: false, error: "" });
      return true;
    } catch (err) {
      set({ status: "error", error: err.message, pending: true });
      return false;
    }
  }

  /** דוחה דחיפה עד שהעריכה נרגעת, כדי שסדרת שינויים תיסע פעם אחת. */
  function schedule() {
    if (!view.on || adopting) return;
    setMeta({ pending: true });
    set({ pending: true });
    clearTimeout(timer);
    timer = setTimeout(() => push(), PUSH_WAIT);
  }

  /* ------------------------------------------------------- מחזור החיים */
  function start() {
    if (!view.on) return;
    pull({ silent: true });
    clearInterval(poller);
    poller = setInterval(() => {
      if (document.visibilityState === "visible" && view.status !== "conflict") pull();
    }, POLL);
  }

  function init() {
    if (!cfg || !cfg.url || !cfg.key) {
      set({ on: false, status: "off" });
      return;
    }
    const saved = meta();
    Object.assign(view, { version: saved.version || 0, at: saved.at || null,
                          pending: !!saved.pending });
    set({ on: !!code(), status: code() ? "idle" : "off" });
    if (!view.on) return;

    watch();

    // חזרה אל הלשונית היא הרגע שבו הטלפון צריך לגלות שהמחשב עדכן.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (view.pending) push(); else pull();
    });
    window.addEventListener("online", () => (view.pending ? push() : pull()));
    start();
  }

  /**
   * קוד חדש, מוגרל במכשיר עצמו.
   *
   * הקוד הוא הסיסמה, ולכן הוא נולד כאן ולא אצל אף אחד אחר — גם לא אצל מי
   * שבנה את המערכת. עשרים תווים מתוך שלושים ושישה, בארבע קבוצות, כדי
   * שאפשר יהיה להקריא אותו בטלפון בלי טעויות.
   */
  function makeCode() {
    const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";   // בלי l,o,0,1
    const pick = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => alphabet[b % alphabet.length]).join("");
    return `beny-${pick(5)}-${pick(5)}-${pick(5)}-${pick(5)}`;
  }

  return {
    init,
    makeCode,
    pull,
    push,
    state: () => ({ ...view }),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    configured: () => !!(cfg && cfg.url && cfg.key),
    code,
    deviceName,
    setDevice(name) {
      setMeta({ device: String(name || "").trim().slice(0, 40) });
      emit();
    },

    /** חיבור המכשיר הזה: שומר את הקוד, מושך את מה שיש, ומתחיל לעקוב. */
    async connect(newCode) {
      if (!Sync.configured()) throw new Error("הסנכרון אינו מוגדר באתר");
      const clean = String(newCode || "").trim();
      if (clean.length < 16) throw new Error("קוד הסנכרון קצר מדי");
      write(CODE_KEY, clean);
      write(META_KEY, JSON.stringify({ device: meta().device }));
      set({ on: true, status: "idle", version: 0, at: null, error: "" });
      watch();
      // חיבור ראשון הוא הרגע המסוכן: בחדר כבר יש נתונים, ובמכשיר אולי יש
      // עבודה שעוד לא עלתה. מכשיר שמחזיק רק את נתוני האתר מאמץ בשקט; מכשיר
      // שיש בו עבודה משלו עוצר ושואל, במקום לדרוס צד אחד מהשניים.
      const row = await call("beny_pull", { p_code: clean });
      if (!row) {
        await push({ force: true });           // חדר ריק: המכשיר הזה פותח אותו
      } else if (Store.isPristine()) {
        adopt(row.payload, row, `סנכרון מ${row.updated_by || "מכשיר אחר"}`);
        App.toast(`הנתונים התקבלו מ${row.updated_by || "הענן"}`, "up");
      } else {
        set({ status: "conflict", version: row.version, at: row.updated_at,
              by: row.updated_by || "", pending: true });
        setMeta({ pending: true });
      }
      start();
      return view.status !== "error";
    },

    /** ניתוק: הנתונים נשארים במכשיר, רק הקשר לענן נפסק. */
    disconnect() {
      clearTimeout(timer);
      clearInterval(poller);
      write(CODE_KEY, "");
      write(META_KEY, JSON.stringify({ device: meta().device }));
      set({ on: false, status: "off", version: 0, at: null, pending: false });
    },

    /** בהתנגשות: לקחת את מה שבענן ולוותר על השינוי המקומי. */
    async takeRemote() {
      const row = await call("beny_pull", { p_code: code() });
      if (!row) return false;
      adopt(row.payload, row, `סנכרון מ${row.updated_by || "מכשיר אחר"}`);
      return true;
    },

    /** בהתנגשות: להעלות את מה שבמכשיר הזה ולדרוס את הענן. */
    keepLocal() { return push({ force: true }); },
  };
})();
