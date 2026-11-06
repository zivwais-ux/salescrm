/* ============================================================================
   נגישות: ניגודיות בשני הנושאים, שמות נגישים, ומיקוד נראה.

   הצבעים כתובים ב-oklch ולפעמים ב-color-mix, ולכן הניגודיות נמדדת על הצבע
   המחושב דרך קנבס — ניתוח מחרוזת החזיר כאן פעם יחס 1:1 לכל זוג, מה שנראה
   כמו כישלון מוחלט והיה למעשה באג בבדיקה.
   ========================================================================== */
const { open, go, VIEWS } = require("../lib/harness");

const AUDIT = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const parse = (str) => {
    if (!str) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = str;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = (c) => {
    const [r, g, b] = c.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const p = parse(getComputedStyle(n).backgroundColor);
      if (p && p[3] > 0.9) return p;
    }
    return [255, 255, 255, 1];
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const seen = new Map();
  document.querySelectorAll("#view *, #sidebar *, #topbar *, #ctxbar *").forEach((el) => {
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) return;
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg) return;
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    // סף AA: טקסט גדול (18.66px ומעלה, או 14px ומעלה ומודגש) נמדד ב-3:1
    const large = size >= 18.66 || (size >= 14 && weight >= 700);
    const key = `${el.className || el.tagName}|${style.color}|${Math.round(size)}`;
    if (seen.has(key)) return;
    seen.set(key, {
      what: `${el.tagName.toLowerCase()}.${
        (el.className || "").toString().trim().split(/\s+/)[0] || "-"}`,
      size: Math.round(size),
      need: large ? 3 : 4.5,
      got: Math.round(ratio(fg, bgOf(el)) * 100) / 100,
    });
  });
  return [...seen.values()];
};

async function run(browser, url) {
  const problems = [];
  const notes = [];
  let checked = 0;
  let lowest = null;

  for (const theme of ["light", "dark"]) {
    const page = await open(browser, url, { theme });
    for (const view of ["dashboard", "customers", "settings"]) {
      await go(page, view, 320);
      const rows = await page.evaluate(AUDIT);
      rows.forEach((r) => {
        checked += 1;
        if (!lowest || r.got < lowest.got) lowest = { ...r, theme };
        if (r.got < r.need) {
          problems.push(`${theme}/${view}: ${r.what} ${r.size}px — ${r.got}:1, נדרש ${r.need}`);
        }
      });
    }
    await page.context().close();
  }
  notes.push(`${checked} צירופי טקסט/רקע נבדקו בשני הנושאים`);
  if (lowest) {
    notes.push(`הנמוך ביותר: ${lowest.what} ${lowest.got}:1 (נדרש ${lowest.need}) ב-${
      lowest.theme}`);
  }

  /* --- שמות נגישים ומיקוד נראה --- */
  const page = await open(browser, url);
  for (const view of VIEWS) {
    await go(page, view, 300);
    const found = await page.evaluate((v) => {
      const out = [];
      document.querySelectorAll("#view button, #sidebar button, #topbar button, #ctxbar button")
        .forEach((el) => {
          const name = (el.textContent || "").trim() || el.getAttribute("aria-label")
            || el.getAttribute("title");
          if (!name) out.push(`כפתור בלי שם נגיש: .${(el.className || "").split(" ")[0]}`);
        });
      document.querySelectorAll("#view input, #view select, #view textarea").forEach((el) => {
        const labelled = el.getAttribute("aria-label") || el.closest("label")
          || (el.id && document.querySelector(`label[for="${el.id}"]`));
        if (!labelled && el.type !== "hidden") {
          out.push(`שדה בלי תווית: ${el.tagName.toLowerCase()}#${el.id || "-"}`);
        }
      });
      // גרף הוא תמונה חסרת ערכים לקורא מסך, ויש לו תמיד תאום טבלאי
      document.querySelectorAll("#view svg:not([aria-hidden])")
        .forEach(() => out.push("svg בלי aria-hidden"));
      return out.map((x) => `${v}: ${x}`);
    }, view);
    problems.push(...found);
  }

  await page.evaluate(() => window.App.go("dashboard"));
  await page.waitForTimeout(300);
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { tag: document.activeElement.tagName, width: s.outlineWidth, style: s.outlineStyle };
  });
  if (focus.style === "none" || parseFloat(focus.width) < 1) {
    problems.push(`אין טבעת מיקוד נראית (${focus.tag})`);
  } else {
    notes.push(`טבעת מיקוד: ${focus.width} ${focus.style} ✓`);
  }

  problems.push(...page.errors.map((e) => `שגיאת דף: ${e}`));
  await page.context().close();
  return { name: "נגישות", problems: [...new Set(problems)], notes };
}

module.exports = { run };
