/* ============================================================================
   גרפים. SVG שנבנה בקוד — בלי ספריות, כך שהמערכת נטענת מיד ועובדת גם בלי
   רשת. הצבעים נקראים ממשתני ה-CSS, ולכן מעבר בין מצב בהיר לכהה גורר גם אותם.

   מפרט הסימנים אחיד בכל הגרפים:
     • עמודה: עד 24px רוחב, פינות מעוגלות בקצה הנתון בלבד וישרות על הבסיס.
     • קו: 2px, חיבורים מעוגלים. נקודה: רדיוס 4 ומעלה עם טבעת בצבע הרקע.
     • רווח של 2px בצבע הרקע בין סימנים נוגעים — הרווח מפריד, לא מסגרת.
     • רשת וצירים: קו שיער אחיד, לא מקווקו, צעד אחד מהרקע.
   לכל גרף יש תצוגת טבלה מקבילה, כדי שאף ערך לא יהיה נגיש רק דרך ריחוף.
   ========================================================================== */
window.Charts = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const BAR_MAX = 24;
  const GAP = 2;

  function color(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /**
   * שלושת הגוונים לסדרות זהות (פילוח לפי סוכן).
   * נלקחו מפלטה מאומתת ונבדקו בשני המצבים מול כל הזוגות: הפרדה לעיוורי צבעים
   * ΔE 9.2 בבהיר ו-9.4 בכהה, מעל סף 8. הגוון הירוק יורד מ-3:1 ניגודיות על רקע
   * בהיר, ולכן הגרף הזה תמיד מגיע עם תוויות גלויות וטבלה.
   */
  function series(index) {
    const dark = document.documentElement.dataset.theme === "dark";
    return (dark ? ["#3987e5", "#d95926", "#199e70", "#8b93a5"]
                 : ["#2a78d6", "#eb6834", "#1baf7a", "#9aa1af"])[index % 4];
  }

  function el(name, attrs = {}, text) {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** תקרה "עגולה" לציר, כדי שהתוויות יהיו מספרים קריאים. */
  function niceMax(value) {
    if (value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
    return magnitude * steps.find((s) => value / magnitude <= s);
  }

  /**
   * עמודה שהקצה המעוגל שלה הוא תמיד קצה הנתון, והבסיס ישר.
   * `down` מצייר עמודה שיורדת מקו האפס — שם הקצה נמצא למטה.
   */
  function columnPath(x, y, w, h, { r = 4, down = false } = {}) {
    if (h <= 0.5) return "";
    const radius = Math.min(r, w / 2, h);
    if (down) {
      return `M${x},${y} L${x},${y + h - radius} Q${x},${y + h} ${x + radius},${y + h} `
           + `L${x + w - radius},${y + h} Q${x + w},${y + h} ${x + w},${y + h - radius} `
           + `L${x + w},${y} Z`;
    }
    return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} `
         + `L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} `
         + `L${x + w},${y + h} Z`;
  }

  /** בועית מידע שעוקבת אחרי הסמן, משותפת לכל סוגי הגרפים. */
  function tooltip(host) {
    host.classList.add("chart-host");
    let tip = host.querySelector(".chart-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      host.appendChild(tip);
    }
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.style.insetInlineEnd = `${x}px`;
        tip.style.top = `${y}px`;
        tip.classList.add("is-on");
      },
      hide() { tip.classList.remove("is-on"); },
    };
  }

  function tipRows(label, rows) {
    return `<div style="margin-bottom:4px;font-weight:600">${Fmt.escape(label)}</div>`
      + rows.map(({ name, value, swatch }) => `
        <div style="display:flex;gap:12px;justify-content:space-between;align-items:center">
          <span style="display:inline-flex;align-items:center;gap:6px;opacity:.85">
            ${swatch ? `<i style="width:8px;height:8px;border-radius:2px;background:${
              swatch};display:inline-block"></i>` : ""}${Fmt.escape(name)}</span>
          <b style="font-variant-numeric:tabular-nums">${value}</b>
        </div>`).join("");
  }

  function frame(host, height) {
    const svg = el("svg", {
      viewBox: `0 0 1000 ${height}`,
      class: "chart",
      preserveAspectRatio: "none",
      role: "img",
    });
    svg.style.height = `${height}px`;
    host.querySelectorAll("svg, .legend").forEach((n) => n.remove());
    return svg;
  }

  function legend(host, items) {
    const box = document.createElement("div");
    box.className = "legend";
    box.innerHTML = items.map((s) => (
      `<span><i style="background:${s.color}"></i>${Fmt.escape(s.label)}</span>`
    )).join("");
    host.appendChild(box);
  }

  function axis(svg, max, plot, pad) {
    [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
      const y = pad.top + plot.h * ratio;
      svg.appendChild(el("line", {
        x1: pad.side, x2: 1000 - pad.side, y1: y, y2: y,
        stroke: color("--chart-grid"), "stroke-width": 1,
        "shape-rendering": "crispEdges",
      }));
      if (ratio === 0 || ratio === 0.5 || ratio === 1) {
        svg.appendChild(el("text", {
          x: 1000 - pad.side + 9, y: y + 4, "font-size": 11.5,
          fill: color("--muted"), "font-family": "inherit", direction: "ltr",
        }, ratio === 1 ? "0" : Fmt.short(max * (1 - ratio))));
      }
    });
  }

  /**
   * עמודות משולבות — השנה הנוכחית מול הקודמת, חודש מול חודש.
   * השנה הנוכחית היא הנושא והקודמת היא הרקע, ולכן צבע אחד מודגש מול אפור
   * ולא שני צבעי זהות.
   */
  function bars(host, data, labels, options = {}) {
    const height = options.height || 250;
    const pad = { top: 14, bottom: 26, side: options.side ?? 46 };
    const svg = frame(host, height);
    const tip = tooltip(host);
    const max = niceMax(Math.max(1, ...data.flatMap((s) => s.values)));
    const plot = { w: 1000 - pad.side * 2, h: height - pad.top - pad.bottom };
    const slot = plot.w / labels.length;
    const barW = Math.min(BAR_MAX, (slot * 0.68 - GAP * (data.length - 1)) / data.length);

    axis(svg, max, plot, pad);

    labels.forEach((label, i) => {
      const right = 1000 - pad.side - slot * i;        // ימין → שמאל
      const groupW = barW * data.length + GAP * (data.length - 1);
      const startX = right - slot / 2 - groupW / 2;

      const hot = el("rect", {
        x: right - slot, y: pad.top, width: slot, height: plot.h,
        fill: "transparent", style: "cursor:crosshair",
      });
      hot.addEventListener("pointerenter", () => tip.show(
        tipRows(label, data.map((s) => ({
          name: s.label, value: Fmt.money(s.values[i] || 0), swatch: s.color,
        }))),
        host.clientWidth * ((right - slot / 2) / 1000), pad.top + 18));
      hot.addEventListener("pointerleave", () => tip.hide());
      svg.appendChild(hot);

      data.forEach((s, si) => {
        const value = s.values[i] || 0;
        const barH = value > 0 ? Math.max(2, (value / max) * plot.h) : 0;
        if (!barH) return;
        svg.appendChild(el("path", {
          d: columnPath(startX + si * (barW + GAP), pad.top + plot.h - barH, barW, barH),
          fill: s.color, style: "pointer-events:none",
        }));
      });

      svg.appendChild(el("text", {
        x: right - slot / 2, y: height - 8, "font-size": 11.5,
        fill: color("--muted"), "text-anchor": "middle", "font-family": "inherit",
      }, label));
    });

    host.prepend(svg);
    if (options.legend !== false && data.length > 1) {
      legend(host, data.map((s) => ({ label: s.label, color: s.color })));
    }
  }

  /** קו מצטבר: כמה נמכר עד סוף כל חודש, השנה מול אשתקד. */
  function cumulative(host, data, labels, options = {}) {
    const height = options.height || 250;
    const pad = { top: 14, bottom: 26, side: options.side ?? 46 };
    const svg = frame(host, height);
    const tip = tooltip(host);

    const lines = data.map((s) => {
      let acc = 0;
      const points = [];
      s.values.forEach((v, i) => {
        acc += v;
        if (i < (s.upto ?? s.values.length)) points.push(acc);
      });
      return { ...s, points };
    });

    const max = niceMax(Math.max(1, ...lines.flatMap((s) => s.points)));
    const plot = { w: 1000 - pad.side * 2, h: height - pad.top - pad.bottom };
    const step = plot.w / Math.max(1, labels.length - 1);
    const xAt = (i) => 1000 - pad.side - step * i;
    const yAt = (v) => pad.top + plot.h - (v / max) * plot.h;

    axis(svg, max, plot, pad);

    lines.forEach((s) => {
      if (!s.points.length) return;
      const d = s.points.map((v, i) => (
        `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)).join(" ");
      if (s.fill) {
        svg.appendChild(el("path", {
          d: `${d} L${xAt(s.points.length - 1).toFixed(1)},${pad.top + plot.h} `
           + `L${xAt(0).toFixed(1)},${pad.top + plot.h} Z`,
          fill: s.color, opacity: .10,
        }));
      }
      svg.appendChild(el("path", {
        d, fill: "none", stroke: s.color, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": s.dashed ? "5 5" : "",
        "vector-effect": "non-scaling-stroke",
      }));
      const last = s.points.length - 1;
      // טבעת בצבע הרקע, כדי שהנקודה תישאר קריאה גם כששני הקווים נחתכים.
      svg.appendChild(el("circle", {
        cx: xAt(last), cy: yAt(s.points[last]), r: 4.5, fill: s.color,
        stroke: color("--surface"), "stroke-width": 2,
      }));
    });

    labels.forEach((label, i) => {
      const hot = el("rect", {
        x: xAt(i) - step / 2, y: pad.top, width: step, height: plot.h,
        fill: "transparent", style: "cursor:crosshair",
      });
      hot.addEventListener("pointerenter", () => tip.show(
        tipRows(`${label} · מצטבר`, lines
          .filter((s) => s.points[i] !== undefined)
          .map((s) => ({ name: s.label, value: Fmt.money(s.points[i]), swatch: s.color }))),
        host.clientWidth * (xAt(i) / 1000), pad.top + 18));
      hot.addEventListener("pointerleave", () => tip.hide());
      svg.appendChild(hot);

      svg.appendChild(el("text", {
        x: xAt(i), y: height - 8, "font-size": 11.5, fill: color("--muted"),
        "text-anchor": "middle", "font-family": "inherit",
      }, label));
    });

    host.prepend(svg);
    if (options.legend !== false && lines.length > 1) {
      legend(host, lines.map((s) => ({ label: s.label, color: s.color })));
    }
  }

  /**
   * עמודות סביב קו אפס — מי הוסיף למחזור ומי גרע ממנו.
   * הקוטביות היא הנושא, ולכן שני צבעים מנוגדים ואפס ניטרלי באמצע.
   *
   * הצורה אופקית ולא אנכית: שמות חברות בעברית ארוכים מדי לתוויות מתחת
   * לעמודה — הטיה שלהן הופכת אותן לבלתי קריאות ולרעש חזותי.
   */
  function diverging(host, items) {
    const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
    host.innerHTML = `<div class="div-chart">${items.map((item) => {
      const pct = (Math.abs(item.value) / max) * 50;
      const positive = item.value >= 0;
      return `<div class="div-row" data-no="${Fmt.escape(item.no || "")}"
                   title="${Fmt.escape(item.label)}">
        <span class="div-name ellipsis">${Fmt.escape(item.label)}</span>
        <span class="div-track">
          <span class="div-axis"></span>
          <span class="div-bar ${positive ? "pos" : "neg"}"
                style="width:${pct.toFixed(2)}%"></span>
        </span>
        <span class="div-value ${positive ? "up" : "down"}">${Fmt.signed(item.value)}</span>
      </div>`;
    }).join("")}</div>`;

    legend(host, [{ label: "תוספת למחזור", color: color("--up") },
                  { label: "גריעה מהמחזור", color: color("--down") }]);
  }

  /**
   * עמודה מוערמת אחת — פילוח חלק-מתוך-שלם.
   * סדרות הזהות מקבלות גוונים קבועים לפי מיקום, לעולם לא לפי גודל.
   */
  function stacked(host, items, options = {}) {
    const total = items.reduce((a, b) => a + b.value, 0) || 1;
    const bar = document.createElement("div");
    bar.className = "stack-bar";
    bar.innerHTML = items.map((item, i) => {
      const pct = (item.value / total) * 100;
      return `<div class="stack-seg" style="width:${pct}%;background:${
        item.color || series(i)}" title="${Fmt.escape(item.name)}"></div>`;
    }).join("");

    const rows = document.createElement("div");
    rows.className = "stack-legend";
    rows.innerHTML = items.map((item, i) => `
      <div class="stack-row">
        <i style="background:${item.color || series(i)}"></i>
        <span class="grow ellipsis">${Fmt.escape(item.name)}${
          item.count ? ` <span class="hint">(${item.count})</span>` : ""}</span>
        <span class="num">${Fmt.money(item.value)}</span>
        <span class="num hint" style="width:44px">${
          ((item.value / total) * 100).toFixed(1)}%</span>
      </div>`).join("");

    host.innerHTML = "";
    host.appendChild(bar);
    host.appendChild(rows);
  }

  /** גרף זעיר לשורת טבלה או לכרטיס. מוחזר כמחרוזת HTML. */
  function sparkline(values, options = {}) {
    const width = options.width || 88;
    const height = options.height || 26;
    const max = Math.max(1, ...values);
    const step = width / Math.max(1, values.length);
    const w = Math.max(1.5, step - GAP);
    const fill = options.color || "var(--accent)";
    const bars = values.map((v, i) => {
      const h = v > 0 ? Math.max(2, (v / max) * (height - 3)) : 1.5;
      const x = width - step * (i + 1) + GAP / 2;
      return `<rect x="${x.toFixed(1)}" y="${(height - h).toFixed(1)}" `
           + `width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.2" `
           + `fill="${fill}" opacity="${v ? (options.flat ? .9 : .3 + (v / max) * .7) : .16}"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" `
         + `class="spark" aria-hidden="true">${bars}</svg>`;
  }

  /** דירוג כעמודות אופקיות — סדרה אחת, גוון אחד, בלי מקרא. */
  function ranking(host, items, options = {}) {
    const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
    host.innerHTML = items.map((item, i) => {
      const pct = (Math.abs(item.value) / max) * 100;
      return `<div class="bar-row" data-no="${Fmt.escape(item.no || "")}">
        <div class="bar-head">
          <span class="rank">${i + 1}</span>
          <span class="grow ellipsis">${Fmt.escape(item.label)}</span>
          <span class="num" style="font-weight:600">${
            item.display || Fmt.money(item.value)}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${
            options.color || "var(--accent)"}"></div>
        </div>
      </div>`;
    }).join("") || UI.empty("אין נתונים להצגה", "");
  }

  /** תצוגת הטבלה של גרף — כל ערך נגיש גם בלי ריחוף. */
  function table(columns, rows) {
    return `<div class="table-wrap"><table>
      <thead><tr>${columns.map((c, i) => (
        `<th class="${i ? "num" : ""}">${Fmt.escape(c)}</th>`)).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((cell, i) => (
        `<td class="${i ? "num" : ""}">${cell}</td>`)).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  return { bars, cumulative, diverging, stacked, sparkline, ranking, table,
           series, color, columnPath };
})();
