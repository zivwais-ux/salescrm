/* ============================================================================
   טבלת חודשים — הטבלה של הדוח, אבל כל תא ניתן לעריכה.
   שמירה ביציאה מהתא, ניווט בחצים כמו בגיליון, וביטול אחרון ב-Ctrl+Z.
   ========================================================================== */
window.ViewGrid = (function () {
  const ui = { search: "", onlyActive: true, page: 0, size: 30 };

  function rows(ctx) {
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
      const agent = ctx.agent === "all" ? (Store.state.agents[0] || {}).no : ctx.agent;
      Store.parties().forEach((party) => {
        const key = `${party.no}|${party.no}|${agent}`;
        if (!map.has(key)) {
          map.set(key, { c: party.no, p: party.no, agent,
                         months: Array(12).fill(0), total: 0 });
        }
      });
    }

    const term = ui.search.trim().toLowerCase();
    return [...map.values()]
      .filter((row) => !term
        || Store.partyName(row.c).toLowerCase().includes(term)
        || Store.partyName(row.p).toLowerCase().includes(term)
        || row.c.includes(term) || row.p.includes(term))
      .sort((a, b) => b.total - a.total);
  }

  const isPhone = () => window.innerWidth <= 1000;

  /**
   * בטלפון הטבלה הרחבה אינה נקראת ואינה נערכת: ארבע-עשרה עמודות על מסך של
   * 390 פיקסלים משאירות עמודה אחת גלויה. במקומה רשימת כרטיסים — שורה לכל
   * לקוח עם הפס החודשי והסכום — וכל כרטיס נפתח לגיליון עריכה של שנים-עשר
   * שדות גדולים, שנשמר בבת אחת.
   */
  function phoneList(page, ctx) {
    return `<div class="list">${page.map((row) => `
      <div class="list-row grid-card" data-edit="${Fmt.escape(row.c)}|${
        Fmt.escape(row.p)}|${Fmt.escape(row.agent || "")}">
        ${UI.avatar(Store.partyName(row.c))}
        <div class="grow">
          <div class="list-title ellipsis">${Fmt.escape(Store.partyName(row.c))}</div>
          <div class="list-sub ellipsis">${row.p === row.c
            ? Fmt.escape(row.c)
            : `משלם: ${Fmt.escape(Store.partyName(row.p))}`}</div>
        </div>
        <div style="display:grid;justify-items:end;gap:3px">
          <span class="list-value">${Fmt.money(row.total)}</span>
          ${Charts.sparkline(row.months, { width: 74 })}
        </div>
        <span style="color:var(--muted);flex:none">${UI.icon("chevron", 16)}</span>
      </div>`).join("") || UI.empty("אין שורות להצגה",
        "אפשר לבטל את סינון התנועות או לנקות את החיפוש.")}</div>`;
  }

  /** גיליון עריכה לשורה אחת: שנים-עשר חודשים, שמירה אחת. */
  function editRow(key, ctx) {
    const [c, p, agent] = key.split("|");
    const row = rows(ctx).find((r) => r.c === c && r.p === p && (r.agent || "") === agent)
      || { c, p, agent, months: Array(12).fill(0) };

    App.openDrawer({
      title: Fmt.escape(Store.partyName(c)),
      sub: `${Fmt.escape(c)} · ${ctx.year}${p === c ? ""
        : ` · משלם ${Fmt.escape(Store.partyName(p))}`}`,
      body: UI.card("", {
        body: `<div class="month-grid">
            ${row.months.map((v, i) => `
              <label class="stacked"><span>${Fmt.SHORT[i]}</span>
                <input class="input num" inputmode="decimal" data-month="${i + 1}"
                       data-raw="${v || ""}" value="${v || ""}"></label>`).join("")}
          </div>
          <div class="row-actions" style="margin-top:16px">
            <button class="btn btn-primary" id="months-save">שמירת החודשים</button>
            <button class="btn" data-close-drawer>ביטול</button>
          </div>
          <p class="hint" style="margin-top:10px">שדה ריק מוחק את התנועה של אותו חודש.</p>`,
      }),
      onReady(panel) {
        panel.querySelector("#months-save").addEventListener("click", () => {
          let changed = 0;
          panel.querySelectorAll("[data-month]").forEach((input) => {
            const before = Number(input.dataset.raw || 0);
            const after = input.value.trim() ? Fmt.parseNumber(input.value) : 0;
            if (after === before) return;
            Store.setSale(c, p, ctx.year, Number(input.dataset.month), after,
                          agent || (ctx.agent === "all" ? undefined : ctx.agent));
            changed += 1;
          });
          App.closeDrawer();
          App.toast(changed ? `${changed} חודשים עודכנו` : "לא השתנה דבר",
                    changed ? "up" : "", { undo: !!changed });
        });
      },
    });
  }

  function render(root, ctx) {
    const all = rows(ctx);
    const pages = Math.max(1, Math.ceil(all.length / ui.size));
    ui.page = Math.min(ui.page, pages - 1);
    const page = all.slice(ui.page * ui.size, (ui.page + 1) * ui.size);
    const totals = Array(12).fill(0);
    all.forEach((row) => row.months.forEach((v, i) => { totals[i] += v; }));

    root.innerHTML = UI.card("", {
      flush: true,
      body: `
      <div class="toolbar toolbar-wrap">
        <label class="search">
          ${UI.icon("search", 15)}
          <input class="input" type="search" id="grid-search" placeholder="חיפוש לקוח או משלם"
                 value="${Fmt.escape(ui.search)}">
        </label>
        <label class="check">
          <input type="checkbox" id="grid-active" ${ui.onlyActive ? "checked" : ""}>
          <span class="no-mobile">רק שורות עם תנועה ב-${ctx.year}</span>
          <span class="only-mobile">רק עם תנועה</span>
        </label>
        <div class="spacer row-actions">
          <span class="hint no-mobile">${Fmt.number(all.length)} שורות · ${
            Fmt.money(Metrics.sum(totals))}</span>
          <button class="btn btn-primary" id="grid-add">${
            UI.icon("plus", 15)}<span class="no-mobile">שורת מכירה</span></button>
        </div>
      </div>

      ${isPhone() ? phoneList(page, ctx) : `
      <div class="table-wrap" style="max-height:calc(100vh - 250px)">
        <table class="grid-table">
          <thead>
            <tr>
              <th style="min-width:230px">לקוח</th>
              <th style="min-width:140px">משלם</th>
              ${Fmt.SHORT.map((m) => `<th class="num">${m}</th>`).join("")}
              <th class="num">סה״כ</th>
            </tr>
          </thead>
          <tbody>
            ${page.map((row) => `
              <tr data-c="${Fmt.escape(row.c)}" data-p="${Fmt.escape(row.p)}"
                  data-agent="${Fmt.escape(row.agent || "")}">
                <td>
                  <div class="cell-party">
                    ${UI.avatar(Store.partyName(row.c))}
                    <div>
                      <div class="cell-title ellipsis">${Fmt.escape(Store.partyName(row.c))}</div>
                      <div class="cell-sub">${Fmt.escape(row.c)}</div>
                    </div>
                  </div>
                </td>
                <td>${row.p === row.c
                  ? '<span class="hint">אותו לקוח</span>'
                  : `<div class="ellipsis" style="max-width:160px">${
                       Fmt.escape(Store.partyName(row.p))}</div>
                     <div class="cell-sub">${Fmt.escape(row.p)}</div>`}</td>
                ${row.months.map((v, i) => `
                  <td class="cell ${v ? "filled" : ""}">
                    <input inputmode="decimal" data-month="${i + 1}"
                           data-raw="${v || ""}" aria-label="${Fmt.month(i + 1)}"
                           value="${v ? Fmt.number(v) : ""}">
                  </td>`).join("")}
                <td class="num" style="font-weight:600;white-space:nowrap">${
                  Fmt.money(row.total)}</td>
              </tr>`).join("") || `<tr><td colspan="15">${
                UI.empty("אין שורות להצגה", "אפשר לבטל את סינון התנועות או לנקות את החיפוש.")
              }</td></tr>`}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">סה״כ כל השורות</td>
              ${totals.map((v) => `<td class="num" style="white-space:nowrap">${
                v ? Fmt.short(v) : "—"}</td>`).join("")}
              <td class="num" style="white-space:nowrap">${
                Fmt.money(Metrics.sum(totals))}</td>
            </tr>
          </tfoot>
        </table>
      </div>`}

      <div class="toolbar" style="border-bottom:0;border-top:1px solid var(--line)">
        <span class="hint">${isPhone()
          ? "נגיעה בשורה פותחת את שנים-עשר החודשים לעריכה"
          : "עריכה ישירה בתא · תא ריק מוחק את התנועה · חצים לניווט"}</span>
        ${pages > 1 ? `<div class="spacer row-actions">
          <button class="btn btn-sm" id="page-prev" ${ui.page === 0 ? "disabled" : ""}>הקודם</button>
          <span class="hint">עמוד ${ui.page + 1} מתוך ${pages}</span>
          <button class="btn btn-sm" id="page-next" ${
            ui.page >= pages - 1 ? "disabled" : ""}>הבא</button>
        </div>` : ""}
      </div>`,
    });

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

    UI.on(root, "[data-edit]", "click", (e) => editRow(e.currentTarget.dataset.edit, ctx));
    if (!isPhone()) wireCells(root, ctx);
  }

  /**
   * עריכה, ניווט במקלדת, ושמירה בלי לצייר מחדש את כל המסך.
   * התא מציג מספר מעוצב כשאינו בעריכה, ומחליף לערך הגולמי בכניסה אליו —
   * כך הטבלה נקראת כמו דוח, ונערכת כמו גיליון בלי לאבד אגורות.
   */
  function wireCells(root, ctx) {
    const inputs = [...root.querySelectorAll("td.cell input")];
    const columns = 12;

    inputs.forEach((input, index) => {
      const raw = () => Number(input.dataset.raw || 0);

      input.addEventListener("focus", () => {
        input.value = raw() || "";
        input.select();
      });

      input.addEventListener("keydown", (e) => {
        const moves = {
          Enter: columns, ArrowDown: columns, ArrowUp: -columns,
          ArrowRight: -1, ArrowLeft: 1,
        };
        if (e.key === "Escape") {
          input.value = raw() || "";
          input.blur();
          return;
        }
        // חצים אופקיים זזים בין תאים רק כשהסמן בקצה הטקסט.
        if ((e.key === "ArrowRight" && input.selectionStart !== 0)
          || (e.key === "ArrowLeft" && input.selectionStart !== input.value.length)) return;
        const step = moves[e.key];
        if (step === undefined) return;
        const target = inputs[index + step];
        if (!target) return;
        e.preventDefault();
        target.focus();
      });

      input.addEventListener("blur", () => {
        const value = input.value.trim() ? Fmt.parseNumber(input.value) : 0;
        if (value === raw()) {
          input.value = raw() ? Fmt.number(raw()) : "";
          return;
        }
        const tr = input.closest("tr");
        const month = Number(input.dataset.month);
        Store.setSale(tr.dataset.c, tr.dataset.p, ctx.year, month, value,
                      tr.dataset.agent || (ctx.agent === "all" ? undefined : ctx.agent));
        App.toast(`${Fmt.month(month)} · ${Store.partyName(tr.dataset.c)} — ${
          value ? Fmt.money(value) : "נמחק"}`, "up", { undo: true });
      });
    });
  }

  function addRow(ctx) {
    const options = Store.parties()
      .sort((a, b) => a.name.localeCompare(b.name, "he"))
      .map((p) => `<option value="${Fmt.escape(p.no)}">${Fmt.escape(p.name)} · ${
        Fmt.escape(p.no)}</option>`).join("");

    App.openDrawer({
      title: "הוספת מכירה",
      body: UI.card("", {
        body: `
          <div class="form-grid">
            <label class="stacked"><span>לקוח</span>
              <select class="select" id="add-c">${options}</select></label>
            <label class="stacked"><span>לקוח משלם</span>
              <select class="select" id="add-p">
                <option value="">זהה ללקוח</option>${options}</select></label>
            <label class="stacked"><span>שנה</span>
              <select class="select" id="add-y">${Store.years().map((y) => (
                `<option ${y === ctx.year ? "selected" : ""}>${y}</option>`)).join("")}
              </select></label>
            <label class="stacked"><span>חודש</span>
              <select class="select" id="add-m">${Fmt.MONTHS.map((name, i) => (
                `<option value="${i + 1}" ${
                  i + 1 === Store.lastMonth(ctx.year) ? "selected" : ""}>${name}</option>`
              )).join("")}</select></label>
            <label class="stacked"><span>סכום (₪)</span>
              <input class="input" id="add-a" inputmode="decimal" placeholder="0"></label>
          </div>
          <div class="row-actions" style="margin-top:14px">
            <button class="btn btn-primary" id="add-save">שמירה</button>
          </div>`,
      }),
      onReady(panel) {
        panel.querySelector("#add-save").addEventListener("click", () => {
          const c = panel.querySelector("#add-c").value;
          const p = panel.querySelector("#add-p").value || c;
          const amount = panel.querySelector("#add-a").value;
          if (!Fmt.parseNumber(amount)) return App.toast("צריך סכום גדול מאפס", "down");
          Store.setSale(c, p, Number(panel.querySelector("#add-y").value),
                        Number(panel.querySelector("#add-m").value), amount,
                        ctx.agent === "all" ? undefined : ctx.agent);
          App.toast("המכירה נשמרה", "up");
          App.closeDrawer();
        });
      },
    });
  }

  return { render };
})();
