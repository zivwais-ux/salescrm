/* ============================================================================
   משימות ופעילות מול לקוחות: תיעוד שיחות, הצעות מחיר ותזכורות מעקב.
   ========================================================================== */
window.ViewActivity = (function () {
  const KINDS = { note: "הערה", call: "שיחה", meeting: "פגישה",
                  quote: "הצעת מחיר", issue: "תקלה" };
  const ui = { filter: "open" };

  function render(root, ctx) {
    const all = Store.state.activities.slice()
      .sort((a, b) => (b.follow_up_on || b.happened_on).localeCompare(
        a.follow_up_on || a.happened_on));
    const today = new Date().toISOString().slice(0, 10);
    const list = all.filter((a) => (
      ui.filter === "all" || (ui.filter === "open" ? !a.done : a.done)
    ));
    const overdue = all.filter((a) => !a.done && a.follow_up_on && a.follow_up_on < today);

    const options = Store.parties()
      .sort((a, b) => a.name.localeCompare(b.name, "he"))
      .map((p) => `<option value="${Fmt.escape(p.no)}">${Fmt.escape(p.name)}</option>`).join("");

    root.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head">
            <h3>רישום חדש</h3>
            <p>נשמר על כרטיס הלקוח</p>
          </div>
          <div class="form-grid">
            <label class="stacked"><span>לקוח</span><select id="act-party">${options}</select></label>
            <label class="stacked"><span>סוג</span>
              <select id="act-kind">${Object.entries(KINDS).map(([k, v]) => (
                `<option value="${k}">${v}</option>`)).join("")}</select></label>
            <label class="stacked"><span>תאריך</span>
              <input type="date" id="act-date" value="${today}"></label>
            <label class="stacked"><span>תזכורת למעקב</span>
              <input type="date" id="act-follow"></label>
          </div>
          <label class="stacked" style="margin-top:12px"><span>כותרת</span>
            <input id="act-title" placeholder="למשל: לבדוק ירידה בהזמנות"></label>
          <label class="stacked" style="margin-top:12px"><span>פירוט</span>
            <textarea id="act-body"></textarea></label>
          <div class="form-actions" style="margin-top:12px">
            <button class="btn btn-primary" id="act-save">שמירה</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>מעקב</h3>
            <div class="form-actions">
              ${["open", "done", "all"].map((key) => `
                <button class="btn btn-sm ${ui.filter === key ? "btn-primary" : ""}"
                        data-filter="${key}">${
                  { open: "פתוחות", done: "הושלמו", all: "הכול" }[key]}</button>`).join("")}
            </div>
          </div>
          ${overdue.length ? `<p class="hint" style="color:var(--down)">${
            overdue.length} משימות עברו את תאריך המעקב</p>` : ""}
          <div class="list">
            ${list.map((a) => `
              <div class="list-item ${a.done ? "done" : ""}">
                <div>
                  <strong>${Fmt.escape(a.title)}</strong>
                  <span class="sub">
                    <a href="#" data-customer="${Fmt.escape(a.party_no)}">${
                      Fmt.escape(Store.partyName(a.party_no))}</a>
                    · ${KINDS[a.kind] || a.kind} · ${Fmt.date(a.happened_on)}${
                      a.follow_up_on ? ` · מעקב ${Fmt.date(a.follow_up_on)}` : ""}
                  </span>
                  ${a.body ? `<span class="sub">${Fmt.escape(a.body)}</span>` : ""}
                </div>
                <div class="form-actions">
                  <button class="btn btn-sm" data-toggle="${a.id}">${
                    a.done ? "החזרה" : "בוצע"}</button>
                  <button class="btn btn-sm btn-danger" data-del="${a.id}">מחיקה</button>
                </div>
              </div>`).join("") || '<p class="empty">אין רישומים להצגה.</p>'}
          </div>
        </div>
      </div>`;

    root.querySelector("#act-save").addEventListener("click", async () => {
      const title = root.querySelector("#act-title").value.trim();
      if (!title) return App.toast("צריך כותרת");
      await Store.addActivity({
        party_no: root.querySelector("#act-party").value,
        kind: root.querySelector("#act-kind").value,
        happened_on: root.querySelector("#act-date").value,
        follow_up_on: root.querySelector("#act-follow").value || null,
        title,
        body: root.querySelector("#act-body").value.trim(),
      });
      App.toast("הרישום נשמר");
    });

    root.querySelectorAll("[data-filter]").forEach((btn) => btn.addEventListener("click", () => {
      ui.filter = btn.dataset.filter;
      render(root, ctx);
    }));
    root.querySelectorAll("[data-toggle]").forEach((btn) => btn.addEventListener("click", () => {
      Store.toggleActivity(btn.dataset.toggle);
    }));
    root.querySelectorAll("[data-del]").forEach((btn) => btn.addEventListener("click", () => {
      Store.deleteActivity(btn.dataset.del);
    }));
    root.querySelectorAll("[data-customer]").forEach((link) => link.addEventListener("click", (e) => {
      e.preventDefault();
      App.openCustomer(link.dataset.customer);
    }));
  }

  return { render, KINDS };
})();
