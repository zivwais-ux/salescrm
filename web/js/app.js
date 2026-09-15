/* ============================================================================
   מעטפת האפליקציה: ניווט, מצב נבחר (שנה/סוכן), כרטיס לקוח, והודעות.
   ========================================================================== */
window.App = (function () {
  const ctx = { year: null, agent: "all", view: "dashboard" };
  const VIEWS = {
    dashboard: () => ViewDashboard,
    customers: () => ViewCustomers,
    grid: () => ViewGrid,
    activity: () => ViewActivity,
    settings: () => ViewSettings,
  };
  let openCustomerNo = null;
  let toastTimer = null;
  let excelTimer = null;

  const $ = (sel) => document.querySelector(sel);

  /* ------------------------------------------------------------ תצוגה -- */
  function render() {
    const root = $("#view");
    root.innerHTML = "";
    VIEWS[ctx.view]().render(root, ctx);
    if (openCustomerNo) renderCustomerCard(openCustomerNo);
    syncPill();
  }

  function syncPill() {
    const pill = $("#sync-pill");
    const live = Store.state.backend === "supabase";
    pill.textContent = live ? "מסונכרן לענן" : Store.state.status;
    pill.className = `sync-pill ${live ? "is-live" : ""}`;
  }

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
  }

  /* ------------------------------------------------------------ מגירה -- */
  function openDrawer(html, onReady) {
    const drawer = $("#drawer");
    const panel = $("#drawer-panel");
    panel.innerHTML = html;
    drawer.hidden = false;
    panel.querySelectorAll("[data-close-drawer]").forEach((btn) => {
      btn.addEventListener("click", closeDrawer);
    });
    if (onReady) onReady(panel);
  }

  function closeDrawer() {
    $("#drawer").hidden = true;
    openCustomerNo = null;
  }

  function openCustomer(no) {
    openCustomerNo = no;
    renderCustomerCard(no);
  }

  /** כרטיס לקוח: היסטוריה, משלמים, יעד, פרטי קשר ופעילות. */
  function renderCustomerCard(no) {
    const party = Store.party(no);
    if (!party) return closeDrawer();
    const view = Metrics.overview(ctx);
    const row = view.customers.find((c) => c.no === no) ||
      { months: Array(12).fill(0), priorMonths: Array(12).fill(0), ytd: 0, priorYtd: 0,
        changePct: null, payers: [], target: 0, profile: party.profile, lastActive: 0,
        activeMonths: 0 };
    const history = Metrics.customerHistory(no);
    const activities = Store.state.activities.filter((a) => a.party_no === no);
    const statuses = ViewCustomers.STATUS;

    openDrawer(`
      <div class="drawer-head">
        <div>
          <h2>${Fmt.escape(party.name)}</h2>
          <p class="hint">מספר לקוח ${Fmt.escape(no)}</p>
        </div>
        <button class="btn btn-sm" data-close-drawer>סגירה</button>
      </div>

      <div class="grid grid-kpi">
        <div class="card kpi">
          <div class="kpi-label">${ctx.year} עד ${Fmt.month(view.lastMonth)}</div>
          <div class="kpi-value">${Fmt.money(row.ytd)}</div>
          <div class="kpi-foot">${row.changePct === null ? "לקוח חדש"
            : `<span class="delta ${row.changePct >= 0 ? "up" : "down"}">${
                Fmt.percent(row.changePct, 1)}</span> מול ${Fmt.money(row.priorYtd)}`}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">חודשי פעילות</div>
          <div class="kpi-value">${row.activeMonths}</div>
          <div class="kpi-foot">מכירה אחרונה: ${
            row.lastActive ? Fmt.month(row.lastActive) : "—"}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">יעד ${ctx.year}</div>
          <div class="kpi-value">${row.target ? Fmt.money(row.target) : "—"}</div>
          <div class="kpi-foot">${row.target
            ? `${((row.ytd / row.target) * 100).toFixed(0)}% עמידה`
            : "לא הוגדר יעד"}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>מכירות לפי חודש</h3>
          <p>${ctx.year} מול ${view.priorYear}</p>
        </div>
        <div id="card-chart"></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>היסטוריה שנתית</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>שנה</th>${Fmt.SHORT.map((m) => (
              `<th class="num">${m}</th>`)).join("")}<th class="num">סה"כ</th></tr></thead>
            <tbody>${history.map((h) => `
              <tr><td>${h.year}</td>${h.months.map((v) => (
                `<td class="num">${v ? Fmt.short(v) : "—"}</td>`)).join("")}
              <td class="num"><strong>${Fmt.money(h.total)}</strong></td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>

      ${row.payers.length ? `
        <div class="card">
          <div class="card-head">
            <h3>לקוחות משלמים</h3>
            <p>מי שילם בפועל ב-${ctx.year}</p>
          </div>
          <div class="list">${row.payers.map(([payerNo, amount]) => `
            <div class="list-item">
              <div><strong>${Fmt.escape(Store.partyName(payerNo))}</strong>
                <span class="sub">${Fmt.escape(payerNo)}</span></div>
              <div class="num">${Fmt.money(amount)}</div>
            </div>`).join("")}</div>
        </div>` : ""}

      <div class="card">
        <div class="card-head"><h3>פרטי הלקוח</h3></div>
        <div class="form-grid">
          <label class="stacked"><span>שם</span>
            <input id="p-name" value="${Fmt.escape(party.name)}"></label>
          <label class="stacked"><span>סטטוס</span>
            <select id="p-status">${Object.entries(statuses).map(([k, v]) => (
              `<option value="${k}" ${
                (party.profile.status || "active") === k ? "selected" : ""}>${v}</option>`
            )).join("")}</select></label>
          <label class="stacked"><span>דירוג</span>
            <select id="p-tier">${["", "A", "B", "C"].map((t) => (
              `<option ${party.profile.tier === t ? "selected" : ""}>${t || "—"}</option>`
            )).join("")}</select></label>
          <label class="stacked"><span>תחום</span>
            <input id="p-segment" value="${Fmt.escape(party.profile.segment || "")}"></label>
          <label class="stacked"><span>איש קשר</span>
            <input id="p-contact" value="${Fmt.escape(party.profile.contact_name || "")}"></label>
          <label class="stacked"><span>טלפון</span>
            <input id="p-phone" value="${Fmt.escape(party.profile.contact_phone || "")}"></label>
          <label class="stacked"><span>אימייל</span>
            <input id="p-email" value="${Fmt.escape(party.profile.contact_email || "")}"></label>
          <label class="stacked"><span>יעד ${ctx.year} (₪)</span>
            <input id="p-target" inputmode="decimal" value="${row.target || ""}"></label>
        </div>
        <label class="stacked" style="margin-top:12px"><span>הערות</span>
          <textarea id="p-notes">${Fmt.escape(party.profile.notes || "")}</textarea></label>
        <div class="form-actions" style="margin-top:12px">
          <button class="btn btn-primary" id="p-save">שמירה</button>
          <button class="btn btn-danger" id="p-delete">מחיקת הלקוח</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>פעילות</h3></div>
        <div class="form-grid">
          <label class="stacked"><span>סוג</span>
            <select id="a-kind">${Object.entries(ViewActivity.KINDS).map(([k, v]) => (
              `<option value="${k}">${v}</option>`)).join("")}</select></label>
          <label class="stacked"><span>תזכורת</span><input type="date" id="a-follow"></label>
        </div>
        <label class="stacked" style="margin-top:10px"><span>מה קרה</span>
          <input id="a-title" placeholder="תיאור קצר"></label>
        <div class="form-actions" style="margin-top:10px">
          <button class="btn" id="a-add">הוספת רישום</button>
        </div>
        <div class="list" style="margin-top:12px">${activities.map((a) => `
          <div class="list-item ${a.done ? "done" : ""}">
            <div><strong>${Fmt.escape(a.title)}</strong>
              <span class="sub">${ViewActivity.KINDS[a.kind] || a.kind} · ${
                Fmt.date(a.happened_on)}${
                a.follow_up_on ? ` · מעקב ${Fmt.date(a.follow_up_on)}` : ""}</span></div>
            <button class="btn btn-sm" data-toggle="${a.id}">${a.done ? "החזרה" : "בוצע"}</button>
          </div>`).join("") || '<p class="empty">אין רישומים ללקוח הזה.</p>'}
        </div>
      </div>`, (panel) => {
      Charts.groupedBars(panel.querySelector("#card-chart"), [
        { label: `${ctx.year}`, values: row.months, color: Charts.COLORS.current },
        { label: `${view.priorYear}`, values: row.priorMonths, color: Charts.COLORS.prior },
      ], Fmt.SHORT, { height: 200 });

      panel.querySelector("#p-save").addEventListener("click", async () => {
        const name = panel.querySelector("#p-name").value.trim();
        if (name && name !== party.name) await Store.renameParty(no, name);
        await Store.updateProfile(no, {
          status: panel.querySelector("#p-status").value,
          tier: panel.querySelector("#p-tier").value.replace("—", ""),
          segment: panel.querySelector("#p-segment").value.trim(),
          contact_name: panel.querySelector("#p-contact").value.trim(),
          contact_phone: panel.querySelector("#p-phone").value.trim(),
          contact_email: panel.querySelector("#p-email").value.trim(),
          notes: panel.querySelector("#p-notes").value.trim(),
        });
        await Store.setTarget(no, ctx.year, panel.querySelector("#p-target").value);
        toast("פרטי הלקוח נשמרו");
      });

      panel.querySelector("#p-delete").addEventListener("click", async () => {
        if (!confirm(`למחוק את ${party.name} ואת כל תנועות המכירה שלו?`)) return;
        await Store.deleteParty(no);
        closeDrawer();
        toast("הלקוח נמחק");
      });

      panel.querySelector("#a-add").addEventListener("click", async () => {
        const title = panel.querySelector("#a-title").value.trim();
        if (!title) return toast("צריך תיאור");
        await Store.addActivity({
          party_no: no,
          kind: panel.querySelector("#a-kind").value,
          follow_up_on: panel.querySelector("#a-follow").value || null,
          title,
        });
        toast("הרישום נוסף");
      });

      panel.querySelectorAll("[data-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => Store.toggleActivity(btn.dataset.toggle));
      });
    });
  }

  /* ------------------------------------------------------------- אקסל -- */
  async function exportExcel() {
    toast("מכין את הקובץ...");
    try {
      const result = await Excel.download(ctx.agent);
      toast(result.format === "xlsx" ? "הקובץ ירד למחשב"
        : "הקובץ ירד במבנה Excel XML (אין גישה לספריית xlsx)");
    } catch (err) {
      toast(`הייצוא נכשל: ${err.message}`);
    }
  }

  /** עדכון העותק בענן אחרי שינוי, בהשהיה קצרה כדי לא לכתוב על כל הקלדה. */
  function scheduleExcelSync() {
    if (Store.state.backend !== "supabase") return;
    if (Store.settings().autoExcel === false) return;
    clearTimeout(excelTimer);
    excelTimer = setTimeout(() => {
      Excel.syncToCloud(ctx.agent).catch((err) => console.warn("עדכון האקסל נכשל", err));
    }, 4000);
  }

  /* ------------------------------------------------------------- אתחול -- */
  function fillSelectors() {
    const years = Store.years();
    if (!ctx.year || !years.includes(ctx.year)) ctx.year = years[years.length - 1];
    $("#year-select").innerHTML = years.slice().reverse()
      .map((y) => `<option ${y === ctx.year ? "selected" : ""}>${y}</option>`).join("");

    const agents = Store.state.agents;
    $("#agent-select").innerHTML = ['<option value="all">כל הסוכנים</option>']
      .concat(agents.map((a) => `<option value="${Fmt.escape(a.no)}" ${
        ctx.agent === a.no ? "selected" : ""}>${Fmt.escape(a.name)}</option>`)).join("");

    const agentName = ctx.agent === "all" ? "כל הסוכנים"
      : (agents.find((a) => a.no === ctx.agent) || {}).name;
    $("#brand-sub").textContent = `גדות מסופים · סניף 06 · ${agentName}`;
  }

  async function init() {
    await Store.init();
    fillSelectors();

    $("#year-select").addEventListener("change", (e) => {
      ctx.year = Number(e.target.value);
      render();
    });
    $("#agent-select").addEventListener("change", (e) => {
      ctx.agent = e.target.value;
      fillSelectors();
      render();
    });
    $("#btn-export").addEventListener("click", exportExcel);

    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      ctx.view = tab.dataset.view;
      render();
    }));

    document.querySelector(".drawer-backdrop").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer();
    });

    Store.onChange(() => {
      fillSelectors();
      render();
      scheduleExcelSync();
    });

    render();
  }

  return { init, render, toast, openDrawer, closeDrawer, openCustomer, exportExcel, ctx };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init().catch((err) => {
    console.error(err);
    document.querySelector("#view").innerHTML =
      `<div class="card"><p class="empty">טעינת המערכת נכשלה: ${err.message}</p></div>`;
  });
});
