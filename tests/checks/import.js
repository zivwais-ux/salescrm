/* ============================================================================
   הייבוא בטלפון.

   הבדיקה הזו נולדה מתקלה אמיתית: קובץ csv עברי נכנס בשקט לחודש הלא נכון.
   המפצל הקודם חתך רק לפני ספרה או מרכאה, ובקובץ שבו אחרי כל פסיק באה אות
   שורת הכותרות כולה נשארה תא אחד — הכותרות לא זוהו, עמודת החודש אבדה,
   והשורות נכנסו לחודש ברירת המחדל של המסך. המסך לא אמר דבר.

   לכן נבדק כאן המסלול המלא כפי שהוא רץ בטלפון: בחירת קובץ, קריאה, תצוגה
   מקדימה, והמספרים שבה — מול החישוב מהמאגר עצמו.
   ========================================================================== */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { open, go } = require("../lib/harness");

/** בונה csv מתוך חודש אמיתי שכבר במאגר, כפי ש-ERP מייצא אותו. */
async function csvOfMonth(page, year, month) {
  const rows = await page.evaluate(([y, m]) => Store.sales()
    .filter((s) => s.y === y && s.m === m)
    .map((s) => [s.agent, Store.agentName(s.agent), s.c, Store.partyName(s.c), s.p,
                 s.cur || 'ש"ח', `${String(m).padStart(2, "0")}/${y}`, s.a]),
  [year, month]);
  const quote = (v) => (/[",;\n]/.test(String(v))
    ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = ["מס' סוכן", "שם סוכן", "מס. לקוח", "שם לקוח", "לקוח משלם",
                "מטבע", "חודש ושנה", "מחיר כולל"];
  const text = [head, ...rows].map((r) => r.map(quote).join(",")).join("\n");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beny-")), "erp.csv");
  fs.writeFileSync(file, `﻿${text}\n`, "utf8");
  return { file, count: rows.length,
           total: Math.round(rows.reduce((sum, r) => sum + r[7], 0)) };
}

async function run(browser, url) {
  const problems = [];
  const notes = [];
  // אייפון, עם מגע — כך זה מגיע אל המנהל בפועל
  const page = await open(browser, url, { width: 390, height: 844 });
  await go(page, "entry", 500);

  const zone = await page.evaluate(() => {
    const input = document.querySelector("#file-input");
    return { has: !!input, accept: input ? input.getAttribute("accept") : "",
             button: (document.querySelector("#file-pick") || {}).textContent || "" };
  });
  if (!zone.has) {
    problems.push("אין שדה קובץ במסך ההזנה");
    await page.context().close();
    return { name: "ייבוא בטלפון", problems, notes };
  }
  // בלי סוגי MIME בורר הקבצים של אייפון מאפיר את הקובץ ואי אפשר לבחור בו
  if (!zone.accept.includes("spreadsheetml") || !zone.accept.includes("text/csv")) {
    problems.push(`רשימת הסוגים חסרה סוגי MIME: ${zone.accept}`);
  } else {
    notes.push("בורר הקבצים מקבל גם סיומות וגם סוגי MIME ✓");
  }
  if (/מהמחשב/.test(zone.button)) problems.push(`בטלפון הכפתור אומר "${zone.button.trim()}"`);

  /* --- קובץ csv עברי נקרא כמו שהוא: אותו חודש, אותן שורות, אותו סכום --- */
  const expected = await csvOfMonth(page, 2026, 9);
  await page.setInputFiles("#file-input", expected.file);
  await page.waitForTimeout(1200);

  const seen = await page.evaluate(() => {
    const text = document.querySelector(".view").innerText;
    const month = text.match(/(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+(\d{4})/);
    const rows = text.match(/שורות בקובץ\s*\n\s*([\d,]+)/);
    const sum = text.match(/סך המכירות בקובץ\s*\n\s*([\d,]+)/);
    return { month: month ? month[0] : null,
             rows: rows ? Number(rows[1].replace(/,/g, "")) : null,
             sum: sum ? Number(sum[1].replace(/,/g, "")) : null,
             overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  fs.rmSync(path.dirname(expected.file), { recursive: true, force: true });

  if (seen.month !== "ספטמבר 2026") {
    problems.push(`הקובץ של ספטמבר 2026 נקרא כ-${seen.month || "חודש לא מזוהה"}`);
  }
  if (seen.rows !== expected.count) {
    problems.push(`${seen.rows} שורות נקראו מתוך ${expected.count} שבקובץ`);
  }
  if (seen.sum !== expected.total) {
    problems.push(`הסכום בתצוגה ${seen.sum} מול ${expected.total} שבקובץ`);
  }
  if (seen.overflow) problems.push("תצוגת הייבוא גולשת מהמסך בטלפון");
  if (!problems.length) {
    notes.push(`csv עברי של ${expected.count} שורות נקרא לחודש הנכון, ${
      expected.total.toLocaleString("he-IL")} ₪ ✓`);
  }

  problems.push(...page.errors.map((e) => `שגיאת דף: ${e}`));
  await page.context().close();
  return { name: "ייבוא בטלפון", problems, notes };
}

module.exports = { run };
