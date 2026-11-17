/* ============================================================================
   סנכרון בין שני מכשירים.

   הבדיקה מריצה שני דפדפנים נפרדים — שני "מכשירים" עם אחסון נפרד, בדיוק
   כמו מחשב וטלפון — מול שרת שמחקה את שתי הפונקציות שבמסד הנתונים
   (supabase/0001_sync.sql), כולל שמירת הגרסה. כך הכללים נבדקים כאן בלי
   להיות תלויים ברשת או בפרויקט חי:

     • מכשיר שני מקבל את מה שהראשון שמר.
     • שינוי בראשון מגיע לשני.
     • כששניהם שמרו, הדחיפה נדחית ולא דורסת — וההכרעה של המשתמש עובדת
       לשני הכיוונים.
     • קוד שגוי אינו פותח שום דלת.
   ========================================================================== */
const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { chromiumPath, WEB } = require("../lib/harness");

const TYPES = { ".html": "text/html; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".json": "application/json; charset=utf-8" };

/** שרת שמגיש את האתר, ומחקה את שתי פונקציות הסנכרון. */
function stub() {
  const rooms = new Map();
  const room = (code) => crypto.createHash("sha256").update(code || "").digest("hex");

  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];

    if (url.startsWith("/rest/v1/rpc/")) {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const fn = url.split("/").pop();
        const args = JSON.parse(body || "{}");
        const send = (value) => {
          res.writeHead(200, { "content-type": "application/json",
                               "access-control-allow-origin": "*" });
          res.end(JSON.stringify(value));
        };
        const code = args.p_code || "";
        if (code.length < 16) {
          res.writeHead(400, { "content-type": "text/plain" });
          return res.end("קוד סנכרון קצר מדי");
        }
        const key = room(code);
        const current = rooms.get(key);

        if (fn === "beny_pull") return send(current ? [current] : []);

        if (fn === "beny_push") {
          const base = args.p_base === null || args.p_base === undefined
            ? null : Number(args.p_base);
          if (!current) {
            const row = { ok: true, version: 1, payload: args.p_payload,
                          updated_at: new Date().toISOString(),
                          updated_by: args.p_by || "" };
            rooms.set(key, row);
            return send([row]);
          }
          if (base !== null && base !== current.version) {
            return send([{ ...current, ok: false }]);
          }
          const row = { ok: true, version: current.version + 1, payload: args.p_payload,
                        updated_at: new Date().toISOString(),
                        updated_by: args.p_by || "" };
          rooms.set(key, row);
          return send([row]);
        }
        res.writeHead(404).end();
      });
      return;
    }

    // האתר עצמו, עם הגדרות הסנכרון מוזרקות לקובץ ההגדרות
    const file = path.join(WEB, url === "/" ? "index.html" : url);
    if (!file.startsWith(WEB)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      let out = data;
      if (url.endsWith("js/config.js")) {
        const port = server.address().port;
        out = Buffer.from(String(data).replace(
          /sync:\s*\{[^}]*\}/,
          `sync: { url: "http://127.0.0.1:${port}", key: "test-key" }`), "utf8");
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain" });
      res.end(out);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      server, rooms, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

const CODE = "beny-test-code-0123456789";

/** מכשיר = הקשר דפדפן נפרד, ולכן אחסון נפרד. */
async function device(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  page.errors = errors;
  return page;
}

const total = (page) => page.evaluate(() => Math.round(
  Metrics.sum(Store.sales().filter((s) => s.y === 2026).map((s) => s.a))));

async function run(browser, _url) {
  const problems = [];
  const notes = [];
  const { server, url } = await stub();

  const a = await device(browser, url);
  const b = await device(browser, url);
  try {
    if (!await a.evaluate(() => Sync.configured())) {
      problems.push("הסנכרון לא נקרא מההגדרות");
      return { name: "סנכרון", problems, notes };
    }

    /* --- קוד קצר נדחה, ושום דבר לא נפתח --- */
    const short = await a.evaluate(() => Sync.connect("קצר").then(() => "עבר")
      .catch((e) => e.message));
    if (short === "עבר") problems.push("קוד קצר התקבל");
    else notes.push("קוד קצר נדחה ✓");

    /* --- המכשיר הראשון מתחבר ופותח את החדר --- */
    await a.evaluate((code) => Sync.connect(code), CODE);
    await a.waitForTimeout(400);

    // שינוי אמיתי במכשיר הראשון: מוסיפים תנועה ומודדים את ההפרש
    const before = await total(a);
    await a.evaluate(() => {
      const party = Store.parties()[0];
      Store.setSale(party.no, party.no, 2026, 3, 55555, Store.state.agents[0].no);
    });
    await a.waitForTimeout(2200);                 // הדחיפה מושהית בכוונה
    const afterA = await total(a);
    if (afterA === before) problems.push("השינוי לא נרשם במכשיר הראשון");

    /* --- המכשיר השני מתחבר ומקבל את מה שיש --- */
    await b.evaluate((code) => Sync.connect(code), CODE);
    await b.waitForTimeout(600);
    const afterB = await total(b);
    if (afterB !== afterA) {
      problems.push(`המכשיר השני רואה ${afterB} במקום ${afterA}`);
    } else {
      notes.push(`מכשיר שני קיבל את הנתונים: ${afterB.toLocaleString("he-IL")} ₪ ✓`);
    }

    /* --- שינוי נוסף בראשון מגיע לשני במשיכה --- */
    await a.evaluate(() => {
      const party = Store.parties()[1];
      Store.setSale(party.no, party.no, 2026, 4, 1000, Store.state.agents[0].no);
    });
    await a.waitForTimeout(2200);
    await b.evaluate(() => Sync.pull({ silent: true }));
    await b.waitForTimeout(400);
    if (await total(b) !== await total(a)) {
      problems.push("עדכון שני לא הגיע למכשיר השני");
    } else {
      notes.push("עדכון נוסף עבר בין המכשירים ✓");
    }

    /* --- שניהם שמרו: הדחיפה נדחית, לא דורסת --- */
    await b.evaluate(() => {
      const party = Store.parties()[2];
      Store.setSale(party.no, party.no, 2026, 5, 7777, Store.state.agents[0].no);
    });
    await b.waitForTimeout(2200);                 // ב' מקדם את הגרסה בענן
    await a.evaluate(() => {
      const party = Store.parties()[3];
      Store.setSale(party.no, party.no, 2026, 6, 8888, Store.state.agents[0].no);
    });
    await a.waitForTimeout(2200);                 // א' דוחף על גרסה ישנה
    const stateA = await a.evaluate(() => Sync.state());
    if (stateA.status !== "conflict") {
      problems.push(`דחיפה על גרסה ישנה לא נעצרה (${stateA.status})`);
    } else {
      notes.push("דחיפה על גרסה ישנה נעצרה והוצגה כהתנגשות ✓");
    }

    /* --- ההכרעה: להעלות את המכשיר הזה --- */
    const mine = await a.evaluate(() => Sync.keepLocal());
    await a.waitForTimeout(300);
    if (!mine) {
      problems.push("הכרעה לטובת המכשיר המקומי נכשלה");
    } else {
      await b.evaluate(() => Sync.pull({ silent: true }));
      await b.waitForTimeout(400);
      if (await total(b) !== await total(a)) {
        problems.push("אחרי ההכרעה שני המכשירים אינם זהים");
      } else {
        notes.push("ההכרעה הועלתה, ושני המכשירים זהים שוב ✓");
      }
    }

    /* --- מכשיר שיש בו עבודה אינו נדרס בחיבור הראשון --- */
    const late = await device(browser, url);
    await late.evaluate(() => {
      const party = Store.parties()[4];
      Store.setSale(party.no, party.no, 2026, 7, 4242, Store.state.agents[0].no);
    });
    const lateTotal = await total(late);
    await late.evaluate((c) => Sync.connect(c), CODE);
    await late.waitForTimeout(900);
    const lateState = await late.evaluate(() => Sync.state());
    if (lateState.status !== "conflict") {
      problems.push(`חיבור ראשון של מכשיר עם עבודה לא נעצר (${lateState.status})`);
    } else if (await total(late) !== lateTotal) {
      problems.push("חיבור ראשון דרס את העבודה שהיתה במכשיר");
    } else {
      notes.push("מכשיר שיש בו עבודה עוצר ושואל בחיבור הראשון ✓");
    }
    await late.context().close();

    /* --- מכשיר נקי מאמץ בשקט --- */
    const fresh = await device(browser, url);
    await fresh.evaluate((c) => Sync.connect(c), CODE);
    await fresh.waitForTimeout(900);
    if (await total(fresh) !== await total(a)) {
      problems.push("מכשיר נקי לא קיבל את הנתונים בחיבור");
    } else {
      notes.push("מכשיר נקי מאמץ את הענן בלי לשאול ✓");
    }
    await fresh.context().close();

    /* --- קוד אחר הוא חדר אחר: לא רואים דבר --- */
    const other = await device(browser, url);
    await other.evaluate(() => Sync.connect("another-code-9876543210").catch(() => {}));
    await other.waitForTimeout(500);
    const seen = await other.evaluate(() => Sync.state().version);
    if (seen > 1) problems.push("קוד אחר קיבל גישה לנתונים של החדר");
    else notes.push("קוד אחר הוא חדר נפרד ✓");
    await other.context().close();

    problems.push(...a.errors.map((e) => `שגיאת דף (א): ${e}`));
    problems.push(...b.errors.map((e) => `שגיאת דף (ב): ${e}`));
  } finally {
    await a.context().close();
    await b.context().close();
    server.close();
  }
  return { name: "סנכרון", problems, notes };
}

module.exports = { run, chromiumPath };
