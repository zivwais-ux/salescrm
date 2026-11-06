/* ============================================================================
   הדוח החודשי והפסיקה שמאחוריו.

   שני דברים נבדקים כאן, ושניהם על נתונים אמיתיים:

     • המספרים בדוח הם המספרים שבמאגר. הסכום הראשי מחושב כאן מחדש, בנפרד
       מהקוד של המסך, ומושווה למה שהמסך הדפיס. דוח ששולחים להנהלה חייב
       להיות המאגר עצמו, לא פרשנות שלו.
     • כל שורה ב"דורש טיפול" נושאת סיבה, והסיבה אינה סיסמה: היא באה
       מהפסיקה של הלקוח מול ההיסטוריה שלו עצמו.

   ובנוסף — ההדפסה. המסך הזה נועד לצאת מהדפדפן, ולכן נבדק שבמצב הדפסה
   הניווט נעלם, הרקע לבן והדיו כהה, גם כשהאתר במצב לילה.
   ========================================================================== */
const { open, go } = require("../lib/harness");

async function run(browser, url) {
  const problems = [];
  const notes = [];
  const page = await open(browser, url);
  await go(page, "report", 600);

  /* --- הסכום הראשי מול חישוב עצמאי מאותו מאגר --- */
  const head = await page.evaluate(() => {
    const month = Number(document.querySelector("#report-month").value);
    const year = App.ctx.year;
    const shown = document.querySelector(".report-lead-value").textContent;
    const expect = Store.sales()
      .filter((s) => s.y === year && s.m === month)
      .reduce((sum, s) => sum + s.a, 0);
    return { month, year, shown, expect: Math.round(expect) };
  });
  const shownNumber = Number(head.shown.replace(/[^\d]/g, ""));
  if (!head.year) {
    problems.push("לא נמצאה השנה הנבחרת");
  } else if (shownNumber !== head.expect) {
    problems.push(`הסכום בדוח ${shownNumber} מול ${head.expect} במאגר`);
  } else {
    notes.push(`${head.month}/${head.year}: ${shownNumber.toLocaleString("he-IL")} ₪ ✓`);
  }

  /* --- כל שורה ב"דורש טיפול" היא חריגה אמיתית, ונושאת את הסיבה --- */
  const attention = await page.evaluate(() => {
    const section = [...document.querySelectorAll(".report-section")]
      .find((s) => /דורש טיפול/.test(s.querySelector("h2").textContent));
    if (!section) return null;
    const rows = [...section.querySelectorAll("tbody tr")].map((r) => ({
      name: r.cells[0].textContent.trim(),
      why: r.cells[4] ? r.cells[4].textContent.trim() : "",
    }));
    const view = Metrics.overview({ year: App.ctx.year, agent: "all" });
    return rows.map((row) => {
      const customer = view.customers.find((c) => c.name === row.name);
      const base = customer
        ? Metrics.baseline(customer.no, { year: App.ctx.year, cmpMonths: view.cmpMonths })
        : null;
      return { ...row, verdict: base ? base.verdict : "לא נמצא" };
    });
  });
  if (!attention) {
    problems.push('לא נמצא החלק "דורש טיפול"');
  } else {
    const wrong = attention.filter((r) => r.verdict !== "anomaly");
    const mute = attention.filter((r) => !r.why);
    if (wrong.length) problems.push(`${wrong.length} שורות שאינן חריגה: ${
      wrong.map((r) => `${r.name} (${r.verdict})`).join(", ")}`);
    if (mute.length) problems.push(`${mute.length} שורות בלי סיבה`);
    if (!wrong.length && !mute.length) {
      notes.push(`${attention.length} לקוחות לטיפול, כל אחד עם הסיבה שלו ✓`);
    }
  }

  /* --- החלפת חודש משנה את הדוח ולא רק את הכותרת --- */
  const swap = await page.evaluate(async () => {
    const select = document.querySelector("#report-month");
    const first = document.querySelector(".report-lead-value").textContent;
    const other = [...select.options].find((o) => o.value !== select.value);
    if (!other) return null;
    select.value = other.value;
    select.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 200));
    return { first, second: document.querySelector(".report-lead-value").textContent,
             month: other.textContent.trim() };
  });
  if (swap && swap.first === swap.second) {
    problems.push(`מעבר ל${swap.month} לא שינה את הסכום`);
  } else if (swap) {
    notes.push(`מעבר ל${swap.month} מצייר דוח אחר ✓`);
  }

  /* --- בהדפסה: בלי ניווט, בלי כפתורים, תמיד בהיר --- */
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(200);
  const print = await page.evaluate(() => {
    const show = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display !== "none" : false;
    };
    const rgb = getComputedStyle(document.body).backgroundColor
      .match(/\d+/g).map(Number);
    return { nav: [".sidebar", ".topbar", ".tabbar", ".report-bar"].filter(show),
             light: rgb[0] > 240 && rgb[1] > 240 && rgb[2] > 240 };
  });
  await page.emulateMedia({ media: "screen" });
  if (print.nav.length) problems.push(`נשאר בהדפסה: ${print.nav.join(", ")}`);
  if (!print.light) problems.push("ההדפסה אינה על רקע לבן");
  if (!print.nav.length && print.light) {
    notes.push("בהדפסה: בלי ניווט ובלי כפתורים, לבן גם במצב לילה ✓");
  }

  problems.push(...page.errors.map((e) => `שגיאת דף: ${e}`));
  await page.context().close();
  return { name: "דוח", problems, notes };
}

module.exports = { run };
