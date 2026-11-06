/* ============================================================================
   התנהגות המעטפת — מה ששלב "לתקן את הקפיצות" הבטיח.

   אלה אינן בדיקות מראה אלא בדיקות תחושה: שהמעטפת אינה נבנית מחדש, שהפוקוס
   לא הולך לאיבוד תוך כדי הקלדה, ושכל מסך זוכר איפה היה. כולן נשברו פעם.
   ========================================================================== */
const { open, go } = require("../lib/harness");

async function run(browser, url) {
  const problems = [];
  const notes = [];
  const page = await open(browser, url);
  const ok = (pass, good, bad) => (pass ? notes.push(`${good} ✓`) : problems.push(bad));

  /* --- המעטפת שורדת ניווט: מסמנים צמתים ובודקים שהם אותם צמתים --- */
  await page.evaluate(() => {
    ["#sidebar", "#topbar", "#tabbar"].forEach((s) => {
      document.querySelector(s).dataset.mark = "1";
    });
    document.querySelector("#sidebar [data-nav]").dataset.mark = "1";
  });
  await go(page, "customers", 400);
  await go(page, "trend", 400);
  const shell = await page.evaluate(() => ({
    kept: ["#sidebar", "#topbar", "#tabbar", "#sidebar [data-nav]"]
      .every((s) => document.querySelector(s).dataset.mark === "1"),
    active: document.querySelector("#sidebar .nav-item.is-active").dataset.nav,
    title: document.querySelector("#page-title").textContent,
  }));
  ok(shell.kept, "המעטפת אינה נבנית מחדש בניווט", "המעטפת נבנתה מחדש בניווט");
  ok(shell.active === "trend" && shell.title === "מגמה",
    "הפריט הפעיל והכותרת מתעדכנים", `הפריט הפעיל לא התעדכן (${shell.title})`);

  /* --- הקלדה בחיפוש: הפוקוס, הערך והסמן נשארים, והרשימה מסוננת --- */
  await go(page, "customers", 450);
  const before = await page.evaluate(() =>
    document.querySelectorAll("tbody tr[data-no]").length);
  await page.click("#cust-search");
  await page.type("#cust-search", "קרגל", { delay: 45 });
  await page.waitForTimeout(250);
  const typing = await page.evaluate(() => ({
    focused: document.activeElement.id,
    value: document.activeElement.value,
    caret: document.activeElement.selectionStart,
    rows: document.querySelectorAll("tbody tr[data-no]").length,
  }));
  ok(typing.focused === "cust-search", "הפוקוס נשאר בשדה החיפוש",
    `הפוקוס עבר ל-${typing.focused}`);
  ok(typing.value === "קרגל" && typing.caret === 4, "הערך והסמן נשמרים",
    `הערך "${typing.value}", הסמן ${typing.caret}`);
  ok(typing.rows > 0 && typing.rows < before, "החיפוש מסנן את הטבלה",
    `${before} שורות → ${typing.rows}`);

  /* --- מנות ברשימה, ואיפוס המנה בסינון --- */
  await page.evaluate(() => {
    const box = document.querySelector("#cust-search");
    box.value = "";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const paging = await page.evaluate(() => ({
    first: document.querySelectorAll("tbody tr[data-no]").length,
    more: !document.querySelector("#cust-more").hidden,
  }));
  if (paging.more) {
    await page.click("#cust-more");
    await page.waitForTimeout(250);
    const second = await page.evaluate(() =>
      document.querySelectorAll("tbody tr[data-no]").length);
    ok(second > paging.first, "טעינת מנה נוספת מוסיפה שורות",
      `${paging.first} → ${second}`);
  }

  /* --- זיכרון גלילה --- */
  await go(page, "dashboard", 450);
  await page.evaluate(() => window.scrollTo({ top: 900 }));
  await page.waitForTimeout(200);
  const parked = await page.evaluate(() => window.scrollY);
  await go(page, "settings", 450);
  const atTop = await page.evaluate(() => window.scrollY);
  await go(page, "dashboard", 500);
  const back = await page.evaluate(() => window.scrollY);
  ok(atTop < 40, "מסך חדש נפתח מלמעלה", `מסך חדש נפתח ב-${atTop}px`);
  ok(parked > 100 && Math.abs(back - parked) < 40, "חזרה למסך משחזרת את הגלילה",
    `${parked}px → ${back}px`);

  /* --- שינוי שנה אינו זורק את הקורא למעלה --- */
  await page.evaluate(() => window.scrollTo({ top: 500 }));
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => window.scrollY);
  await page.click('#ctxbar [data-year="2024"]');
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => ({
    scroll: window.scrollY,
    year: document.querySelector("#ctxbar .is-active").dataset.year,
  }));
  ok(Math.abs(after.scroll - held) < 40, "שינוי שנה שומר על מיקום הגלילה",
    `${held}px → ${after.scroll}px`);
  ok(after.year === "2024", "השנה מתחלפת", `השנה היא ${after.year}`);

  problems.push(...page.errors.map((e) => `שגיאת דף: ${e}`));
  await page.context().close();
  return { name: "התנהגות", problems, notes };
}

module.exports = { run };
