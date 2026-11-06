/* ============================================================================
   הנתונים. הבדיקה החשובה ביותר בחבילה.

   חמש שנות מכירות נקראו מדוחות ה-ERP ואומתו לאגורה מול סיכומי הבקרה
   המודפסים. כל שינוי באתר — גם שינוי עיצוב — חייב להשאיר אותם כפי שהם.
   ========================================================================== */
const { open } = require("../lib/harness");

async function run(browser, url) {
  const problems = [];
  const notes = [];
  const page = await open(browser, url);

  const totals = await page.evaluate(() => {
    const out = { years: {}, sales: Store.sales().length, parties: Store.parties().length,
                  agents: Store.state.agents.length };
    Store.years().forEach((y) => {
      const live = Math.round(Metrics.sum(Metrics.monthly({ year: y, agent: "all" })) * 100) / 100;
      const control = (Store.control(y) || {}).total;
      out.years[y] = { live, control,
                       drift: control === undefined ? null
                         : Math.round((live - control) * 100) / 100 };
    });
    return out;
  });

  Object.entries(totals.years).forEach(([year, r]) => {
    if (r.control === undefined || r.control === null) {
      notes.push(`${year}: ${r.live.toLocaleString("he-IL")} (אין שורת בקרה)`);
      return;
    }
    if (r.drift !== 0) {
      problems.push(`${year}: ${r.live.toLocaleString("he-IL")} מול ${
        r.control.toLocaleString("he-IL")} בדוח — סטייה ${r.drift}`);
    } else {
      notes.push(`${year}: ${r.live.toLocaleString("he-IL")} ✓`);
    }
  });
  notes.push(`${totals.sales} תנועות · ${totals.parties} לקוחות · ${totals.agents} סוכנים`);

  /* --- עריכה וביטול מחזירים בדיוק את המצב הקודם --- */
  const undo = await page.evaluate(() => {
    const before = Math.round(Metrics.sum(Metrics.monthly({ year: 2026, agent: "all" })) * 100) / 100;
    const party = Store.parties()[0];
    Store.setSale(party.no, party.no, 2026, 3, 123456, Store.state.agents[0].no);
    const after = Math.round(Metrics.sum(Metrics.monthly({ year: 2026, agent: "all" })) * 100) / 100;
    Store.undo();
    const back = Math.round(Metrics.sum(Metrics.monthly({ year: 2026, agent: "all" })) * 100) / 100;
    return { before, after, back };
  });
  if (undo.after === undo.before) problems.push("עריכה ידנית לא שינתה את הסכום");
  if (undo.back !== undo.before) {
    problems.push(`ביטול לא החזיר את המצב: ${undo.before} → ${undo.back}`);
  } else {
    notes.push("עריכה וביטול מחזירים את הסכום המדויק ✓");
  }

  /* --- מיזוג לקוחות שומר על סך המחזור --- */
  const merge = await page.evaluate(() => {
    const book = Metrics.catalog();
    const list = Store.parties().filter((p) => book.shipTo.has(p.no)).slice(0, 2);
    if (list.length < 2) return null;
    const before = Math.round(Metrics.sum(Store.sales().map((s) => s.a)) * 100) / 100;
    Store.mergeParty(list[0].no, list[1].no);
    const after = Math.round(Metrics.sum(Store.sales().map((s) => s.a)) * 100) / 100;
    Store.undo();
    return { before, after };
  });
  if (merge && merge.before !== merge.after) {
    problems.push(`איחוד לקוחות שינה את המחזור: ${merge.before} → ${merge.after}`);
  } else if (merge) {
    notes.push("איחוד לקוחות שומר על סך המחזור ✓");
  }

  problems.push(...page.errors.map((e) => `שגיאת דף: ${e}`));
  await page.context().close();
  return { name: "נתונים", problems, notes };
}

module.exports = { run };
