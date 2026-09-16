/* ============================================================================
   גרפים. SVG שנבנה בקוד — בלי ספריות, כך שהמערכת נטענת מיד ועובדת גם בלי
   רשת. הצבעים נקראים ממשתני ה-CSS, כך שמעבר בין מצב בהיר לכהה משנה גם את
   הגרפים. כל גרף מסודר מימין לשמאל, כמו שאר הממשק.
   ========================================================================== */
window.Charts = (function () {
  const NS = "http://www.w3.org/2000/svg";

  function color(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function palette() {
    return {
      accent: color("--accent"),
      prior: color("--chart-prior"),
      grid: color("--chart-grid"),
      up: color("--up"),
      down: color("--down"),
      muted: color("--muted"),
      warn: color("--warn"),
    };
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

  function legend(host, series) {
    const box = document.createElement("div");
    box.className = "legend";
    box.innerHTML = series.map((s) => (
      `<span><i style="background:${s.color}"></i>${Fmt.escape(s.label)}</span>`
    )).join("");
    host.appendChild(box);
  }

  function axis(svg, max, plot, pad) {
    [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
      const y = pad.top + plot.h * ratio;
      svg.appendChild(el("line", {
        x1: pad.side, x2: 1000 - pad.side, y1: y, y2: y,
        stroke: palette().grid, "stroke-width": ratio === 1 ? 1.5 : 1,
        "shape-rendering": "crispEdges",
      }));
      if (ratio === 0 || ratio === 0.5 || ratio === 1) {
        svg.appendChild(el("text", {
          x: 1000 - pad.side + 9, y: y + 4, "font-size": 11.5,
          fill: palette().muted, "font-family": "inherit", direction: "ltr",
        }, ratio === 1 ? "0" : Fmt.short(max * (1 - ratio))));
      }
    });
  }

  /**
   * עמודות משולבות — השנה הנוכחית מול הקודמת, חודש מול חודש.
   * series = [{ label, values[12], color }]
   */
  function bars(host, series, labels, options = {}) {
    const height = options.height || 250;
    const pad = { top: 14, bottom: 26, side: options.side ?? 46 };
    const svg = frame(host, height);
    const tip = tooltip(host);
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const plot = { w: 1000 - pad.side * 2, h: height - pad.top - pad.bottom };
    const slot = plot.w / labels.length;
    const barW = Math.min(22, (slot * 0.66) / series.length);

    axis(svg, max, plot, pad);

    labels.forEach((label, i) => {
      const right = 1000 - pad.side - slot * i;      // ימין → שמאל
      const groupW = barW * series.length;
      const startX = right - slot / 2 - groupW / 2;

      const hot = el("rect", {
        x: right - slot, y: pad.top, width: slot, height: plot.h,
        fill: "transparent", style: "cursor:crosshair",
      });
      hot.addEventListener("pointerenter", () => {
        const rows = series.map((s) => (
          `<div style="display:flex;gap:10px;justify-content:space-between">
             <span style="opacity:.75">${Fmt.escape(s.label)}</span>
             <b style="font-variant-numeric:tabular-nums">${Fmt.money(s.values[i] || 0)}</b>
           </div>`
        )).join("");
        const pct = (right - slot / 2) / 1000;
        tip.show(`<div style="margin-bottom:3px;font-weight:600">${Fmt.escape(label)}</div>${rows}`,
                 host.clientWidth * pct, pad.top + 16);
      });
      hot.addEventListener("pointerleave", () => tip.hide());
      svg.appendChild(hot);

      series.forEach((s, si) => {
        const value = s.values[i] || 0;
        const barH = Math.max(value > 0 ? 2 : 0, (value / max) * plot.h);
        const rect = el("rect", {
          x: startX + si * barW, y: pad.top + plot.h - barH,
          width: barW - 2, height: barH, rx: 3, fill: s.color,
          style: "pointer-events:none",
        });
        svg.appendChild(rect);
      });

      svg.appendChild(el("text", {
        x: right - slot / 2, y: height - 8, "font-size": 11.5,
        fill: palette().muted, "text-anchor": "middle", "font-family": "inherit",
      }, label));
    });

    host.prepend(svg);
    if (options.legend !== false) legend(host, series);
  }

  /** קו מצטבר: כמה נמכר עד סוף כל חודש, השנה מול אשתקד. */
  function cumulative(host, series, labels, options = {}) {
    const height = options.height || 250;
    const pad = { top: 14, bottom: 26, side: options.side ?? 46 };
    const svg = frame(host, height);
    const tip = tooltip(host);

    const lines = series.map((s) => {
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
      const d = s.points.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
        .join(" ");
      if (s.fill) {
        const area = `${d} L${xAt(s.points.length - 1).toFixed(1)},${pad.top + plot.h} `
                   + `L${xAt(0).toFixed(1)},${pad.top + plot.h} Z`;
        svg.appendChild(el("path", { d: area, fill: s.color, opacity: .09 }));
      }
      svg.appendChild(el("path", {
        d, fill: "none", stroke: s.color, "stroke-width": s.dashed ? 2 : 2.6,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": s.dashed ? "5 5" : "",
        "vector-effect": "non-scaling-stroke",
      }));
      const last = s.points.length - 1;
      svg.appendChild(el("circle", {
        cx: xAt(last), cy: yAt(s.points[last]), r: 4, fill: s.color,
        stroke: color("--surface"), "stroke-width": 2,
      }));
    });

    labels.forEach((label, i) => {
      const hot = el("rect", {
        x: xAt(i) - step / 2, y: pad.top, width: step, height: plot.h,
        fill: "transparent", style: "cursor:crosshair",
      });
      hot.addEventListener("pointerenter", () => {
        const rows = lines.filter((s) => s.points[i] !== undefined).map((s) => (
          `<div style="display:flex;gap:10px;justify-content:space-between">
             <span style="opacity:.75">${Fmt.escape(s.label)}</span>
             <b style="font-variant-numeric:tabular-nums">${Fmt.money(s.points[i])}</b>
           </div>`
        )).join("");
        tip.show(`<div style="margin-bottom:3px;font-weight:600">${
          Fmt.escape(label)} · מצטבר</div>${rows}`,
          host.clientWidth * (xAt(i) / 1000), pad.top + 16);
      });
      hot.addEventListener("pointerleave", () => tip.hide());
      svg.appendChild(hot);

      svg.appendChild(el("text", {
        x: xAt(i), y: height - 8, "font-size": 11.5, fill: palette().muted,
        "text-anchor": "middle", "font-family": "inherit",
      }, label));
    });

    host.prepend(svg);
    if (options.legend !== false) legend(host, lines);
  }

  /** גרף זעיר לשורת טבלה או לכרטיס. מוחזר כמחרוזת HTML. */
  function sparkline(values, options = {}) {
    const width = options.width || 88;
    const height = options.height || 26;
    const max = Math.max(1, ...values);
    const step = width / Math.max(1, values.length);
    const fill = options.color || "var(--accent)";
    const bars = values.map((v, i) => {
      const h = v > 0 ? Math.max(2, (v / max) * (height - 3)) : 1.5;
      const x = width - step * (i + 1) + step * 0.16;   // ימין → שמאל
      return `<rect x="${x.toFixed(1)}" y="${(height - h).toFixed(1)}" `
           + `width="${(step * 0.68).toFixed(1)}" height="${h.toFixed(1)}" rx="1.2" `
           + `fill="${fill}" opacity="${v ? (options.flat ? .9 : .28 + (v / max) * .72) : .17}"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" `
         + `class="spark" aria-hidden="true">${bars}</svg>`;
  }

  /** דירוג כעמודות אופקיות — לעשרת הגדולים ולצומחים. */
  function ranking(host, items, options = {}) {
    const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
    host.innerHTML = items.map((item, i) => {
      const pct = (Math.abs(item.value) / max) * 100;
      const fill = options.color || "var(--accent)";
      return `<div class="bar-row" data-no="${Fmt.escape(item.no || "")}">
        <div class="bar-head">
          <span class="rank">${i + 1}</span>
          <span class="grow ellipsis">${Fmt.escape(item.label)}</span>
          <span class="num" style="font-weight:600">${item.display || Fmt.money(item.value)}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${fill}"></div>
        </div>
      </div>`;
    }).join("") || UI.empty("אין נתונים להצגה", "");
  }

  return { bars, cumulative, sparkline, ranking, palette, color };
})();
