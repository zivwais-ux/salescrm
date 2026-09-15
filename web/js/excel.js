/* ============================================================================
   אקסל: ייצוא, ייבוא, ועדכון אוטומטי "מאחורי הקלעים".

   הגיליונות נבנים באותו מבנה של הדוח המקורי, כדי שהקובץ יישאר מוכר:
     • "ניתוח מכירות"  - לקוח מול חודשים, לכל שנה גיליון.
     • "נתוני גלם"     - שורה לכל לקוח/משלם/חודש, לייבוא חזרה למערכת.
     • "סיכום חודשי"   - שורת סיכום לכל חודש, השנה מול אשתקד.
     • "יעדים ומעקב"   - יעד, ביצוע, פער וסטטוס לכל לקוח.
   ========================================================================== */
window.Excel = (function () {
  const cfg = window.APP_CONFIG;
  let libraryPromise = null;

  function library() {
    if (!libraryPromise) libraryPromise = Store.loadScript(cfg.xlsxCdn).then(() => window.XLSX);
    return libraryPromise;
  }

  /**
   * גיבוי ללא ספריות: חוברת SpreadsheetML (הפורמט ש-Excel פותח מאז 2003),
   * נבנית מהדפדפן עצמו. משמשת כשאין גישה לרשת לטעינת הספרייה.
   */
  function xmlWorkbook(agent) {
    const esc = (v) => String(v).replace(/[&<>]/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const cell = (v) => (typeof v === "number" && isFinite(v)
      ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${esc(v ?? "")}</Data></Cell>`);
    const body = sheets(agent).map(({ name, rows }) => `
      <Worksheet ss:Name="${esc(name.slice(0, 31))}"><Table>
        ${rows.map((row) => `<Row>${row.map(cell).join("")}</Row>`).join("")}
      </Table>
      <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
        <DisplayRightToLeft/><FreezePanes/><SplitHorizontal>1</SplitHorizontal>
        <TopRowBottomPane>1</TopRowBottomPane>
      </WorksheetOptions></Worksheet>`).join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${body}</Workbook>`;
    return new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel" });
  }

  function sheets(agent) {
    const years = Store.years();
    const out = [];

    years.slice().reverse().forEach((year) => {
      const view = Metrics.overview({ year, agent });
      const header = ["מס' לקוח", "שם לקוח", "סטטוס", ...Fmt.MONTHS, 'סה"כ',
                      `סה"כ ${year - 1}`, "שינוי %"];
      const body = view.customers
        .filter((c) => c.total || c.priorTotal)
        .map((c) => [
          c.no, c.name, c.profile.status || "",
          ...c.months.map((v) => round(v)),
          round(c.total), round(c.priorTotal),
          c.changePct === null ? "" : Math.round(c.changePct * 10) / 10,
        ]);
      const totals = ["", 'סה"כ', "",
        ...view.monthsCur.map((v) => round(v)),
        round(Metrics.sum(view.monthsCur)),
        round(Metrics.sum(view.monthsPrior)), ""];
      out.push({ name: `ניתוח מכירות ${year}`, rows: [header, ...body, totals] });
    });

    const raw = [["מס' לקוח", "שם לקוח", "מס' משלם", "שם משלם", "מס' סוכן",
                  "שנה", "חודש", "סכום", "מקור"]];
    Store.sales()
      .filter((s) => !agent || agent === "all" || s.agent === agent)
      .sort((a, b) => (b.y - a.y) || (b.m - a.m) || (b.a - a.a))
      .forEach((s) => raw.push([
        s.c, Store.partyName(s.c), s.p, Store.partyName(s.p), s.agent,
        s.y, s.m, round(s.a), s.source === "erp" ? "ERP" : "ידני",
      ]));
    out.push({ name: "נתוני גלם", rows: raw });

    const latest = years[years.length - 1];
    const view = Metrics.overview({ year: latest, agent });
    const monthly = [["חודש", `${latest}`, `${latest - 1}`, "הפרש", "שינוי %"]];
    Fmt.MONTHS.forEach((label, i) => {
      const cur = view.monthsCur[i];
      const prev = view.monthsPrior[i];
      const pct = Metrics.change(cur, prev);
      monthly.push([label, round(cur), round(prev), round(cur - prev),
                    pct === null ? "" : Math.round(pct * 10) / 10]);
    });
    out.push({ name: "סיכום חודשי", rows: monthly });

    const targets = [["מס' לקוח", "שם לקוח", `יעד ${latest}`, "ביצוע עד כה",
                      "פער", "אחוז עמידה", "חודש אחרון עם מכירה", "סטטוס"]];
    view.customers.filter((c) => c.target || c.ytd).forEach((c) => targets.push([
      c.no, c.name, round(c.target), round(c.ytd), round(c.ytd - c.target),
      c.target ? Math.round((c.ytd / c.target) * 100) : "",
      c.lastActive ? Fmt.month(c.lastActive) : "",
      c.profile.status || "",
    ]));
    out.push({ name: "יעדים ומעקב", rows: targets });

    return out;
  }

  const round = (v) => Math.round((v || 0) * 100) / 100;

  /** ממפה כותרות עבריות לשדות המערכת. */
  function mapRow(row) {
    const pick = (...names) => {
      const key = Object.keys(row).find((k) => names.some((n) => k.trim().includes(n)));
      return key ? row[key] : "";
    };
    return {
      customer_no: String(pick("מס' לקוח", "לקוח")).trim(),
      customer_name: pick("שם לקוח"),
      payer_no: String(pick("משלם")).trim(),
      payer_name: pick("שם משלם"),
      agent_no: String(pick("סוכן")).trim(),
      year: Number(pick("שנה")),
      month: Number(pick("חודש")),
      amount: pick("סכום"),
    };
  }

  /** קורא CSV פשוט (כולל שדות במרכאות). */
  function readCsv(text) {
    const lines = text.replace(/^\ufeff/, "").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const split = (line) => {
      const out = [];
      let value = "";
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quoted && ch === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
        else if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) { out.push(value); value = ""; }
        else value += ch;
      }
      out.push(value);
      return out;
    };
    const header = split(lines[0]);
    return lines.slice(1)
      .map((line) => Object.fromEntries(split(line).map((v, i) => [header[i] || i, v])))
      .map(mapRow)
      .filter((r) => r.customer_no && r.year && r.month);
  }

  async function workbook(agent) {
    const XLSX = await library();
    const book = XLSX.utils.book_new();
    book.Workbook = { Views: [{ RTL: true }] };
    sheets(agent).forEach(({ name, rows }) => {
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet["!cols"] = rows[0].map((_, i) => ({ wch: i === 1 || i === 3 ? 30 : 13 }));
      sheet["!freeze"] = { xSplit: "0", ySplit: "1" };
      XLSX.utils.book_append_sheet(book, sheet, name.slice(0, 31));
    });
    const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
    return new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  /**
   * שם הקובץ באנגלית בכוונה: חלק מהדפדפנים מתעלמים משם הורדה בעברית
   * ושומרים קובץ בשם "download" בלי סיומת.
   */
  function filename() {
    return `sales-analysis-${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  function saveAs(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    // The anchor has to outlive the click, or the browser drops the chosen name.
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 2000);
  }

  return {
    /**
     * מוריד את הקובץ למחשב. אם אי אפשר לטעון את ספריית ה-xlsx (למשל בלי
     * אינטרנט) נוצר קובץ Excel בפורמט XML, שנפתח באותה צורה.
     */
    async download(agent) {
      try {
        const blob = await workbook(agent);
        saveAs(blob, filename());
        return { blob, format: "xlsx" };
      } catch (err) {
        const blob = xmlWorkbook(agent);
        saveAs(blob, filename().replace(/\.xlsx$/, ".xls"));
        return { blob, format: "xls" };
      }
    },

    /**
     * מעדכן את העותק בענן בלי להוריד קובץ - זה ה"מאחורי הקלעים":
     * אחרי כל שינוי הקובץ ב-Supabase Storage מתעדכן, ומי שפותח אותו
     * מקבל תמיד את המצב האחרון.
     */
    async syncToCloud(agent) {
      if (Store.state.backend !== "supabase") return false;
      let blob;
      try {
        blob = await workbook(agent);
      } catch (err) {
        blob = xmlWorkbook(agent);
      }
      return Store.uploadWorkbook(blob);
    },

    /** קורא קובץ אקסל או CSV ומחזיר שורות לייבוא. תומך בגיליון "נתוני גלם". */
    async read(file) {
      if (/\.csv$/i.test(file.name)) return readCsv(await file.text());
      const XLSX = await library();
      const data = new Uint8Array(await file.arrayBuffer());
      const book = XLSX.read(data, { type: "array" });
      const sheetName = book.SheetNames.find((n) => n.includes("גלם")) || book.SheetNames[0];
      const table = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: "" });

      return table.map(mapRow).filter((r) => r.customer_no && r.year && r.month);
    },

    workbook,
    xmlWorkbook,
  };
})();
