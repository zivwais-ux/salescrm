/* ============================================================================
   מסך לקוחות: טבלה אחת שאפשר לחפש, למיין, לסנן, ולפתוח ממנה כרטיס לקוח.
   ========================================================================== */
window.ViewCustomers = (function () {
  const ui = { search: "", status: "all", sort: "ytd", dir: -1, onlyActive: false };

  const STATUS = {
    active: "פעיל", watch: "במעקב", dormant: "רדום", lost: "אבוד", prospect: "פוטנציאלי",
  };

  function filtered(view) {
    const term = ui.search.trim().toLowerCase();
    let list = view.customers.filter((c) => {
      if (ui.onlyActive && c.ytd <= 0) return false;
      if (ui.status !== "all" && (c.profile.status || "active") !== ui.status) return false;
      if (!term) return true;
      return c.name.toLowerCase().includes(term) || c.no.includes(term);
    });
    const key = ui.sort;
    list = list.slice().sort((a, b) => {
      if (key === "name") return a.name.localeCompare(b.name, "he") * ui.dir * -1;
      const av = a[key] === null ? -Infinity : a[key];
      const bv = b[key] === null ? -Infinity : b[key];
      return (av - bv) * ui.dir;
    });
    return list;
  }

  function header(label, key, extra = "") {
    const active = ui.sort === key ? (ui.dir === -1 ? " ↓" : " ↑") : "";
    return `<th class="sortable ${extra}" data-sort="${key}">${label}${active}</th>`;
  }

  function render(root, ctx) {
    const view = Metrics.overview(ctx);
    const list = filtered(view);
    const shown = Metrics.sum(list.map((c) => c.ytd));

    root.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="search" id="cust-search" placeholder="חיפוש לפי שם או מספר לקוח"
                 value="${Fmt.escape(ui.search)}">
          <label class="field"><span>סטטוס</span>
            <select id="cust-status">
              <option value="all">הכול</option>
              ${Object.entries(STATUS).map(([k, v]) => (
                `<option value="${k}" ${ui.status === k ? "selected" : ""}>${v}</option>`
              )).join("")}
            </select>
          </label>
          <label class="field">
            <input type="checkbox" id="cust-active" ${ui.onlyActive ? "checked" : ""}>
            <span>רק מי שקנה ב-${view.year}</span>
          </label>
          <button class="btn btn-primary" id="cust-add">+ לקוח חדש</button>
          <span class="hint">${Fmt.number(list.length)} לקוחות · ${Fmt.money(shown)}</span>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                ${header("לקוח", "name")}
                ${header(`${view.year} עד כה`, "ytd", "num")}
                ${header(`${view.priorYear} תקופה מקבילה`, "priorYtd", "num")}
                ${header("שינוי", "changePct", "num")}
                <th class="num">מגמה חודשית</th>
                ${header("חודשי פעילות", "activeMonths", "num")}
                ${header("מכירה אחרונה", "lastActive", "num")}
                <th>סטטוס</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${list.map((c) => `
                <tr class="row-link" data-no="${Fmt.escape(c.no)}">
                  <td class="name-cell">${Fmt.escape(c.name)}
                    <span class="sub">${Fmt.escape(c.no)}${
                      c.payers.length > 1 ? ` · ${c.payers.length} משלמים` : ""}</span></td>
                  <td class="num">${Fmt.money(c.ytd)}</td>
                  <td class="num">${Fmt.money(c.priorYtd)}</td>
                  <td class="num">${c.changePct === null
                    ? '<span class="badge brand">חדש</span>'
                    : `<span class="delta ${c.changePct >= 0 ? "up" : "down"}">${
                        Fmt.percent(c.changePct, 0)}</span>`}</td>
                  <td class="num">${Charts.sparkline(c.months)}</td>
                  <td class="num">${c.activeMonths}</td>
                  <td class="num">${c.lastActive ? Fmt.monthShort(c.lastActive) : "—"}</td>
                  <td><span class="badge ${badgeClass(c)}">${
                    STATUS[c.profile.status] || STATUS.active}</span></td>
                  <td class="num"><button class="btn btn-sm" data-open="${
                    Fmt.escape(c.no)}">פתיחה</button></td>
                </tr>`).join("") || '<tr><td colspan="9" class="empty">לא נמצאו לקוחות</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    const search = root.querySelector("#cust-search");
    search.addEventListener("input", () => {
      ui.search = search.value;
      render(root, ctx);
      const box = root.querySelector("#cust-search");
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
    root.querySelector("#cust-status").addEventListener("change", (e) => {
      ui.status = e.target.value;
      render(root, ctx);
    });
    root.querySelector("#cust-active").addEventListener("change", (e) => {
      ui.onlyActive = e.target.checked;
      render(root, ctx);
    });
    root.querySelector("#cust-add").addEventListener("click", () => addCustomer(ctx));

    root.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.sort;
      ui.dir = ui.sort === key ? -ui.dir : -1;
      ui.sort = key;
      render(root, ctx);
    }));

    root.querySelectorAll("tr[data-no]").forEach((tr) => tr.addEventListener("click", () => {
      App.openCustomer(tr.dataset.no);
    }));
  }

  function badgeClass(c) {
    const status = c.profile.status || "active";
    if (status === "lost") return "down";
    if (status === "watch" || status === "dormant") return "warn";
    if (status === "prospect") return "brand";
    return "up";
  }

  function addCustomer(ctx) {
    App.openDrawer(`
      <div class="drawer-head">
        <h2>לקוח חדש</h2>
        <button class="btn btn-sm" data-close-drawer>סגירה</button>
      </div>
      <div class="card">
        <div class="form-grid">
          <label class="stacked"><span>מספר לקוח</span><input id="new-no" inputmode="numeric"></label>
          <label class="stacked"><span>שם הלקוח</span><input id="new-name"></label>
        </div>
        <p class="hint">אחרי ההוספה אפשר לרשום מיד סכומים במסך "טבלת חודשים".</p>
        <div class="form-actions" style="margin-top:12px">
          <button class="btn btn-primary" id="new-save">הוספה</button>
        </div>
      </div>`, (panel) => {
      panel.querySelector("#new-save").addEventListener("click", async () => {
        const no = panel.querySelector("#new-no").value.trim();
        const name = panel.querySelector("#new-name").value.trim();
        try {
          await Store.addParty(no, name);
          App.toast(`הלקוח ${name || no} נוסף`);
          App.closeDrawer();
          App.openCustomer(no);
        } catch (err) {
          App.toast(err.message);
        }
      });
    });
  }

  return { render, STATUS };
})();
