/* ============================================================================
   גרפים. SVG שנבנה בקוד - בלי ספריות חיצוניות, כך שהמערכת עובדת גם בלי רשת.
   כל הגרפים מיושרים לימין-לשמאל כמו שאר הממשק.
   ========================================================================== */
window.Charts = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const COLORS = { current: "#1d4ed8", prior: "#cbd5e1", good: "#047857", bad: "#b91c1c" };

  function el(name, attrs = {}, text) {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(width, height) {
    const node = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      class: "chart",
      preserveAspectRatio: "none",
      role: "img",
    });
    node.style.height = `${height}px`;
    return node;
  }

  function niceMax(value) {
    if (value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    return Math.ceil(value / magnitude) * magnitude;
  }

  /**
   * עמודות משולבות: השנה הנוכחית מול הקודמת, חודש מול חודש.
   * series = [{ label, values:[12], color }]
   */
  function groupedBars(container, series, labels, options = {}) {
    const width = 720;
    const height = options.height || 240;
    const pad = { top: 14, bottom: 26, side: 46 };
    const node = svg(width, height);
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const plotW = width - pad.side * 2;
    const plotH = height - pad.top - pad.bottom;
    const slot = plotW / labels.length;
    const barW = Math.max(3, (slot * 0.62) / series.length);

    [0, 0.5, 1].forEach((ratio) => {
      const y = pad.top + plotH * ratio;
      node.appendChild(el("line", {
        x1: pad.side, x2: width - pad.side, y1: y, y2: y,
        stroke: "#e2e8f0", "stroke-width": 1,
      }));
      node.appendChild(el("text", {
        x: width - pad.side + 6, y: y + 4, "font-size": 10, fill: "#94a3b8",
      }, Fmt.short(max * (1 - ratio))));
    });

    labels.forEach((label, i) => {
      // ימין-לשמאל: החודש הראשון בקצה הימני.
      const slotStart = width - pad.side - slot * (i + 1);
      series.forEach((s, si) => {
        const value = s.values[i] || 0;
        const barH = (value / max) * plotH;
        const x = slotStart + slot * 0.19 + si * barW;
        node.appendChild(el("rect", {
          x, y: pad.top + plotH - barH, width: barW, height: Math.max(0, barH),
          rx: 3, fill: s.color,
        })).appendChild(el("title", {}, `${label} · ${s.label}: ${Fmt.money(value)}`));
      });
      node.appendChild(el("text", {
        x: slotStart + slot / 2, y: height - 8, "font-size": 10,
        fill: "#64748b", "text-anchor": "middle",
      }, label));
    });

    container.innerHTML = "";
    container.appendChild(node);
    if (options.legend !== false) {
      const legend = document.createElement("div");
      legend.className = "legend";
      legend.innerHTML = series.map((s) => (
        `<span><i style="background:${s.color}"></i>${Fmt.escape(s.label)}</span>`
      )).join("");
      container.appendChild(legend);
    }
  }

  /** קו מצטבר: כמה נמכר עד כל חודש, השנה מול אשתקד. */
  function cumulativeLines(container, series, labels, options = {}) {
    const width = 720;
    const height = options.height || 220;
    const pad = { top: 14, bottom: 26, side: 46 };
    const node = svg(width, height);
    const cumulative = series.map((s) => {
      let acc = 0;
      return { ...s, points: s.values.map((v) => (acc += v)) };
    });
    const max = niceMax(Math.max(1, ...cumulative.flatMap((s) => s.points)));
    const plotW = width - pad.side * 2;
    const plotH = height - pad.top - pad.bottom;
    const stepX = plotW / Math.max(1, labels.length - 1);
    const xAt = (i) => width - pad.side - stepX * i;   // ימין-לשמאל
    const yAt = (v) => pad.top + plotH - (v / max) * plotH;

    [0, 0.5, 1].forEach((ratio) => {
      const y = pad.top + plotH * ratio;
      node.appendChild(el("line", { x1: pad.side, x2: width - pad.side, y1: y, y2: y,
                                    stroke: "#e2e8f0" }));
      node.appendChild(el("text", { x: width - pad.side + 6, y: y + 4, "font-size": 10,
                                    fill: "#94a3b8" }, Fmt.short(max * (1 - ratio))));
    });

    cumulative.forEach((s) => {
      const visible = s.points.filter((_, i) => s.values.slice(i).some((v) => v) || s.values[i]);
      const count = Math.max(1, visible.length);
      const path = s.points.slice(0, count)
        .map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
      node.appendChild(el("path", {
        d: path, fill: "none", stroke: s.color, "stroke-width": 2.5,
        "stroke-linejoin": "round", "stroke-linecap": "round",
      }));
      s.points.slice(0, count).forEach((v, i) => {
        const dot = el("circle", { cx: xAt(i), cy: yAt(v), r: 3, fill: s.color });
        dot.appendChild(el("title", {}, `${labels[i]} · ${s.label}: ${Fmt.money(v)}`));
        node.appendChild(dot);
      });
    });

    labels.forEach((label, i) => {
      node.appendChild(el("text", { x: xAt(i), y: height - 8, "font-size": 10,
                                    fill: "#64748b", "text-anchor": "middle" }, label));
    });

    container.innerHTML = "";
    container.appendChild(node);
    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = cumulative.map((s) => (
      `<span><i style="background:${s.color}"></i>${Fmt.escape(s.label)}</span>`
    )).join("");
    container.appendChild(legend);
  }

  /** גרף זעיר לשורת טבלה. מוחזר כמחרוזת HTML. */
  function sparkline(values, options = {}) {
    const width = options.width || 92;
    const height = options.height || 24;
    const max = Math.max(1, ...values);
    const step = width / Math.max(1, values.length);
    const bars = values.map((v, i) => {
      const barH = Math.max(v > 0 ? 1.5 : 0, (v / max) * (height - 3));
      const x = width - step * (i + 1) + step * 0.15;   // ימין-לשמאל
      return `<rect x="${x.toFixed(1)}" y="${(height - barH).toFixed(1)}" ` +
             `width="${(step * 0.7).toFixed(1)}" height="${barH.toFixed(1)}" rx="1" ` +
             `fill="${options.color || COLORS.current}" opacity="${v ? 1 : .25}"></rect>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
           `class="spark" aria-hidden="true">${bars}</svg>`;
  }

  /** רשימת עמודות אופקיות - לדירוג לקוחות. */
  function ranking(container, items, options = {}) {
    const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
    container.innerHTML = items.map((item) => {
      const pct = (Math.abs(item.value) / max) * 100;
      const color = options.colorBy ? options.colorBy(item) : COLORS.current;
      return `
        <div class="bar-item" data-no="${Fmt.escape(item.no || "")}">
          <div class="bar-label">
            <span>${Fmt.escape(item.label)}</span>
            <span class="num">${item.display || Fmt.money(item.value)}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
          </div>
        </div>`;
    }).join("") || '<p class="empty">אין נתונים להצגה</p>';
  }

  return { groupedBars, cumulativeLines, sparkline, ranking, COLORS };
})();
