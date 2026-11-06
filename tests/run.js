#!/usr/bin/env node
/* ============================================================================
   מריץ את כל הבדיקות ומסכם.

       npm test                 הכול
       npm test -- נתונים       בדיקה אחת לפי שם

   יוצא בקוד 1 אם משהו נכשל, כדי שה-CI ייעצר.
   ========================================================================== */
const { serve, launch, chromiumPath } = require("./lib/harness");

const CHECKS = [
  require("./checks/data"),
  require("./checks/behaviour"),
  require("./checks/layout"),
  require("./checks/a11y"),
  require("./checks/textsize"),
];

const NAMES = ["נתונים", "התנהגות", "פריסה", "נגישות", "גודל טקסט"];

(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const { server, url } = await serve();
  const exe = chromiumPath();
  console.log(`\nBENY — בדיקות\n${url}  ·  ${exe || "כרומיום של playwright"}\n`);

  let browser;
  const results = [];
  try {
    browser = await launch();
    for (let i = 0; i < CHECKS.length; i += 1) {
      if (only.length && !only.includes(NAMES[i])) continue;
      const started = Date.now();
      let result;
      try {
        result = await CHECKS[i].run(browser, url);
      } catch (err) {
        result = { name: NAMES[i], problems: [`הבדיקה עצמה נפלה: ${err.message}`], notes: [] };
      }
      result.seconds = Math.round((Date.now() - started) / 100) / 10;
      results.push(result);

      const mark = result.problems.length ? "✗" : "✓";
      console.log(`${mark} ${result.name}  (${result.seconds} שניות)`);
      result.notes.forEach((n) => console.log(`    ${n}`));
      result.problems.forEach((p) => console.log(`    ✗ ${p}`));
      console.log("");
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const failed = results.filter((r) => r.problems.length);
  const count = results.reduce((sum, r) => sum + r.problems.length, 0);
  if (failed.length) {
    console.log(`נכשל: ${count} ממצאים ב-${failed.map((r) => r.name).join(", ")}\n`);
    process.exit(1);
  }
  console.log(`הכול עבר — ${results.length} בדיקות\n`);
})();
