/* ============================================================================
   תזכורת העדכון החודשי.

   הלוגיקה תלויה בתאריך, ולכן היא נבדקת מול תאריכים מוזרקים ולא מול "היום" —
   אחרת הבדיקה היתה עוברת בנובמבר ונכשלת בינואר.
   ========================================================================== */
const { open, go } = require("../lib/harness");

async function run(browser, url) {
  const problems = [];
  const notes = [];
  const page = await open(browser, url);
  const ok = (pass, good, bad) => (pass ? notes.push(`${good} ✓`) : problems.push(bad));

  const coverage = await page.evaluate(() => ({
    lastYear: Store.years()[Store.years().length - 1],
    lastMonth: Store.closedMonth(Store.years()[Store.years().length - 1]),
  }));
  notes.push(`הנתונים מגיעים עד ${coverage.lastMonth}/${coverage.lastYear}`);

  /* --- ספירת החודשים החסרים מול תאריכים מוזרקים --- */
  const cases = await page.evaluate((cov) => {
    const at = (y, m, d) => Store.missingMonths(new Date(y, m - 1, d))
      .map((x) => `${x.month}/${x.year}`);
    return {
      // באותו חודש שבו נגמרים הנתונים אין מה לדרוש: הוא עדיין רץ
      sameMonth: at(cov.lastYear, cov.lastMonth, 20),
      // חודש אחרי — החודש שנגמר בו הנתונים כבר נסגר, ואין פער
      monthAfter: at(cov.lastYear, cov.lastMonth + 1, 10),
      // שני חודשים אחרי — חודש אחד חסר
      twoAfter: at(cov.lastYear, cov.lastMonth + 2, 10),
      // חציית שנה: ינואר סופר את דצמבר שלפניו
      nextJan: at(cov.lastYear + 1, 1, 15),
    };
  }, coverage);

  ok(cases.sameMonth.length === 0, "החודש הרץ אינו נספר כחסר",
    `נספרו ${JSON.stringify(cases.sameMonth)} בחודש הנוכחי`);
  ok(cases.monthAfter.length === 0, "אין תזכורת כשהכול מעודכן",
    `נספרו ${JSON.stringify(cases.monthAfter)} כשאין פער`);
  ok(cases.twoAfter.length === 1, "חודש שנסגר ולא עודכן נספר",
    `נספרו ${JSON.stringify(cases.twoAfter)} במקום חודש אחד`);
  const janCount = (12 - coverage.lastMonth);
  ok(cases.nextJan.length === janCount,
    `חציית שנה נספרת נכון (${janCount} חודשים בינואר)`,
    `בינואר נספרו ${cases.nextJan.length} במקום ${janCount}: ${
      JSON.stringify(cases.nextJan)}`);

  /* --- הבאנר עצמו: מופיע, נסגר, והסגירה נזכרת --- */
  await go(page, "dashboard", 420);
  const shown = await page.evaluate(() => {
    const el = document.querySelector(".remind");
    return el ? el.querySelector(".remind-title").textContent.trim() : null;
  });
  const expected = await page.evaluate(() => Store.missingMonths().length > 0);

  if (expected) {
    ok(!!shown, `הבאנר מופיע: "${shown}"`, "יש חודש חסר אבל הבאנר לא הופיע");
    if (shown) {
      await page.click("[data-dismiss-remind]");
      await page.waitForTimeout(350);
      const gone = await page.evaluate(() => !document.querySelector(".remind"));
      ok(gone, "סגירת הבאנר מסתירה אותו", "הבאנר נשאר אחרי סגירה");
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const stillGone = await page.evaluate(() => !document.querySelector(".remind"));
      ok(stillGone, "הסגירה נזכרת אחרי רענון", "הבאנר חזר אחרי רענון");
    }
  } else {
    ok(!shown, "אין חודש חסר ואין באנר", "אין חודש חסר אבל הבאנר הופיע");
  }

  problems.push(...page.errors.map((e) => `שגיאת דף: ${e}`));
  await page.context().close();
  return { name: "תזכורת", problems, notes };
}

module.exports = { run };
