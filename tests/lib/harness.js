/* ============================================================================
   התשתית המשותפת לבדיקות: שרת סטטי, דפדפן, וכלי עזר שחוזרים בכל בדיקה.

   שני דברים שנלמדו בדרך הקשה ומקובעים כאן:
     • נתיב הכרומיום אינו קבוע — הוא משתנה בין גרסאות ובין סביבות, ולכן הוא
       מאותר ולא מוקלד. סקריפטים קודמים קיבעו אותו ונשברו כשהגרסה עלתה.
     • רוחב "גולש" אינו בהכרח תקלה: אלמנט בתוך מכל שנגלל אופקית הוא בכוונה.
       `escapes` מטפס במעלה העץ לפני שהוא מאשים.
   ========================================================================== */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..", "..");
const WEB = path.join(ROOT, "web");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** שרת סטטי על תיקיית web, על פורט פנוי שהמערכת בוחרת. */
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(WEB, rel === "/" ? "index.html" : rel);
    // לא יוצאים מתיקיית web, גם אם הבקשה מנסה
    if (!file.startsWith(WEB)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain" });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

/**
 * מאתר את הכרומיום שמותקן בסביבה.
 *
 * סדר החיפוש: משתנה סביבה מפורש, ואז ספריות הדפדפנים של playwright על שמותיהן
 * המשתנים (chromium-1243/chrome-linux64/chrome וכדומה). אם לא נמצא — מחזירים
 * undefined ונותנים ל-playwright לפתור בעצמו.
 */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers",
                 "/ms-playwright"].filter(Boolean);
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch (err) { continue; }
    for (const dir of dirs.filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      for (const sub of ["chrome-linux64", "chrome-linux"]) {
        const exe = path.join(root, dir, sub, "chrome");
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
}

async function launch() {
  return chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
}

const VIEWS = ["dashboard", "trend", "customers", "entry", "activity", "report", "grid",
               "settings"];

/** פותח עמוד, אוסף שגיאות, ומחזיר אותו מוכן לעבודה. */
async function open(browser, url, { width = 1440, height = 950, theme = "light",
                                    mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    locale: "he-IL",
    colorScheme: theme,
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => {
    // הגופן מ-Google Fonts חסום בחלק מהסביבות, וזו אינה תקלה באתר
    if (m.type() === "error" && !/CERT_AUTHORITY|favicon|fonts\.googleapis/.test(m.text())) {
      page.errors.push(m.text());
    }
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(450);
  return page;
}

async function go(page, view, wait = 320) {
  await page.evaluate((v) => window.App.go(v), view);
  await page.waitForTimeout(wait);
}

/** פונקציה שמוזרקת לדף: האם האלמנט באמת גולש, או שהוא בתוך מכל נגלל. */
const ESCAPES = `(el, vw) => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && (r.right > vw + 1 || r.left < -1)
    && getComputedStyle(el).position !== "fixed";
}`;

const label = (el) => `${el.tagName.toLowerCase()}.${
  (el.className || "").toString().trim().split(/\s+/)[0] || "-"}`;

module.exports = { serve, launch, open, go, chromiumPath, VIEWS, ESCAPES, label, ROOT, WEB };
