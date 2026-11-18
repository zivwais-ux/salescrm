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

/** אותו חודש, בלי עמודת החודש — כפי שייצוא של חודש בודד נראה. */
async function csvWithoutMonth(page, year, month) {
  const built = await csvOfMonth(page, year, month);
  const lines = fs.readFileSync(built.file, "utf8").split("\n");
  const cut = (line) => {
    const cells = line.split(",");
    return cells.slice(0, 6).concat(cells.slice(7)).join(",");
  };
  const file = built.file.replace(/\.csv$/, "-nomonth.csv");
  fs.writeFileSync(file, lines.map((l) => (l.trim() ? cut(l) : l)).join("\n"), "utf8");
  return { ...built, file };
}

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

  /* --- קובץ בלי עמודת חודש אינו מנוחש --- *
     זו התקלה שקרתה בשטח: נובמבר נכנס, ואותו סכום בדיוק הופיע גם בדצמבר,
     כי הבורר הציע את החודש הריק הבא והקובץ נכנס לשם בשקט. */
  const blind = await csvWithoutMonth(page, 2026, 9);
  // התצוגה המקדימה הקודמת עדיין פתוחה, ושדה הקובץ חוזר רק אחרי ביטול
  await page.click("#plan-cancel");
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => Store.sales()
    .filter((s) => s.y === 2026 && s.m === 10).length);
  await page.setInputFiles("#file-input", blind.file);
  await page.waitForTimeout(1200);

  const asked = await page.evaluate(() => ({
    ask: !!document.querySelector(".plan-ask"),
    button: (document.querySelector("#plan-apply") || {}).textContent || "",
  }));
  if (!asked.ask) {
    problems.push("קובץ בלי עמודת חודש לא עצר לשאלה");
  } else if (!/עדכון \S+ \d{4}/.test(asked.button.trim())) {
    problems.push(`הכפתור אינו אומר לאיזה חודש: "${asked.button.trim()}"`);
  } else {
    notes.push("קובץ בלי חודש עוצר, שואל, והכפתור נוקב בחודש ✓");
  }

  // בחירת חודש אחר חייבת לצייר מחדש את התוכנית, ולא רק את הכותרת
  await page.selectOption("#plan-month", "9");
  await page.waitForTimeout(1200);
  const retargeted = await page.evaluate(() => (
    (document.querySelector("#plan-apply") || {}).textContent || ""));
  if (!/ספטמבר/.test(retargeted)) {
    problems.push(`שינוי החודש לא נקלט: "${retargeted.trim()}"`);
  } else {
    await page.click("#plan-apply");
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => Store.sales()
      .filter((s) => s.y === 2026 && s.m === 10).length);
    if (after !== before) {
      problems.push(`הייבוא נגע באוקטובר: ${before} שורות → ${after}`);
    } else {
      notes.push("אחרי בחירת החודש הייבוא נכנס רק אליו ✓");
    }
  }
  fs.rmSync(path.dirname(blind.file), { recursive: true, force: true });

  /* --- אותו קובץ לחודש שני: נאמר לפני האישור --- */
  const again = await csvWithoutMonth(page, 2026, 9);
  // התצוגה הקודמת אולי כבר אושרה, ואז אין מה לבטל
  if (await page.$("#plan-cancel")) {
    await page.click("#plan-cancel");
    await page.waitForTimeout(400);
  }
  await page.setInputFiles("#file-input", again.file);
  await page.waitForTimeout(1200);
  await page.selectOption("#plan-month", "8");       // חודש שעבר, אבל הנתונים הם של ספטמבר
  await page.waitForTimeout(1200);
  const twin = await page.evaluate(() => ({
    shown: !!document.querySelector(".plan-ask-danger"),
    text: (document.querySelector(".plan-ask-danger") || {}).innerText || "",
  }));
  fs.rmSync(path.dirname(again.file), { recursive: true, force: true });
  if (!twin.shown) {
    problems.push("אותם נתונים לחודש שני לא הוצגו כחשודים");
  } else if (!/ספטמבר/.test(twin.text)) {
    problems.push(`האזהרה אינה נוקבת בחודש התאום: "${twin.text.replace(/\s+/g, " ")}"`);
  } else {
    notes.push("אותם נתונים לחודש שני נאמרים לפני האישור ✓");
  }

  problems.push(...page.errors.map((e) => `שגיאת דף: ${e}`));
  await page.context().close();
  return { name: "ייבוא בטלפון", problems, notes };
}

module.exports = { run };
