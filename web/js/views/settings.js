/* ============================================================================
   נתונים וקבצים — ייצוא וייבוא אקסל, גיבוי מלא, ואיפוס לנתוני הדוחות.
   ========================================================================== */
window.ViewSettings = (function () {
  function render(root, ctx) {
    const years = Store.years();
    const saved = Store.state.savedAt;
    const manual = Store.sales().filter((s) => s.source === "manual").length;

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
              ["לקוחות בתיק", Fmt.number(Store.parties().length)],
              ["תנועות מכירה", Fmt.number(Store.sales().length)],
              ["מתוכן נרשמו ידנית", Fmt.number(manual)],
              ["שנים", years.join(" · ")],
            ].map(([label, value], i) => `
              <div class="kpi" style="${i ? "border-inline-start:1px solid var(--line)" : ""}">
                <div class="kpi-label">${label}</div>
                <div class="kpi-value" style="font-size:20px">${value}</div>
              </div>`).join("")}
          </div>
          <div class="toolbar" style="border-bottom:0;border-top:1px solid var(--line)">
            <span class="hint">${saved ? `נשמר לאחרונה ${new Date(saved).toLocaleString("he-IL")}`
              : "עוד לא נשמר שינוי"}</span>
            <div class="spacer">
              <button class="btn btn-danger" id="reset">
                ${UI.icon("undo", 15)} איפוס לנתוני הדוחות המקוריים</button>
            </div>
          </div>`,
      })}

      ${UI.card("מאיפה הנתונים", {
        body: `<p class="hint" style="line-height:1.7">
          הנתונים הופקו מדוחות "ניתוח מכירות (ת.משלוח) — מחירים" של 2025 ו-2026.
          סכומי כל 21 החודשים והסכום הכולל הוצלבו מול הסיכומים שבדוח עצמו
          ותואמים לאגורה: ${Fmt.moneyExact(16203057.74)} ב-2025
          ו-${Fmt.moneyExact(11228824.09)} ב-2026.
        </p>`,
      })}`;

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
