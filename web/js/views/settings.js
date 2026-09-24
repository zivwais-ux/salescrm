/* ============================================================================
   נתונים וקבצים — ייצוא וייבוא אקסל, גיבוי מלא, ואיפוס לנתוני הדוחות.
   ========================================================================== */
window.ViewSettings = (function () {
  /**
   * הצלבה מול הדוח המקורי.
   *
   * הדוח מדפיס שורת "סה"כ כללי" משלו, והיא נשמרת בנפרד מהנתונים. הטבלה כאן
   * משווה את מה שהמערכת מחזיקה עכשיו מול אותה שורה — כך שאחרי עריכה ידנית
   * רואים בדיוק במה המערכת כבר שונה מהדוח, במקום להניח שהיא זהה לו.
   */
  const ui = { year: null };

  function reconciliation(ctx) {
    const years = Store.years().slice().reverse();
    if (!ui.year || !years.includes(ui.year)) ui.year = ctx.year || years[0];

    const state = (year) => {
      const control = Store.control(year) || { total: 0, months: {} };
      const live = Metrics.monthly({ year, agent: "all" });
      const liveTotal = Metrics.sum(live);
      // עיגול לאגורה לפני ההשוואה: סכום של אלפי מספרים עשרוניים משאיר שארית
      // זעירה בייצוג הבינארי, והיא אינה הפרש אמיתי מול הדוח.
      // חודש שהוזן ידנית ואינו בדוח אינו "הפרש" אלא תוספת, ולכן הוא נספר
      // בנפרד — אחרת ההצלבה היתה מסמנת את ההזנה כשגיאה.
      const beyond = Metrics.sum(live.map((value, i) => (
        control.months[String(i + 1)] === undefined ? value : 0)));
      return { year, control, live, liveTotal, beyond,
               hasControl: !!Store.control(year),
               drift: Math.round((liveTotal - beyond - control.total) * 100) / 100 };
    };

    const all = years.map(state).filter(Boolean);
    const current = all.find((row) => row.year === ui.year) || all[0];
    if (!current) return "";
    const months = Array.from({ length: Store.closedMonth(current.year) }, (_, i) => i + 1);
    const off = all.filter((row) => row.drift);
    const added = all.filter((row) => row.beyond);

    return UI.card("הצלבה מול הדוח המקורי", {
      sub: off.length
        ? `${off.length} שנים שונות מהדוח — ${off.map((r) => r.year).join(", ")}`
        : `${all.filter((r) => r.hasControl).length} השנים שיש להן דוח תואמות לאגורה${
            added.length ? `, ובנוסף הוזנו ידנית חודשים ב-${
              added.map((r) => r.year).join(", ")}` : ""}`,
      actions: `<div class="seg">
        ${all.map((row) => `<button data-year-check="${row.year}" class="${
          row.year === ui.year ? "is-active" : ""}">${row.year}
          <span class="chip-count ${row.drift ? "is-late" : ""}">${
            !row.hasControl ? "ידני" : row.drift ? "≠" : "✓"}</span></button>`).join("")}
      </div>`,
      flush: true,
      body: `<div class="table-wrap" style="max-height:420px">
        <table>
          <thead><tr>
            <th>חודש</th><th class="num">בדוח</th>
            <th class="num">במערכת</th><th class="num">הפרש</th>
          </tr></thead>
          <tbody>
            ${months.map((m) => {
              const printed = current.control.months[String(m)];
              const actual = current.live[m - 1];
              if (printed === undefined) {
                return `<tr>
                  <td>${Fmt.month(m)}</td>
                  <td class="num" style="color:var(--muted)">—</td>
                  <td class="num">${Fmt.moneyExact(actual)}</td>
                  <td class="num"><span class="badge accent">הוזן ידנית</span></td>
                </tr>`;
              }
              const diff = Math.round((actual - printed) * 100) / 100;
              return `<tr>
                <td>${Fmt.month(m)}</td>
                <td class="num" style="color:var(--muted)">${Fmt.moneyExact(printed)}</td>
                <td class="num">${Fmt.moneyExact(actual)}</td>
                <td class="num">${diff
                  ? `<span class="delta down">${Fmt.signed(diff)}</span>`
                  : `<span class="badge up">${UI.icon("check", 12)}</span>`}</td>
              </tr>`;
            }).join("")}
          </tbody>
          <tfoot><tr>
            <td style="font-weight:600">סה״כ ${current.year}</td>
            <td class="num" style="color:var(--muted)">${current.hasControl
              ? Fmt.moneyExact(current.control.total) : "אין דוח"}</td>
            <td class="num" style="font-weight:600">${Fmt.moneyExact(current.liveTotal)}</td>
            <td class="num">${current.drift
              ? `<span class="delta down">${Fmt.signed(current.drift)}</span>`
              : current.hasControl
                ? `<span class="badge up">${UI.icon("check", 12)} תואם</span>`
                : `<span class="badge accent">הוזן ידנית</span>`}</td>
          </tr></tfoot>
        </table>
      </div>
      ${current.beyond ? `<div class="toolbar" style="border-bottom:0">
        <span class="hint">${Fmt.money(current.beyond)} מתוך הסכום הוזנו ידנית בחודשים
          שאינם בדוח, ולכן אינם נספרים כהפרש מולו.</span>
      </div>` : ""}`,
    });
  }

  /**
   * שורות שהדוח תמחר במטבע אחר.
   *
   * הדוח מחבר אותן לסיכומים שלו כמו שהן, ולכן גם המערכת — אחרת ההצלבה מול
   * הדוח היתה מראה פער קבוע. הן מופיעות כאן כדי שמי שקורא מספר שנתי יידע
   * בדיוק מה מונח בתוכו.
   */
  function foreignCard() {
    const rows = Metrics.foreign();
    if (!rows.length) return "";
    return UI.card("שורות במטבע אחר", {
      sub: `${rows.length} שורות שהדוח תמחר שלא בשקלים, וסיכם כמו שהן`,
      flush: true,
      body: `<div class="table-wrap"><table>
        <thead><tr><th>לקוח</th><th>מועד</th><th>מטבע</th><th class="num">סכום בדוח</th></tr></thead>
        <tbody>${rows.map((s) => `
          <tr class="row-link" data-customer="${Fmt.escape(s.c)}">
            <td>${Fmt.escape(s.name)}</td>
            <td>${Fmt.month(s.m)} ${s.y}</td>
            <td><span class="badge warn">${Fmt.escape(s.cur)}</span></td>
            <td class="num">${Fmt.moneyExact(s.a).replace(" ₪", "")}</td>
          </tr>`).join("")}</tbody>
      </table></div>
      <div class="toolbar" style="border-bottom:0">
        <span class="hint">סך ${Fmt.money(Metrics.sum(rows.map((r) => r.a)))} מתוך
          ${Fmt.money(Metrics.sum(Store.sales().map((r) => r.a)))} — כ-${
          ((Metrics.sum(rows.map((r) => r.a))
            / Metrics.sum(Store.sales().map((r) => r.a))) * 100).toFixed(1)}% מהמחזור.
          הדוח אינו ממיר אותן לשקלים, וגם המערכת לא.</span>
      </div>`,
    });
  }

  function render(root, ctx) {
    const years = Store.years();
    const saved = Store.state.savedAt;
    const manual = Store.sales().filter((s) => s.source === "manual").length;
    const book = Metrics.catalog();

    root.innerHTML = `
      <div class="grid cols-2" style="align-items:start">
        ${UI.card("קובץ האקסל", {
          sub: "הקובץ נשאר המסמך הרשמי — המערכת מחזיקה אותו מעודכן",
          body: `
            <div class="row-actions">
              <button class="btn btn-primary" id="xl-export">
                ${UI.icon("download", 15)} הורדת קובץ מעודכן</button>
              <label class="btn" style="cursor:pointer">
                ${UI.icon("upload", 15)} ייבוא מקובץ
                <input type="file" id="xl-import" accept=".xlsx,.xls,.csv" hidden>
              </label>
            </div>
            <p class="hint" style="margin-top:12px">
              הקובץ נבנה לפי מבנה הדוח: גיליון ניתוח מכירות לכל שנה, נתוני גלם,
              סיכום חודשי, ויעדים ומעקב. הייבוא קורא את גיליון "נתוני גלם"
              (מס׳ לקוח, מס׳ משלם, שנה, חודש וסכום); שורה עם סכום 0 מוחקת את
              התנועה המתאימה.
            </p>`,
        })}

        ${UI.card("גיבוי המערכת", {
          sub: "כולל יעדים, פעילות ופרטי לקוחות — לא רק סכומים",
          body: `
            <div class="row-actions">
              <button class="btn" id="bk-export">${UI.icon("download", 15)} שמירת גיבוי</button>
              <label class="btn" style="cursor:pointer">
                ${UI.icon("upload", 15)} טעינת גיבוי
                <input type="file" id="bk-import" accept=".json" hidden>
              </label>
            </div>
            <p class="hint" style="margin-top:12px">
              הנתונים נשמרים בדפדפן הזה בלבד. גיבוי הוא הדרך להעביר אותם
              למחשב אחר, או לחזור אחורה אחרי שינוי גדול.
            </p>`,
        })}
      </div>

      ${UI.card("מצב הנתונים", {
        flush: true,
        body: `
          <div class="grid cols-4" style="gap:0">
            ${[
              ["לקוחות (יעד משלוח)", Fmt.number(book.shipTo.size)],
              ["משלמים בלבד", Fmt.number(book.payerOnly.size)],
              ["תנועות מכירה", Fmt.number(Store.sales().length)],
              ["מתוכן נרשמו ידנית", Fmt.number(manual)],
            ].map(([label, value], i) => `
              <div class="kpi" style="${i ? "border-inline-start:1px solid var(--line)" : ""}">
                <div class="kpi-label">${label}</div>
                <div class="kpi-value" style="font-size:20px">${value}</div>
              </div>`).join("")}
          </div>
          <div class="toolbar" style="border-bottom:0;border-top:1px solid var(--line)">
            <span class="hint">שנים ${years.join(" · ")}${
              saved ? ` · נשמר לאחרונה ${new Date(saved).toLocaleString("he-IL")}` : ""}</span>
            <div class="spacer">
              <button class="btn btn-danger" id="reset">
                ${UI.icon("undo", 15)} איפוס לנתוני הדוחות המקוריים</button>
            </div>
          </div>`,
      })}

      ${foreignCard()}

      ${reconciliation(ctx)}`;

    UI.on(root, "[data-customer]", "click",
      (e) => App.openCustomer(e.currentTarget.dataset.customer));

    UI.on(root, "[data-year-check]", "click", (e) => {
      ui.year = Number(e.currentTarget.dataset.yearCheck);
      render(root, ctx);
    });

    root.querySelector("#xl-export").addEventListener("click", () => App.exportExcel());

    root.querySelector("#xl-import").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      App.toast("קורא את הקובץ…");
      try {
        const rows = await Excel.read(file);
        if (!rows.length) return App.toast("לא נמצאו שורות מתאימות בקובץ", "down");
        Store.importRows(rows);
        App.toast(`יובאו ${rows.length} שורות`, "up", { undo: true });
      } catch (err) {
        App.toast(err.message, "down");
      } finally {
        e.target.value = "";
      }
    });

    root.querySelector("#bk-export").addEventListener("click", () => {
      const blob = new Blob([Store.exportState()], { type: "application/json" });
      App.saveAs(blob, `sales-backup-${new Date().toISOString().slice(0, 10)}.json`);
      App.toast("הגיבוי ירד למחשב", "up");
    });

    root.querySelector("#bk-import").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        Store.importState(await file.text());
        App.toast("הגיבוי נטען", "up", { undo: true });
      } catch (err) {
        App.toast(`הטעינה נכשלה: ${err.message}`, "down");
      } finally {
        e.target.value = "";
      }
    });

    root.querySelector("#reset").addEventListener("click", () => {
      App.confirm({
        title: "לאפס את כל הנתונים?",
        body: "השינויים הידניים, היעדים ורישומי הפעילות שנשמרו במחשב הזה יימחקו, "
            + `והנתונים יחזרו לדוחות המקוריים של ${years.join(", ")}.`,
        danger: "איפוס",
        onConfirm() {
          Store.resetToSeed();
          App.toast("הנתונים אופסו", "", { undo: true });
        },
      });
    });
  }

  return { render };
})();
