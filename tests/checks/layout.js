/* ============================================================================
   פריסה: גלישה אופקית, יעדי נגיעה וגובה המסכים.

   גובה העמוד נמדד ונרשם לא כקישוט אלא כמדד: "פחות גלילה" היה אחד מיעדי
   השדרוג, והדרך היחידה לשמור עליו היא למדוד אותו בכל פעם.
   ========================================================================== */
const { open, go, VIEWS, ESCAPES, label } = require("../lib/harness");

const WIDTHS = [[320, "320"], [375, "375"], [390, "390"], [412, "412"]];

async function run(browser, url) {
  const problems = [];
  const notes = [];

  /* --- גובה כל מסך, במחשב ובטלפון --- */
  for (const [device, opts] of [["מחשב", {}], ["טלפון", { width: 390, height: 844,
                                                          mobile: true }]]) {
    const page = await open(browser, url, opts);
    const heights = [];
    for (const view of VIEWS) {
      await go(page, view);
      heights.push(`${view} ${await page.evaluate(
        () => Math.round(document.documentElement.scrollHeight))}`);
    }
    notes.push(`גובה (${device}): ${heights.join(" · ")}`);
    problems.push(...page.errors.map((e) => `${device}: שגיאת דף — ${e}`));
    await page.context().close();
  }

  /* --- רוחבי טלפון: גלישה ויעדי נגיעה --- */
  for (const [width, name] of WIDTHS) {
    const page = await open(browser, url, { width, height: 800, mobile: true });
    for (const view of VIEWS) {
      await go(page, view, 300);
      const r = await page.evaluate(({ vw, escapesSrc }) => {
        const escapes = eval(escapesSrc);
        const doc = document.documentElement;
        const wide = [...document.querySelectorAll("main *")]
          .filter((el) => escapes(el, vw)).slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${
            (el.className || "").toString().trim().split(/\s+/)[0] || "-"}`);
        // יעד נגיעה: התווית היא שטח הלחיצה, ולכפתור עם שטח מורחב ב-::after
        // יש יותר ממה שנראה
        const small = [...document.querySelectorAll(
          "main button, main a, main select, main input")]
          .filter((el) => {
            if (el.classList.contains("visually-hidden")) return false;
            const box = el.closest("label") || el;
            const rect = box.getBoundingClientRect();
            const grow = el.tagName === "BUTTON"
              ? parseFloat(getComputedStyle(el, "::after").inset) || 0 : 0;
            const w = rect.width - grow * 2;
            const h = rect.height - grow * 2;
            return w > 0 && h > 0 && (h < 28 || w < 24);
          }).slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${
            (el.className || "").toString().trim().split(/\s+/)[0] || "-"}`);
        return { over: doc.scrollWidth - doc.clientWidth, wide, small };
      }, { vw: width, escapesSrc: ESCAPES });

      if (r.over > 1) problems.push(`${name}px/${view}: גלילה אופקית ${r.over}px`);
      r.wide.forEach((w) => problems.push(`${name}px/${view}: גולש מהמסך — ${w}`));
      r.small.forEach((w) => problems.push(`${name}px/${view}: יעד נגיעה קטן — ${w}`));
    }
    problems.push(...page.errors.map((e) => `${name}px: שגיאת דף — ${e}`));
    await page.context().close();
  }
  if (!problems.length) notes.push(`נקי ב-${WIDTHS.map((w) => w[1]).join(", ")} פיקסלים ✓`);

  return { name: "פריסה", problems, notes };
}

module.exports = { run };
