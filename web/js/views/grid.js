/* ============================================================================
   טבלת חודשים: עריכה ישירה של סכומים, תא אחר תא.
   כל שינוי נשמר מיד - מקומית, ובענן אם מחובר.
   ========================================================================== */
window.ViewGrid = (function () {
  const ui = { search: "", onlyActive: true, page: 0, pageSize: 40 };

  /** שורה לכל צירוף לקוח+משלם+סוכן, כמו בדוח המקורי. */
  function pairs(ctx) {
    const map = new Map();
    Store.sales()
      .filter((s) => s.y === ctx.year && (ctx.agent === "all" || s.agent === ctx.agent))
      .forEach((s) => {
        const key = `${s.c}|${s.p}|${s.agent}`;
        let row = map.get(key);
        if (!row) {
          row = { c: s.c, p: s.p, agent: s.agent, months: Array(12).fill(0), total: 0 };
          map.set(key, row);
        }
        row.months[s.m - 1] += s.a;
        row.total += s.a;
      });

    if (!ui.onlyActive) {
      Store.parties().forEach((party) => {
        const key = `${party.no}|${party.no}|${ctx.agent}`;
        if (!map.has(key)) {
          map.set(key, { c: party.no, p: party.no,
                         agent: ctx.agent === "all" ? undefined : ctx.agent,
                         months: Array(12).fill(0), total: 0 });
        }
      });
    }

    const term = ui.search.trim().toLowerCase();
    return [...map.values()]
      .filter((row) => {
        if (!term) return true;
        return Store.partyName(row.c).toLowerCase().includes(term) ||
               Store.partyName(row.p).toLowerCase().includes(term) ||
               row.c.includes(term) || row.p.includes(term);
      })
      .sort((a, b) => b.total - a.total);
  }

  function agentName(no) {
    const agent = Store.state.agents.find((a) => a.no === no);
    return agent ? agent.name : `סוכן ${no}`;
  }

  function render(root, ctx) {
    const all = pairs(ctx);
    const pageCount = Math.max(1, Math.ceil(all.length / ui.pageSize));
    ui.page = Math.min(ui.page, pageCount - 1);
    const rows = all.slice(ui.page * ui.pageSize, (ui.page + 1) * ui.pageSize);
    const totals = Array(12).fill(0);
    all.forEach((row) => row.months.forEach((v, i) => { totals[i] += v; }));

    root.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <input type="search" id="grid-search" placeholder="חיפוש לקוח או משלם"
                 value="${Fmt.escape(ui.search)}">
          <label class="field">
            <input type="checkbox" id="grid-active" ${ui.onlyActive ? "checked" : ""}>
            <span>רק שורות עם תנועה ב-${ctx.year}</span>
          </label>
          <button class="btn btn-primary" id="grid-add">+ שורת מכירה</button>
          <span class="hint">${Fmt.number(all.length)} שורות · סה"כ ${
            Fmt.money(Metrics.sum(totals))}</span>
        </div>

        <div class="table-wrap">
          <table class="grid-table">
            <thead>
              <tr>
                <th>לקוח</th>
                <th>משלם</th>
                ${Fmt.SHORT.map((m) => `<th class="num">${m}</th>`).join("")}
                <th class="num">סה"כ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr data-c="${Fmt.escape(row.c)}" data-p="${Fmt.escape(row.p)}"
                    data-agent="${Fmt.escape(row.agent || "")}">
                  <td class="name-cell">${Fmt.escape(Store.partyName(row.c))}
                    <span class="sub">${Fmt.escape(row.c)}${
                      row.agent ? ` · ${Fmt.escape(agentName(row.agent))}` : ""}</span></td>
                  <td>${row.p === row.c ? '<span class="sub">אותו לקוח</span>'
                    : `${Fmt.escape(Store.partyName(row.p))}<span class="sub">${
                        Fmt.escape(row.p)}</span>`}</td>
                  ${row.months.map((v, i) => `
                    <td class="cell ${v ? "filled" : ""}">
                      <input inputmode="decimal" data-month="${i + 1}"
                             value="${v ? Math.round(v * 100) / 100 : ""}">
                    </td>`).join("")}
                  <td class="num"><strong>${Fmt.money(row.total)}</strong></td>
                  <td class="num"><button class="btn btn-sm" data-open="${
                    Fmt.escape(row.c)}">כרטיס</button></td>
                </tr>`).join("") || '<tr><td colspan="16" class="empty">אין שורות</td></tr>'}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2">סה"כ כל השורות</td>
                ${totals.map((v) => `<td class="num">${Fmt.short(v)}</td>`).join("")}
                <td class="num">${Fmt.money(Metrics.sum(totals))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        ${pageCount > 1 ? `
          <div class="form-actions" style="margin-top:12px;justify-content:center">
            <button class="btn btn-sm" id="page-prev" ${ui.page === 0 ? "disabled" : ""}>הקודם</button>
            <span class="hint">עמוד ${ui.page + 1} מתוך ${pageCount}</span>
            <button class="btn btn-sm" id="page-next" ${
              ui.page >= pageCount - 1 ? "disabled" : ""}>הבא</button>
          </div>` : ""}
        <p class="hint" style="margin-top:10px">
          עריכה ישירה בתא ושמירה ביציאה ממנו. סכום 0 או תא ריק מוחקים את התנועה.</p>
      </div>`;

    const search = root.querySelector("#grid-search");
    search.addEventListener("input", () => {
      ui.search = search.value;
      ui.page = 0;
      render(root, ctx);
      const box = root.querySelector("#grid-search");
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
    root.querySelector("#grid-active").addEventListener("change", (e) => {
      ui.onlyActive = e.target.checked;
      ui.page = 0;
      render(root, ctx);
    });
    root.querySelector("#grid-add").addEventListener("click", () => addRow(ctx));
    const prev = root.querySelector("#page-prev");
    const next = root.querySelector("#page-next");
    if (prev) prev.addEventListener("click", () => { ui.page -= 1; render(root, ctx); });
    if (next) next.addEventListener("click", () => { ui.page += 1; render(root, ctx); });

    root.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      App.openCustomer(btn.dataset.open);
    }));

    root.querySelectorAll("td.cell input").forEach((input) => {
      const original = input.value;
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") { input.value = original; input.blur(); }
      });
      input.addEventListener("blur", async () => {
        if (input.value.trim() === original.trim()) return;
        const tr = input.closest("tr");
        const month = Number(input.dataset.month);
        try {
          await Store.setSale(tr.dataset.c, tr.dataset.p, ctx.year, month, input.value,
                              tr.dataset.agent || (ctx.agent === "all" ? undefined : ctx.agent));
          App.toast(`${Fmt.month(month)} · ${Store.partyName(tr.dataset.c)} עודכן`);
        } catch (err) {
          App.toast(`השמירה נכשלה: ${err.message}`);
        }
      });
    });
  }

  function addRow(ctx) {
    const options = Store.parties()
      .sort((a, b) => a.name.localeCompare(b.name, "he"))
      .map((p) => `<option value="${Fmt.escape(p.no)}">${Fmt.escape(p.name)} (${
        Fmt.escape(p.no)})</option>`).join("");

    App.openDrawer(`
      <div class="drawer-head">
        <h2>הוספת מכירה</h2>
        <button class="btn btn-sm" data-close-drawer>סגירה</button>
      </div>
      <div class="card">
        <div class="form-grid">
          <label class="stacked"><span>לקוח</span>
            <select id="add-c">${options}</select></label>
          <label class="stacked"><span>לקוח משלם</span>
            <select id="add-p"><option value="">זהה ללקוח</option>${options}</select></label>
          <label class="stacked"><span>שנה</span>
            <select id="add-y">${Store.years().map((y) => (
              `<option ${y === ctx.year ? "selected" : ""}>${y}</option>`)).join("")}</select></label>
          <label class="stacked"><span>חודש</span>
            <select id="add-m">${Fmt.MONTHS.map((name, i) => (
              `<option value="${i + 1}">${name}</option>`)).join("")}</select></label>
          <label class="stacked"><span>סכום (₪)</span>
            <input id="add-a" inputmode="decimal"></label>
        </div>
        <div class="form-actions" style="margin-top:12px">
          <button class="btn btn-primary" id="add-save">שמירה</button>
        </div>
      </div>`, (panel) => {
      panel.querySelector("#add-save").addEventListener("click", async () => {
        const c = panel.querySelector("#add-c").value;
        const p = panel.querySelector("#add-p").value || c;
        const y = Number(panel.querySelector("#add-y").value);
        const m = Number(panel.querySelector("#add-m").value);
        const a = panel.querySelector("#add-a").value;
        if (!Fmt.parseNumber(a)) return App.toast("צריך סכום גדול מאפס");
        await Store.setSale(c, p, y, m, a, ctx.agent === "all" ? undefined : ctx.agent);
        App.toast("המכירה נשמרה");
        App.closeDrawer();
      });
    });
  }

  return { render };
})();
