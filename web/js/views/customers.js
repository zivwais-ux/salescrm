/* ============================================================================
   לקוחות — טבלה אחת שאפשר לחפש, לסנן ולמיין, ולפתוח ממנה כרטיס לקוח.
   ========================================================================== */
window.ViewCustomers = (function () {
  const STATUS = {
    active: { label: "פעיל", tone: "up" },
    watch: { label: "במעקב", tone: "warn" },
    dormant: { label: "רדום", tone: "warn" },
    lost: { label: "אבוד", tone: "down" },
    prospect: { label: "פוטנציאלי", tone: "accent" },
  };

  const ui = { search: "", status: "all", scope: "all", sort: "ytd", dir: -1 };

  const SCOPES = {
    all: { label: "הכול", test: () => true },
    active: { label: `קנו השנה`, test: (c) => c.ytd > 0 },
    risk: { label: "דורש טיפול", test: (c) => c.atRisk },
    quiet: { label: "שקטים", test: (c) => c.isQuiet },
    new: { label: "חדשים", test: (c) => c.isNew },
  };

  function filtered(view) {
    const term = ui.search.trim().toLowerCase();
    const list = view.customers.filter((c) => {
      if (!SCOPES[ui.scope].test(c)) return false;
      if (ui.status !== "all" && (c.profile.status || "active") !== ui.status) return false;
      if (!term) return true;
      return c.name.toLowerCase().includes(term) || c.no.includes(term);
    });
    const key = ui.sort;
    return list.sort((a, b) => {
      if (key === "name") return a.name.localeCompare(b.name, "he") * -ui.dir;
      const av = a[key] === null ? -Infinity : a[key];
      const bv = b[key] === null ? -Infinity : b[key];
      return (av - bv) * ui.dir;
    });
  }

  function th(label, key, cls = "") {
    const arrow = ui.sort === key
      ? `<span class="sort-arrow">${ui.dir === -1 ? "↓" : "↑"}</span>` : "";
    return `<th class="sortable ${cls}" data-sort="${key}">${label}${arrow}</th>`;
  }

  function render(root, ctx) {
    const view = Metrics.overview(ctx);
    const list = filtered(view);
    // מסלול חמש השנים לכל לקוח — הוא עונה על "האם הירידה השנה היא מגמה או
    // חודש חלש", וזו השאלה הראשונה שנשאלת מול טור שינוי אדום.
    const paths = Metrics.yearPaths({ agent: ctx.agent });
    const shown = Metrics.sum(list.map((c) => c.ytd));

    root.innerHTML = UI.card("", {
      flush: true,
      body: `
      <div class="toolbar">
        <label class="search">
          ${UI.icon("search", 15)}
          <input class="input" type="search" id="cust-search" placeholder="חיפוש לפי שם או מספר"
                 value="${Fmt.escape(ui.search)}">
        </label>
        <div class="spacer row-actions">
          <span class="hint no-mobile">${Fmt.number(list.length)} לקוחות · ${
            Fmt.money(shown)}</span>
          <button class="btn btn-primary" id="cust-add" aria-label="לקוח חדש">${
            UI.icon("plus", 15)}<span class="no-mobile">לקוח חדש</span></button>
        </div>
      </div>

      <div class="toolbar toolbar-chips">
        <div class="seg">
          ${Object.entries(SCOPES).map(([key, s]) => `
            <button data-scope="${key}" class="${ui.scope === key ? "is-active" : ""}">${
              s.label}</button>`).join("")}
        </div>
        <label class="field">
          <span>סטטוס</span>
          <select class="select" id="cust-status">
            <option value="all">הכול</option>
            ${Object.entries(STATUS).map(([k, v]) => `
              <option value="${k}" ${ui.status === k ? "selected" : ""}>${v.label}</option>`
            ).join("")}
          </select>
        </label>
        <span class="hint only-mobile spacer">${Fmt.number(list.length)} לקוחות</span>
      </div>

      <div class="table-wrap cards-wrap" style="max-height:calc(100vh - 190px)">
        <table class="cards-on-mobile">
          <thead>
            <tr>
              ${th("לקוח", "name")}
              ${th(`${view.cmpLabel} ${view.year}`, "ytd", "num")}
              ${th(`${view.cmpLabel} ${view.priorYear}`, "priorYtd", "num")}
              ${th("שינוי", "changePct", "num")}
              <th class="num">חודשי ${view.year}</th>
              <th class="num">${paths.years.length} שנים</th>
              ${th("מכירה אחרונה", "lastActive", "num")}
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((c) => {
              const status = STATUS[c.profile.status] || STATUS.active;
              return `<tr class="row-link" data-no="${Fmt.escape(c.no)}">
                <td class="cell-main">
                  <div class="cell-party">
                    ${UI.avatar(c.name)}
                    <div>
                      <div class="cell-title ellipsis">${Fmt.escape(c.name)}${
                        c.isBucket ? ' <span class="badge warn">סל מרוכז</span>' : ""}</div>
                      <div class="cell-sub">${Fmt.escape(c.no)}${
                        c.payers.length > 1 ? ` · ${c.payers.length} משלמים` : ""}${
                        c.parent ? " · אתר" : ""}${
                        c.sites && c.sites.length ? ` · ${c.sites.length + 1} אתרים` : ""}</div>
                    </div>
                  </div>
                </td>
                <td class="num" data-label="${view.cmpLabel} ${view.year}"
                    style="font-weight:600">${Fmt.money(c.ytd)}</td>
                <td class="num" data-label="${view.cmpLabel} ${view.priorYear}"
                    style="color:var(--muted)">${Fmt.money(c.priorYtd)}</td>
                <td class="num" data-label="שינוי">${view.hasPrior
                  ? UI.delta(c.changePct) : '<span class="hint">—</span>'}</td>
                <td class="num hide-mobile">${Charts.sparkline(c.months)}</td>
                <td class="num hide-mobile">${Charts.sparkline(
                  paths.map.get(c.no) || [], { flat: true, width: 64 })}</td>
                <td class="num" data-label="מכירה אחרונה">${
                  c.lastActive ? Fmt.monthShort(c.lastActive) : "—"}</td>
                <td data-label="סטטוס"><span class="badge ${status.tone}">${
                  status.label}</span></td>
              </tr>`;
            }).join("") || `<tr><td colspan="8">${
              UI.empty("לא נמצאו לקוחות", "אפשר לנקות את החיפוש או לשנות את הסינון.", "search")
            }</td></tr>`}
          </tbody>
        </table>
      </div>`,
    });

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
    UI.on(root, "[data-scope]", "click", (e) => {
      ui.scope = e.currentTarget.dataset.scope;
      render(root, ctx);
    });
    root.querySelector("#cust-add").addEventListener("click", () => addCustomer());
    UI.on(root, "th.sortable", "click", (e) => {
      const key = e.currentTarget.dataset.sort;
      ui.dir = ui.sort === key ? -ui.dir : -1;
      ui.sort = key;
      render(root, ctx);
    });
    UI.on(root, "tr[data-no]", "click", (e) => App.openCustomer(e.currentTarget.dataset.no));
  }

  function addCustomer() {
    App.openDrawer({
      title: "לקוח חדש",
      body: UI.card("", {
        body: `
          <div class="form-grid">
            <label class="stacked"><span>מספר לקוח</span>
              <input class="input" id="new-no" inputmode="numeric" placeholder="202500000"></label>
            <label class="stacked"><span>שם הלקוח</span>
              <input class="input" id="new-name" placeholder="שם החברה"></label>
          </div>
          <p class="hint" style="margin-top:12px">
            אחרי ההוספה אפשר לרשום סכומים מיד במסך "טבלת חודשים".</p>
          <div class="row-actions" style="margin-top:14px">
            <button class="btn btn-primary" id="new-save">הוספה</button>
          </div>`,
      }),
      onReady(panel) {
        const save = async () => {
          const no = panel.querySelector("#new-no").value.trim();
          const name = panel.querySelector("#new-name").value.trim();
          try {
            Store.addParty(no, name);
            App.toast(`${name || no} נוסף לתיק`);
            App.openCustomer(no);
          } catch (err) {
            App.toast(err.message, "down");
          }
        };
        panel.querySelector("#new-save").addEventListener("click", save);
        panel.querySelector("#new-name").addEventListener("keydown", (e) => {
          if (e.key === "Enter") save();
        });
        panel.querySelector("#new-no").focus();
      },
    });
  }

  return { render, STATUS };
})();
