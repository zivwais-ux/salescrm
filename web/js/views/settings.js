/* ============================================================================
   הגדרות: חיבור ל-Supabase, ייצוא/ייבוא אקסל, וניהול הנתונים המקומיים.
   ========================================================================== */
window.ViewSettings = (function () {
  function render(root, ctx) {
    const saved = Store.settings();
    const connected = Store.state.backend === "supabase";
    const autoExcel = saved.autoExcel !== false;

    root.innerHTML = `
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <h3>חיבור ל-Supabase</h3>
            <span class="badge ${connected ? "up" : ""}">${
              connected ? "מחובר" : "עובד מקומית"}</span>
          </div>
          <p class="hint">
            בלי חיבור המערכת עובדת מהדפדפן בלבד, והנתונים נשמרים במחשב הזה.
            עם חיבור כל שינוי נשמר בענן וזמין מכל מכשיר.
            להקמה ראשונה: להריץ את <code>db/schema.sql</code> ואז <code>db/seed.sql</code>
            בעורך ה-SQL של הפרויקט.
          </p>
          <div class="form-grid" style="margin-top:12px">
            <label class="stacked"><span>Project URL</span>
              <input id="sb-url" value="${Fmt.escape(saved.supabaseUrl || "")}"
                     placeholder="https://xxxx.supabase.co"></label>
            <label class="stacked"><span>Anon key</span>
              <input id="sb-key" value="${Fmt.escape(saved.supabaseAnonKey || "")}"
                     placeholder="eyJ..."></label>
          </div>
          <div class="form-actions" style="margin-top:12px">
            <button class="btn btn-primary" id="sb-connect">התחברות ומשיכת נתונים</button>
            <button class="btn" id="sb-push" ${connected ? "" : "disabled"}>
              העלאת הנתונים המקומיים לענן</button>
            <button class="btn" id="sb-pull" ${connected ? "" : "disabled"}>רענון מהענן</button>
            <button class="btn btn-danger" id="sb-off" ${connected ? "" : "disabled"}>ניתוק</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>אקסל</h3>
            <p>הקובץ נשאר המסמך הרשמי - המערכת רק מחזיקה אותו מעודכן</p>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="xl-export">הורדת קובץ מעודכן</button>
            <label class="btn" style="cursor:pointer">
              ייבוא מקובץ אקסל
              <input type="file" id="xl-import" accept=".xlsx,.xls,.csv" hidden>
            </label>
            <button class="btn" id="xl-cloud" ${connected ? "" : "disabled"}>
              עדכון העותק בענן עכשיו</button>
          </div>
          <label class="field" style="margin-top:12px">
            <input type="checkbox" id="xl-auto" ${autoExcel ? "checked" : ""}>
            <span>לעדכן את הקובץ בענן אוטומטית אחרי כל שינוי (דורש חיבור ל-Supabase)</span>
          </label>
          <p class="hint" style="margin-top:8px">
            הייבוא קורא את גיליון "נתוני גלם": מס' לקוח, מס' משלם, שנה, חודש וסכום.
            שורה עם סכום 0 מוחקת את התנועה המתאימה.
          </p>
        </div>

        <div class="card">
          <div class="card-head"><h3>נתונים</h3></div>
          <div class="grid grid-kpi">
            <div><div class="kpi-label">לקוחות</div>
              <div class="kpi-value">${Fmt.number(Store.parties().length)}</div></div>
            <div><div class="kpi-label">תנועות מכירה</div>
              <div class="kpi-value">${Fmt.number(Store.sales().length)}</div></div>
            <div><div class="kpi-label">שנים</div>
              <div class="kpi-value">${Store.years().join(", ")}</div></div>
            <div><div class="kpi-label">רישומי פעילות</div>
              <div class="kpi-value">${Fmt.number(Store.state.activities.length)}</div></div>
          </div>
          <div class="form-actions" style="margin-top:14px">
            <button class="btn btn-danger" id="reset">איפוס לנתוני הדוחות המקוריים</button>
          </div>
          <p class="hint">
            האיפוס מוחק שינויים ידניים, יעדים ורישומי פעילות שנשמרו במחשב הזה,
            ומחזיר את הנתונים כפי שהופקו מדוחות ה-PDF של 2025 ו-2026.
          </p>
        </div>
      </div>`;

    root.querySelector("#sb-connect").addEventListener("click", async () => {
      const url = root.querySelector("#sb-url").value.trim();
      const key = root.querySelector("#sb-key").value.trim();
      if (!url || !key) return App.toast("צריך למלא כתובת ומפתח");
      App.toast("מתחבר...");
      try {
        await Store.connect(url, key);
        App.toast("החיבור הצליח והנתונים נמשכו");
      } catch (err) {
        App.toast(`החיבור נכשל: ${err.message}`);
      }
    });

    root.querySelector("#sb-push").addEventListener("click", async () => {
      App.toast("מעלה...");
      try {
        await Store.pushAll();
        App.toast("הנתונים הועלו לענן");
      } catch (err) {
        App.toast(`ההעלאה נכשלה: ${err.message}`);
      }
    });

    root.querySelector("#sb-pull").addEventListener("click", async () => {
      try {
        await Store.pull();
        App.toast("הנתונים רועננו");
      } catch (err) {
        App.toast(`הרענון נכשל: ${err.message}`);
      }
    });

    root.querySelector("#sb-off").addEventListener("click", () => {
      Store.disconnect();
      App.toast("החיבור נותק. המערכת ממשיכה לעבוד מקומית.");
    });

    root.querySelector("#xl-export").addEventListener("click", () => App.exportExcel());

    root.querySelector("#xl-cloud").addEventListener("click", async () => {
      try {
        await Excel.syncToCloud(ctx.agent);
        App.toast("הקובץ בענן עודכן");
      } catch (err) {
        App.toast(`העדכון נכשל: ${err.message}`);
      }
    });

    root.querySelector("#xl-auto").addEventListener("change", (e) => {
      Store.saveSettings({ autoExcel: e.target.checked });
      App.toast(e.target.checked ? "עדכון אוטומטי הופעל" : "עדכון אוטומטי בוטל");
    });

    root.querySelector("#xl-import").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      App.toast("קורא את הקובץ...");
      try {
        const rows = await Excel.read(file);
        if (!rows.length) return App.toast("לא נמצאו שורות מתאימות בקובץ");
        await Store.importRows(rows);
        App.toast(`יובאו ${rows.length} שורות`);
      } catch (err) {
        App.toast(`הייבוא נכשל: ${err.message}`);
      } finally {
        e.target.value = "";
      }
    });

    root.querySelector("#reset").addEventListener("click", async () => {
      if (!confirm("לאפס את כל הנתונים המקומיים ולחזור לדוחות המקוריים?")) return;
      await Store.resetToSeed();
      App.toast("הנתונים אופסו");
    });
  }

  return { render };
})();
