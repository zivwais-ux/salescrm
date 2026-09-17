/* ============================================================================
   מגמה — מה שחמש שנים יודעות לומר ושנה אחת לא: לאן העסק הולך, מה עונתי ומה
   אמיתי, ומי מהלקוחות שינה כיוון לאורך הדרך.

   שלוש הצורות כאן אינן שלוש דרכים להראות אותו דבר. סך שנתי עונה על "כמה",
   שנים-עשר חודשים מתגלגלים עונים על "לאן" בלי שהעונתיות תצייר גלים מדומים,
   ומפת החום עונה על "מתי בשנה" — והיא היחידה שמראה שהחודש החלש אינו כישלון
   אלא אוגוסט.
   ========================================================================== */
window.ViewTrend = (function () {
  const asTable = new Set();

  function chartCard(id, title, sub, body) {
    const showTable = asTable.has(id);
    return UI.card(title, {
      sub,
      actions: `<div class="view-toggle" role="group" aria-label="תצוגה">
          <button data-view-chart="${id}" class="${showTable ? "" : "is-active"}"
                  title="תרשים" aria-pressed="${!showTable}">${UI.icon("chart", 15)}</button>
          <button data-view-table="${id}" class="${showTable ? "is-active" : ""}"
                  title="טבלה" aria-pressed="${showTable}">${UI.icon("grid", 15)}</button>
        </div>`,
      flush: true,
      body: `<div class="card-body" id="${id}">${body || ""}</div>`,
    });
  }

  /** רשימת לקוחות עם מסלול חמש-שנתי זעיר לכל אחד. */
  function pathRows(items, tone) {
    return `<div class="list list-scroll">${items.map((c) => `
      <div class="list-row" data-customer="${Fmt.escape(c.no)}">
        ${UI.avatar(c.name)}
        <div class="grow">
          <div class="list-title ellipsis">${Fmt.escape(c.name)}</div>
          <div class="list-sub">${Fmt.money(c.start)} ← ${Fmt.money(c.end)}</div>
        </div>
        <span class="no-mobile">${Charts.sparkline(c.years, { flat: true,
          color: `var(--${tone})`, width: 70 })}</span>
        <div class="list-value ${tone}">${Fmt.signed(c.delta)}</div>
      </div>`).join("")}</div>`;
  }

  function render(root, ctx) {
    const agent = ctx.agent;
    const years = Metrics.yearly({ agent });
    const roll = Metrics.rolling12({ agent });
    const season = Metrics.seasonality({ agent });
    const mix = Metrics.agentYears({ agent });
    const moves = Metrics.trajectory({ agent });

    // חודש שהדוח תפס באמצעו נמצא בקצה הסדרה, ושנים-עשר חודשים שנגמרים בו
    // אינם שנה שלמה. החלון נמדד עד החודש המלא האחרון, והחלקי מסומן.
    const partial = Metrics.partialMonth({ year: years[years.length - 1].year, agent });
    const cut = partial ? roll.length - 1 : roll.length;
    const last = roll[cut - 1] || {};
    const prev = roll[cut - 13] || {};
    const window12 = last.rolling || 0;
    const window12Prior = prev.rolling || 0;
    const changePct = Metrics.change(window12, window12Prior);

    const full = years.filter((y) => !y.partial);
    const best = full.slice().sort((a, b) => b.total - a.total)[0] || years[0];
    const first = full[0];
    const span = first && best ? full[full.length - 1] : null;
    // קצב שנתי ממוצע בין השנה המלאה הראשונה לאחרונה. בעסק שנע בין 15 ל-18
    // מיליון זו התשובה הכנה ל"האם גדלנו", ולא ההפרש בין שתי שנים שנבחרו.
    const cagr = first && span && first.total > 0 && full.length > 1
      ? ((span.total / first.total) ** (1 / (full.length - 1)) - 1) * 100 : null;

    const period = (point) => (point && point.month
      ? `${Fmt.monthShort(point.month)} ${point.year}` : "");

    // מיליונים נכתבים כ-1.42; תיק קטן, שכל חודש בו הוא אלפים בודדים, היה
    // מתגלגל ל-0.00 בכל תא ואומר כלום.
    const inMillions = season.max >= 1e6;

    root.innerHTML = `
      <section class="hero sec-hero">
        <div class="hero-main">
          <div class="hero-label">שנים-עשר החודשים האחרונים · עד ${period(last)}</div>
          <div class="hero-value">${Fmt.money(window12)}</div>
          <div class="hero-meta">
            ${UI.delta(changePct)}
            <span class="hint">מול ${Fmt.money(window12Prior)} ב-12 החודשים שלפניהם</span>
          </div>
          ${partial ? `<div class="hero-meta"><span class="badge warn">${UI.icon("alert", 12)}
            ${Fmt.month(partial)} ${years[years.length - 1].year} עדיין חלקי בדוח ואינו נספר
            בחלון</span></div>` : ""}
          <div class="hero-meta">
            <span class="badge">${years.length} שנות נתונים · ${
              years[0].year}–${years[years.length - 1].year}</span>
            ${best ? `<span class="badge">השנה החזקה ${best.year} · ${
              Fmt.shortMoney(best.total)}</span>` : ""}
            ${cagr === null ? "" : `<span class="badge ${cagr >= 0 ? "up" : "down"}">
              קצב שנתי ממוצע ${Fmt.percent(cagr, 1)}</span>`}
          </div>
        </div>
        <div class="hero-chart" id="trend-hero"></div>
      </section>

      ${chartCard("trend-years", "מכירות לפי שנה",
        `השנה הנבחרת מודגשת${years.some((y) => y.partial)
          ? ` · ${years.filter((y) => y.partial).map((y) => y.year).join(", ")} עדיין נספרת`
          : ""}`)}

      ${chartCard("trend-roll", "שנים-עשר חודשים מתגלגלים",
        `בכל נקודה: כמה נמכר בשנה שהסתיימה בה. מגמה בלי עונתיות${
          partial ? ` · עד ${Fmt.month(partial - 1)}, החודש המלא האחרון` : ""}`)}

      <div class="grid cols-2" style="align-items:start">
        ${chartCard("trend-season", "עונתיות", `כל תא הוא חודש${
          inMillions ? ", במיליוני ₪" : ""}`)}
        ${UI.card("תמהיל הסוכנים", {
          sub: "אותו גוון לאותו סוכן בכל השנים",
          body: `<div id="trend-mix" class="mix-years"></div>`,
        })}
      </div>

      <div class="grid cols-2" style="align-items:start">
        ${UI.card(`צמחו מאז ${moves.from}`, {
          sub: `${moves.rising.length} לקוחות · השוואה על ${moves.months} החודשים הראשונים`,
          flush: true,
          body: moves.rising.length ? pathRows(moves.rising.slice(0, 12), "up")
            : UI.empty("אין למי להשוות", "", "trendUp"),
        })}
        ${UI.card(`נשחקו מאז ${moves.from}`, {
          sub: `${moves.falling.length} לקוחות · מי שירד הכי הרבה בשקלים`,
          flush: true,
          body: moves.falling.length ? pathRows(moves.falling.slice(0, 12), "down")
            : UI.empty("אף לקוח לא ירד", "", "check"),
        })}
      </div>`;

    /* ---------------------------------------------------------------- ציור */
    // הקו נעצר בחודש המלא האחרון: נקודה שמסכמת שנה שנגמרת באמצע חודש היתה
    // מציירת צניחה שלא קרתה.
    const line = roll.slice(0, cut).map((p) => ({ ...p, value: p.rolling }));

    const hero = root.querySelector("#trend-hero");
    Charts.trend(hero, line, {
      height: 118, side: 8, zero: false, name: "12 חודשים",
      label: (p) => `עד ${Fmt.monthShort(p.month)} ${p.year}`,
    });

    const paint = {
      "trend-years": (host) => Charts.bars(host, [{
        label: "מחזור", values: years.map((y) => y.total),
        color: Charts.color("--accent"),
        // השנה הנבחרת היא הנושא; שאר השנים הן הרקע שלה, ולכן אפור ולא גוון שני.
        colorAt: (i) => (years[i].year === ctx.year
          ? Charts.color("--accent") : Charts.color("--chart-prior")),
      }], years.map((y) => String(y.year)), { height: 240, labels: true, legend: false }),

      "trend-roll": (host) => Charts.trend(host, line, {
        height: 250, zero: false, name: "12 חודשים",
        label: (p) => `עד ${Fmt.monthShort(p.month)} ${p.year}`,
      }),

      "trend-season": (host) => Charts.heatmap(host, season.rows.map((r) => ({
        label: String(r.year),
        values: r.months.map((v, i) => (i < r.closed ? v : null)),
      })), Fmt.SHORT, { max: season.max,
        format: inMillions ? (v) => (v / 1e6).toFixed(2) : Fmt.short }),
    };

    const tables = {
      "trend-years": () => Charts.table(["שנה", "מחזור", "שינוי", "חודשים"],
        years.slice().reverse().map((y) => [
          String(y.year), Fmt.money(y.total),
          y.changePct === null ? "—" : UI.delta(y.changePct),
          y.partial ? `${y.closed} מתוך 12` : "12",
        ])),
      "trend-roll": () => Charts.table(["עד חודש", "12 חודשים אחרונים"],
        line.filter((p) => p.value !== null).slice().reverse()
          .map((p) => [`${Fmt.monthShort(p.month)} ${p.year}`, Fmt.money(p.value)])),
      "trend-season": () => Charts.table(["שנה", ...Fmt.SHORT, "סה״כ"],
        season.rows.slice().reverse().map((r) => [
          String(r.year),
          ...r.months.map((v, i) => (i < r.closed ? Fmt.short(v) : "—")),
          Fmt.money(Metrics.sum(r.months)),
        ])),
    };

    Object.keys(paint).forEach((id) => {
      const host = root.querySelector(`#${id}`);
      if (!host) return;
      if (asTable.has(id)) host.innerHTML = tables[id]();
      else paint[id](host);
    });

    // תמהיל הסוכנים: עמודה מוערמת אחת לכל שנה, כדי שהשינוי בין השנים ייקרא
    // כתנועה של אותם שלושה גופים ולא כחמישה גרפים נפרדים.
    const mixHost = root.querySelector("#trend-mix");
    mixHost.innerHTML = mix.rows.slice().reverse().map((row) => `
      <div class="mix-row">
        <div class="mix-head">
          <span class="mix-year">${row.year}</span>
          <span class="num hint">${Fmt.shortMoney(row.total)}</span>
        </div>
        <div class="stack-bar">${row.items.filter((i) => i.value > 0).map((i) => `
          <div class="stack-seg" style="width:${(i.value / (row.total || 1)) * 100}%;
            background:${i.color}" title="${Fmt.escape(i.name)}: ${
            Fmt.money(i.value)}"></div>`).join("")}</div>
      </div>`).join("")
      + `<div class="legend">${mix.rows[mix.rows.length - 1].items.map((i) => (
        `<span><i style="background:${i.color}"></i>${Fmt.escape(i.name)}</span>`)).join("")}</div>`;

    UI.on(root, "[data-view-chart]", "click", (e) => {
      asTable.delete(e.currentTarget.dataset.viewChart);
      render(root, ctx);
    });
    UI.on(root, "[data-view-table]", "click", (e) => {
      asTable.add(e.currentTarget.dataset.viewTable);
      render(root, ctx);
    });
    UI.on(root, "[data-customer]", "click",
      (e) => App.openCustomer(e.currentTarget.dataset.customer));
  }

  return { render };
})();
