/* ============================================================================
   משימות ופעילות.

   המסך הזה נשאל שאלה אחת: מה צריך לעשות עכשיו. לכן הוא לא רשימה אחת ארוכה
   שממוינת לפי תאריך, אלא ערימות לפי דחיפות — באיחור, היום, השבוע, בהמשך —
   וכל ערימה אומרת כמה יש בה. משימה בלי תאריך מעקב אינה נעלמת: היא ערימה
   בפני עצמה, כי בדיוק שם נופלות ההבטחות.

   הרישום עצמו נמצא בשורה אחת בראש המסך, ובטלפון בכפתור צף שפותח גיליון:
   שדה אחד חובה (מה צריך לעשות), לקוח, ותאריך בנגיעה אחת — "היום", "מחר",
   "בעוד שבוע". כל השאר נפתח למי שרוצה, ולא חוסם את מי שלא.
   ========================================================================== */
window.ViewActivity = (function () {
  const KINDS = { note: "הערה", call: "שיחה", meeting: "פגישה",
                  quote: "הצעת מחיר", issue: "תקלה" };
  const ICONS = { note: "note", call: "phone", meeting: "users",
                  quote: "file", issue: "alert" };

  const ui = { filter: "open", draft: { party: "", kind: "call", follow: "" } };

  const today = () => new Date().toISOString().slice(0, 10);
  const shift = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  /** ערימות לפי דחיפות. הסדר הוא סדר הטיפול, לא סדר התאריכים. */
  const BUCKETS = [
    { id: "late", label: "באיחור", tone: "down", icon: "alert",
      test: (a, now) => a.follow_up_on && a.follow_up_on < now },
    { id: "today", label: "היום", tone: "accent", icon: "clock",
      test: (a, now) => a.follow_up_on === now },
    { id: "week", label: "השבוע", tone: "", icon: "clock",
      test: (a, now, week) => a.follow_up_on > now && a.follow_up_on <= week },
    { id: "later", label: "בהמשך", tone: "", icon: "clock",
      test: (a, now, week) => a.follow_up_on && a.follow_up_on > week },
    { id: "someday", label: "ללא תאריך מעקב", tone: "", icon: "note",
      test: (a) => !a.follow_up_on },
  ];

  const FILTERS = [["open", "פתוחות"], ["late", "באיחור"], ["today", "היום"],
                   ["done", "הושלמו"], ["all", "הכול"]];

  function split(rows) {
    const now = today();
    const week = shift(7);
    const open = rows.filter((a) => !a.done);
    return BUCKETS.map((bucket) => ({
      ...bucket,
      items: open.filter((a) => bucket.test(a, now, week))
        .sort((a, b) => (a.follow_up_on || "9999").localeCompare(b.follow_up_on || "9999")
          || b.happened_on.localeCompare(a.happened_on)),
    }));
  }

  function due(activity) {
    if (!activity.follow_up_on) return "";
    const now = today();
    const days = Math.round(
      (new Date(activity.follow_up_on) - new Date(now)) / 86400000);
    if (days === 0) return "היום";
    if (days === 1) return "מחר";
    if (days === -1) return "אתמול";
    if (days < 0) return `באיחור ${Math.abs(days)} ימים`;
    if (days <= 7) return `בעוד ${days} ימים`;
    return Fmt.date(activity.follow_up_on);
  }

  /** שורת משימה: סימון ביצוע, מה ואצל מי, ופעולות בהישג אגודל. */
  function row(activity) {
    const late = !activity.done && activity.follow_up_on && activity.follow_up_on < today();
    return `<div class="task ${activity.done ? "is-done" : ""}" data-id="${activity.id}">
      <button class="task-check" data-toggle="${activity.id}"
              aria-label="${activity.done ? "החזרה לפתוחות" : "סימון כבוצע"}"
              aria-pressed="${activity.done}">${UI.icon("check", 14)}</button>
      <div class="task-main">
        <div class="task-title">${Fmt.escape(activity.title)}</div>
        <div class="task-meta">
          <span class="task-kind" title="${Fmt.escape(KINDS[activity.kind] || activity.kind)}">${
            UI.icon(ICONS[activity.kind] || "note", 13)}<span class="no-mobile">${
            KINDS[activity.kind] || activity.kind}</span></span>
          <a href="#" data-customer="${Fmt.escape(activity.party_no)}"
             class="task-party ellipsis">${Fmt.escape(Store.partyName(activity.party_no))}</a>
          ${activity.follow_up_on ? `<span class="task-due ${late ? "is-late" : ""}">${
            UI.icon("clock", 12)}${due(activity)}</span>` : ""}
        </div>
        ${activity.body ? `<div class="task-body">${Fmt.escape(activity.body)}</div>` : ""}
      </div>
      <div class="task-tools">
        ${activity.done ? "" : `
          <button class="btn btn-sm btn-ghost" data-snooze="${activity.id}" data-days="1"
                  title="דחייה ביום">+יום</button>
          <button class="btn btn-sm btn-ghost no-mobile" data-snooze="${activity.id}"
                  data-days="7" title="דחייה בשבוע">+שבוע</button>`}
        <button class="btn btn-sm btn-ghost btn-icon" data-del="${activity.id}"
                aria-label="מחיקה">${UI.icon("trash", 15)}</button>
      </div>
    </div>`;
  }

  function group(bucket) {
    if (!bucket.items.length) return "";
    return `<section class="task-group">
      <header class="task-group-head">
        <span class="badge ${bucket.tone}">${UI.icon(bucket.icon, 12)}${bucket.label}</span>
        <span class="hint">${Fmt.number(bucket.items.length)}</span>
      </header>
      ${bucket.items.map(row).join("")}
    </section>`;
  }

  function render(root, ctx) {
    const all = Store.state.activities;
    const groups = split(all);
    const counts = Object.fromEntries(groups.map((g) => [g.id, g.items.length]));
    const openCount = all.filter((a) => !a.done).length;
    const doneRows = all.filter((a) => a.done)
      .sort((a, b) => b.happened_on.localeCompare(a.happened_on));

    const shown = ui.filter === "done" ? [{ id: "done", label: "הושלמו", tone: "up",
                                            icon: "check", items: doneRows }]
      : ui.filter === "late" ? groups.filter((g) => g.id === "late")
      : ui.filter === "today" ? groups.filter((g) => g.id === "today")
      : ui.filter === "all" ? groups.concat([{ id: "done", label: "הושלמו", tone: "up",
                                               icon: "check", items: doneRows }])
      : groups;
    const total = shown.reduce((sum, g) => sum + g.items.length, 0);

    const party = ui.draft.party && Store.party(ui.draft.party);

    root.innerHTML = `
      <section class="card composer no-mobile">
        <div class="composer-row">
          <input class="input composer-title" id="act-title" autocomplete="off"
                 placeholder="מה צריך לעשות? למשל: לבדוק את הירידה בהזמנות">
          <button class="btn" id="act-party-pick">
            ${UI.icon("customers", 15)}<span class="ellipsis" style="max-width:150px">${
              party ? Fmt.escape(party.name) : "בחירת לקוח"}</span></button>
          <button class="btn btn-primary" id="act-save">${UI.icon("plus", 15)} הוספה</button>
        </div>
        <div class="composer-row composer-opts">
          <div class="seg">
            ${[["", "בלי תאריך"], [today(), "היום"], [shift(1), "מחר"],
               [shift(7), "בעוד שבוע"]].map(([value, label]) => `
              <button data-follow="${value}" class="${
                ui.draft.follow === value ? "is-active" : ""}">${label}</button>`).join("")}
          </div>
          <div class="seg">
            ${Object.entries(KINDS).map(([key, label]) => `
              <button data-kind="${key}" class="${
                ui.draft.kind === key ? "is-active" : ""}">${label}</button>`).join("")}
          </div>
          <button class="btn btn-ghost btn-sm" id="act-more">פירוט נוסף</button>
        </div>
      </section>

      <div class="toolbar toolbar-chips sticky-chips">
        <div class="seg">
          ${FILTERS.map(([key, label]) => {
            const badge = key === "late" ? counts.late : key === "today" ? counts.today
              : key === "open" ? openCount : key === "done" ? doneRows.length : all.length;
            return `<button data-filter="${key}" class="${ui.filter === key ? "is-active" : ""}">
              ${label}${badge ? ` <span class="chip-count ${
                key === "late" && badge ? "is-late" : ""}">${badge}</span>` : ""}</button>`;
          }).join("")}
        </div>
        <span class="hint spacer no-mobile">${
          openCount ? `${Fmt.number(openCount)} משימות פתוחות` : "אין משימות פתוחות"}</span>
      </div>

      <div class="tasks">
        ${total ? shown.map(group).join("")
          : UI.empty(ui.filter === "done" ? "עוד לא הושלמו משימות" : "אין משימות פתוחות",
              "כל רישום נשמר גם על כרטיס הלקוח, ותזכורת מעקב מקפיצה אותו לראש הרשימה.",
              "check")}
      </div>

      <button class="fab only-mobile" id="act-new" aria-label="רישום חדש">
        ${UI.icon("plus", 22)}</button>`;

    /* ------------------------------------------------------------- אירועים */
    // מחזיר האם נשמר, כדי שהגיליון יישאר פתוח על קלט חסר במקום להיעלם איתו.
    const save = (draft) => {
      if (!draft.title) {
        App.toast("צריך לכתוב מה צריך לעשות", "down");
        return false;
      }
      if (!draft.party_no) {
        App.toast("צריך לבחור לקוח", "down");
        return false;
      }
      Store.addActivity(draft);
      ui.draft = { party: draft.party_no, kind: draft.kind, follow: "" };
      App.toast("נוסף לרשימה", "up");
      return true;
    };

    const title = root.querySelector("#act-title");
    if (title) {
      const quickSave = () => save({
        party_no: ui.draft.party,
        kind: ui.draft.kind,
        follow_up_on: ui.draft.follow || null,
        title: title.value.trim(),
      });
      root.querySelector("#act-save").addEventListener("click", quickSave);
      title.addEventListener("keydown", (e) => { if (e.key === "Enter") quickSave(); });
      root.querySelector("#act-party-pick").addEventListener("click", () => {
        App.pickCustomer((no) => {
          ui.draft.party = no;
          render(root, ctx);
          root.querySelector("#act-title").focus();
        });
      });
      root.querySelector("#act-more").addEventListener("click",
        () => openComposer({ title: title.value.trim() }, save));
      UI.on(root, "[data-follow]", "click", (e) => {
        ui.draft.follow = e.currentTarget.dataset.follow;
        render(root, ctx);
        const box = root.querySelector("#act-title");
        box.value = title.value;
        box.focus();
      });
      UI.on(root, "[data-kind]", "click", (e) => {
        ui.draft.kind = e.currentTarget.dataset.kind;
        render(root, ctx);
        const box = root.querySelector("#act-title");
        box.value = title.value;
        box.focus();
      });
    }

    root.querySelector("#act-new").addEventListener("click", () => openComposer({}, save));

    UI.on(root, "[data-filter]", "click", (e) => {
      ui.filter = e.currentTarget.dataset.filter;
      render(root, ctx);
    });
    UI.on(root, "[data-toggle]", "click",
      (e) => Store.toggleActivity(e.currentTarget.dataset.toggle));
    UI.on(root, "[data-snooze]", "click", (e) => {
      const days = Number(e.currentTarget.dataset.days);
      const next = Store.snoozeActivity(e.currentTarget.dataset.snooze, days);
      if (next) App.toast(`נדחה ל-${Fmt.dateLong(next)}`, "", { undo: true });
    });
    UI.on(root, "[data-del]", "click", (e) => {
      Store.deleteActivity(e.currentTarget.dataset.del);
      App.toast("הרישום נמחק", "", { undo: true });
    });
    UI.on(root, "[data-customer]", "click", (e) => {
      e.preventDefault();
      App.openCustomer(e.currentTarget.dataset.customer);
    });
  }

  /** הטופס המלא — בטלפון גיליון מסך מלא, בשולחן העבודה חלון. */
  function openComposer(seed, save) {
    const draft = { kind: ui.draft.kind, party: ui.draft.party, ...seed };
    const panel = App.openDrawer({
      title: "רישום חדש",
      sub: "נשמר גם על כרטיס הלקוח",
      body: UI.card("", {
        body: `
          <label class="stacked"><span>מה צריך לעשות</span>
            <input class="input" id="c-title" value="${Fmt.escape(draft.title || "")}"
                   placeholder="תיאור קצר"></label>
          <label class="stacked" style="margin-top:13px"><span>לקוח</span>
            <button class="btn" id="c-party" style="justify-content:flex-start;height:40px">
              ${UI.icon("customers", 15)}<span id="c-party-name" class="ellipsis">${
                draft.party ? Fmt.escape(Store.partyName(draft.party))
                            : "בחירת לקוח"}</span></button></label>
          <div class="form-grid" style="margin-top:13px">
            <label class="stacked"><span>סוג</span>
              <select class="select" id="c-kind">${Object.entries(KINDS).map(([k, v]) => (
                `<option value="${k}" ${draft.kind === k ? "selected" : ""}>${v}</option>`
              )).join("")}</select></label>
            <label class="stacked"><span>תאריך</span>
              <input class="input" type="date" id="c-date" value="${today()}"></label>
          </div>
          <label class="stacked" style="margin-top:13px"><span>תזכורת למעקב</span>
            <input class="input" type="date" id="c-follow" value="${
              ui.draft.follow || ""}"></label>
          <div class="seg" style="margin-top:8px">
            ${[["", "בלי"], [today(), "היום"], [shift(1), "מחר"], [shift(7), "בעוד שבוע"],
               [shift(30), "בעוד חודש"]].map(([value, label]) => (
              `<button data-set-follow="${value}">${label}</button>`)).join("")}
          </div>
          <label class="stacked" style="margin-top:13px"><span>פירוט</span>
            <textarea id="c-body" placeholder="מה סוכם, מה נשאר פתוח"></textarea></label>
          <div class="row-actions" style="margin-top:16px">
            <button class="btn btn-primary" id="c-save">${UI.icon("plus", 15)} שמירה</button>
            <button class="btn" data-close-drawer>ביטול</button>
          </div>`,
      }),
      onReady(node) {
        const name = node.querySelector("#c-party-name");
        node.querySelector("#c-party").addEventListener("click", () => {
          App.pickCustomer((no) => {
            draft.party = no;
            name.textContent = Store.partyName(no);
          }, { keepDrawer: true });
        });
        UI.on(node, "[data-set-follow]", "click", (e) => {
          node.querySelector("#c-follow").value = e.currentTarget.dataset.setFollow;
        });
        node.querySelector("#c-save").addEventListener("click", () => {
          const ok = save({
            party_no: draft.party,
            kind: node.querySelector("#c-kind").value,
            happened_on: node.querySelector("#c-date").value,
            follow_up_on: node.querySelector("#c-follow").value || null,
            title: node.querySelector("#c-title").value.trim(),
            body: node.querySelector("#c-body").value.trim(),
          });
          if (ok) App.closeDrawer();
        });
        const box = node.querySelector("#c-title");
        if (window.innerWidth > 1000) box.focus();
      },
    });
    return panel;
  }

  return { render, openComposer, KINDS, ICONS };
})();
