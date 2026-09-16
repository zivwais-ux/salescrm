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
  function reconciliation(ctx) {
    const years = Store.years().slice().reverse();
    const blocks = years.map((year) => {
      const control = Store.control(year);
      if (!control) return "";
      const live = Metrics.monthly({ year, agent: "all" });
      const liveTotal = Metrics.sum(live);
      // עיגול לאגורה לפני ההשוואה: סכום של אלפי מספרים עשרוניים משאיר שארית
      // זעירה בייצוג הבינארי, והיא אינה הפרש אמיתי מול הדוח.
      const drift = Math.round((liveTotal - control.total) * 100) / 100;
      const months = Object.keys(control.months).map(Number).sort((a, b) => a - b);

      return `<section class="card">
        <header class="card-head">
          <div>
            <h3>${year}</h3>
            <div class="sub">מול "סה״כ כללי" שבדוח המקורי</div>
          </div>
          <div class="spacer">
            <span class="badge ${drift ? "warn" : "up"}">${
              drift ? `הפרש ${Fmt.signed(drift)}` : "תואם לאגורה"}</span>
          </div>
        </header>
        <div class="card-body flush">
          <div class="table-wrap" style="max-height:290px">
            <table>
              <thead><tr>
                <th>חודש</th><th class="num">בדוח</th>
                <th class="num">במערכת</th><th class="num">הפרש</th>
              </tr></thead>
              <tbody>
                ${months.map((m) => {
                  const printed = control.months[String(m)];
                  const actual = live[m - 1];
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
                <td style="font-weight:600">סה״כ</td>
                <td class="num" style="color:var(--muted)">${Fmt.moneyExact(control.total)}</td>
                <td class="num" style="font-weight:600">${Fmt.moneyExact(liveTotal)}</td>
                <td class="num">${drift
                  ? `<span class="delta down">${Fmt.signed(drift)}</span>`
                  : `<span class="badge up">${UI.icon("check", 12)}</span>`}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      </section>`;
    }).join("");

    return `<div class="grid cols-2" style="align-items:start">${blocks}</div>`;
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
              הקובץ נבנה בארבעה גיליונות: ניתוח מכירות לכל שנה, נתוני גלם,
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

      ${reconciliation(ctx)}`;

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
            + "והנתונים יחזרו לדוחות המקוריים של 2025 ו-2026.",
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
