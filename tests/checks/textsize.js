/* ============================================================================
   גדלי הטקסט: שלוש המדרגות × כל המסכים × שלושה רוחבים.

   הגדלה היא המקום שבו פריסה נשברת בשקט, ודווקא אצל מי שבחר אותה כי הוא
   מתקשה לקרוא. לכן היא נבדקת במלואה ולא בדגימה.
   ========================================================================== */
const { open, go, VIEWS, ESCAPES } = require("../lib/harness");

const SIZES = [["normal", "רגיל"], ["large", "גדול"], ["xlarge", "ענק"]];
const WIDTHS = [[320, true], [390, true], [1440, false]];

async function run(browser, url) {
  const problems = [];
  const notes = [];

  for (const [width, mobile] of WIDTHS) {
    const page = await open(browser, url, { width, height: mobile ? 800 : 950, mobile });
    for (const [size, name] of SIZES) {
      await page.evaluate((s) => {
        if (s === "normal") delete document.documentElement.dataset.text;
        else document.documentElement.dataset.text = s;
      }, size);
      for (const view of VIEWS) {
        await go(page, view, 280);
        const r = await page.evaluate(({ vw, escapesSrc }) => {
          const escapes = eval(escapesSrc);
          const doc = document.documentElement;
          const wide = [...document.querySelectorAll("main *")]
            .filter((el) => escapes(el, vw)).slice(0, 2)
            .map((el) => `${el.tagName.toLowerCase()}.${
              (el.className || "").toString().trim().split(/\s+/)[0] || "-"}`);
          // נחתך באמת רק היכן שהגלישה מוסתרת; כפתור עם overflow גלוי אינו חותך
          const clipped = [...document.querySelectorAll(
            ".btn, .badge, .seg button, .input, .select")]
            .filter((el) => {
              const st = getComputedStyle(el);
              if (st.overflow === "visible" && st.overflowY === "visible") return false;
              return el.scrollHeight > el.clientHeight + 2;
            }).slice(0, 2)
            .map((el) => `${el.tagName.toLowerCase()}.${
              (el.className || "").toString().trim().split(/\s+/)[0] || "-"}`);
          return { over: doc.scrollWidth - doc.clientWidth, wide, clipped,
                   body: Math.round(parseFloat(getComputedStyle(document.body).fontSize) * 10) / 10 };
        }, { vw: width, escapesSrc: ESCAPES });

        if (r.over > 1) problems.push(`${width}px/${name}/${view}: גלילה אופקית ${r.over}px`);
        r.wide.forEach((w) => problems.push(`${width}px/${name}/${view}: גולש — ${w}`));
        r.clipped.forEach((w) => problems.push(`${width}px/${name}/${view}: טקסט נחתך — ${w}`));
        if (view === "dashboard" && width === 1440) {
          notes.push(`${name}: גוף הטקסט ${r.body}px`);
        }
      }
    }
    problems.push(...page.errors.map((e) => `${width}px: שגיאת דף — ${e}`));
    await page.context().close();
  }
  if (!problems.length) notes.push("נקי בשלושת הגדלים, בכל המסכים, בכל הרוחבים ✓");

  return { name: "גודל טקסט", problems: [...new Set(problems)], notes };
}

module.exports = { run };
