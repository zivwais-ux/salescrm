/* ============================================================================
   משימות ופעילות — תיעוד שיחות והצעות מחיר, ותזכורות מעקב שלא נופלות.
   ========================================================================== */
window.ViewActivity = (function () {
  const KINDS = { note: "הערה", call: "שיחה", meeting: "פגישה",
                  quote: "הצעת מחיר", issue: "תקלה" };
  const ICONS = { note: "note", call: "phone", meeting: "users",
                  quote: "file", issue: "alert" };
  const ui = { filter: "open" };

  function render(root, ctx) {
    const today = new Date().toISOString().slice(0, 10);
    const all = Store.state.activities.slice().sort((a, b) => (
      (a.follow_up_on || "9999-99-99").localeCompare(b.follow_up_on || "9999-99-99")
      || b.happened_on.localeCompare(a.happened_on)
    ));
    const overdue = all.filter((a) => !a.done && a.follow_up_on && a.follow_up_on < today);
    const list = all.filter((a) => (
      ui.filter === "all" ? true : ui.filter === "open" ? !a.done : a.done
    ));

    const options = Store.parties()
      .sort((a, b) => a.name.localeCompare(b.name, "he"))
      .map((p) => `<option value="${Fmt.escape(p.no)}">${Fmt.escape(p.name)}</option>`).join("");

    root.innerHTML = `
      <div class="grid cols-2" style="align-items:start">
        ${UI.card("רישום חדש", {
          sub: "נשמר על כרטיס הלקוח",
          body: `
            <div class="form-grid">
              <label class="stacked"><span>לקוח</span>
                <select class="select" id="act-party">${options}</select></label>
              <label class="stacked"><span>סוג</span>
                <select class="select" id="act-kind">${Object.entries(KINDS).map(([k, v]) => (
                  `<option value="${k}">${v}</option>`)).join("")}</select></label>
              <label class="stacked"><span>תאריך</span>
                <input class="input" type="date" id="act-date" value="${today}"></label>
              <label class="stacked"><span>תזכורת למעקב</span>
                <input class="input" type="date" id="act-follow"></label>
            </div>
            <label class="stacked" style="margin-top:13px"><span>כותרת</span>
              <input class="input" id="act-title" placeholder="למשל: לבדוק את הירידה בהזמנות">
            </label>
            <label class="stacked" style="margin-top:13px"><span>פירוט</span>
              <textarea id="act-body" placeholder="מה סוכם, מה נשאר פתוח"></textarea></label>
            <div class="row-actions" style="margin-top:13px">
              <button class="btn btn-primary" id="act-save">${UI.icon("plus", 15)} שמירה</button>
            </div>`,
        })}

        ${UI.card("מעקב", {
          sub: overdue.length ? `${overdue.length} משימות עברו את תאריך המעקב` : "",
          actions: `<div class="seg">
            ${[["open", "פתוחות"], ["done", "הושלמו"], ["all", "הכול"]].map(([k, label]) => `
              <button data-filter="${k}" class="${ui.filter === k ? "is-active" : ""}">${
                label}</button>`).join("")}
          </div>`,
          flush: true,
          body: list.length ? `<div class="list">${list.map((a) => {
            const late = !a.done && a.follow_up_on && a.follow_up_on < today;
            return `<div class="list-item ${a.done ? "done" : ""}">
              <span class="badge ${late ? "down" : a.done ? "up" : ""}"
                    style="height:26px;width:26px;padding:0;justify-content:center">
                ${UI.icon(ICONS[a.kind] || "note", 14)}</span>
              <div class="grow" style="flex:1;min-width:0">
                <div class="list-title">${Fmt.escape(a.title)}</div>
                <div class="list-sub">
                  <a href="#" data-customer="${Fmt.escape(a.party_no)}">${
                    Fmt.escape(Store.partyName(a.party_no))}</a>
                  · ${KINDS[a.kind] || a.kind} · ${Fmt.dateLong(a.happened_on)}${
                    a.follow_up_on ? ` · מעקב ${Fmt.date(a.follow_up_on)}` : ""}
                </div>
                ${a.body ? `<div class="list-sub" style="margin-top:3px;color:var(--text-2)">${
                  Fmt.escape(a.body)}</div>` : ""}
              </div>
              <div class="row-actions">
                <button class="btn btn-sm" data-toggle="${a.id}">${
                  a.done ? "החזרה" : "בוצע"}</button>
                <button class="btn btn-sm btn-ghost btn-icon" data-del="${a.id}"
                        aria-label="מחיקה">${UI.icon("trash", 15)}</button>
              </div>
            </div>`;
          }).join("")}</div>`
            : UI.empty(ui.filter === "done" ? "עוד לא הושלמו משימות" : "אין משימות פתוחות",
                       "רישום חדש נשמר גם על כרטיס הלקוח.", "check"),
        })}
      </div>`;

    root.querySelector("#act-save").addEventListener("click", () => {
      const title = root.querySelector("#act-title").value.trim();
      if (!title) return App.toast("צריך כותרת לרישום", "down");
      Store.addActivity({
        party_no: root.querySelector("#act-party").value,
        kind: root.querySelector("#act-kind").value,
        happened_on: root.querySelector("#act-date").value,
        follow_up_on: root.querySelector("#act-follow").value || null,
        title,
        body: root.querySelector("#act-body").value.trim(),
      });
      App.toast("הרישום נשמר", "up");
    });

    UI.on(root, "[data-filter]", "click", (e) => {
      ui.filter = e.currentTarget.dataset.filter;
      render(root, ctx);
    });
    UI.on(root, "[data-toggle]", "click", (e) => Store.toggleActivity(e.currentTarget.dataset.toggle));
    UI.on(root, "[data-del]", "click", (e) => {
      Store.deleteActivity(e.currentTarget.dataset.del);
      App.toast("הרישום נמחק", "", { undo: true });
    });
    UI.on(root, "[data-customer]", "click", (e) => {
      e.preventDefault();
      App.openCustomer(e.currentTarget.dataset.customer);
    });
  }

  return { render, KINDS, ICONS };
})();
