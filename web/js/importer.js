/* ============================================================================
   קריאת טבלה שהגיעה מבחוץ — קובץ שנגרר פנימה או טבלה שהודבקה.

   המטרה היא שלא יהיה מה ללמוד: מייצאים מה-ERP, גוררים או מדביקים, ורואים מה
   נכנס. לכן הקריאה כאן מזהה את העמודות לפי הכותרות שלהן ולא לפי מיקומן, קוראת
   את החודש מתוך הטבלה עצמה ("ספט-2026"), ועובדת גם על הדבקה של שתי עמודות
   בלבד — שם או מספר לקוח, וסכום — כשאין כותרות.

   כלום לא נשמר כאן. המודול מחזיר תוכנית: אילו חודשים יוחלפו, מה ייכנס בהם,
   מי הלקוחות שייפתחו, ומה לא זוהה. השמירה היא צעד נפרד שהמשתמש מאשר.
   ========================================================================== */
window.Importer = (function () {
  const FIELDS = {
    agent_no: ["מס' סוכן", "מס סוכן", "מספר סוכן", "קוד סוכן"],
    agent_name: ["שם סוכן"],
    customer_no: ["מס. לקוח", "מס' לקוח", "מס לקוח", "מספר לקוח", "קוד לקוח"],
    customer_name: ["שם לקוח"],
    payer_no: ["לקוח משלם", "מס משלם", "מספר משלם", "קוד משלם"],
    payer_name: ["שם לקוח משלם", "שם משלם"],
    currency: ["מטבע"],
    period: ["חודש ושנה", "חודש", "תקופה", "תאריך"],
    amount: ["מחיר כולל", "סכום", "מחזור", "סה\"כ", "סהכ"],
  };

  const clean = (text) => String(text ?? "").replace(/[\s"'`״׳.]+/g, "").trim();

  /**
   * שם כפי שהוא נקרא, בלי סימון הסניף.
   *
   * הדוח וה-ERP מדפיסים אחרי כל שם את אות הסניף ("-ב"), והיא אינה חלק מהשם.
   * היא נחתכת רק כשרווח או מקף מפרידים אותה, אחרת שם כמו "תמי יהב" היה מאבד
   * את האות האחרונה שלו.
   */
  const cleanName = (text) => String(text ?? "").trim()
    .replace(/[\s-]+\(?\s*ב\s*\)?\s*$/, "")
    .replace(/^\s*(?:\(\s*ב\s*\)|ב\s*-)\s*/, "")
    .replace(/\s+/g, " ").trim();

  /**
   * מטבע השורה, ושקל נשמר כריק.
   *
   * במאגר שורה שקלית נרשמת בלי מטבע, ורק שורה שתומחרה במטבע אחר נושאת אותו.
   * אם הייבוא היה רושם "ש\'ח" במפורש, אותה מכירה היתה נכנסת כשורה שנייה לצד
   * הקיימת ומסכמת פעמיים.
   */
  function currencyOf(text) {
    const key = String(text ?? "").replace(/[\s.'"״׳]/g, "").toLowerCase();
    return !key || key === "שח" || key === "₪" || key === "ils" || key === "nis"
      ? "" : String(text).trim();
  }

  /** מזהה שורת כותרות ומחזיר מיפוי עמודה → שדה, או null אם אינה כותרת. */
  function headerOf(cells) {
    const found = {};
    const taken = new Set();
    cells.forEach((cell, i) => {
      const key = clean(cell);
      if (!key) return;
      Object.entries(FIELDS).forEach(([field, names]) => {
        if (taken.has(field)) return;
        if (names.some((name) => clean(name) === key)) {
          found[i] = field;
          taken.add(field);
        }
      });
    });
    return taken.has("customer_no") && taken.has("amount") ? found : null;
  }

  /** "ספט-2026", "09/2026", "2026-09", או מספר תאריך של אקסל. */
  function readPeriod(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && value > 20000 && value < 90000) {
      // מספר סידורי של אקסל: ימים מאז 30/12/1899.
      const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
    }
    const text = String(value).trim();
    const short = Fmt.SHORT.findIndex((name) => text.startsWith(name));
    const long = Fmt.MONTHS.findIndex((name) => text.startsWith(name));
    const named = long >= 0 ? long : short;
    const numbers = (text.match(/\d+/g) || []).map(Number);
    if (named >= 0) {
      const year = numbers.find((n) => n > 1900);
      return year ? { year, month: named + 1 } : null;
    }
    if (numbers.length >= 2) {
      const [a, b] = numbers;
      if (a > 1900) return { year: a, month: b };
      if (b > 1900) return { year: b, month: a };
      if (b > 12 && b < 100) return { year: 2000 + b, month: a };
    }
    return null;
  }

  /** טקסט שהודבק → מערך שורות של תאים. */
  function grid(text) {
    return String(text).split(/\r?\n/)
      .map((line) => line.replace(/\s+$/, ""))
      .filter((line) => line.trim())
      .map((line) => (line.includes("\t") ? line.split("\t")
        : line.split(/\s*[;|]\s*|,(?=\s*(?:\d|"))/))
        .map((cell) => cell.replace(/^"|"$/g, "").trim()));
  }

  /**
   * ממיר רשת תאים לשורות מכירה.
   * `fallback` הוא החודש שנבחר במסך, לשימוש כשאין עמודת חודש בטבלה.
   */
  function rowsFrom(cells, fallback) {
    let header = null;
    const rows = [];
    const problems = [];

    cells.forEach((line) => {
      if (!header) {
        header = headerOf(line);
        if (header) return;
      }
      if (header) {
        const row = {};
        Object.entries(header).forEach(([i, field]) => { row[field] = line[i]; });
        const amount = Math.round(Fmt.parseAmount(row.amount) * 100) / 100;
        const period = readPeriod(row.period) || fallback;
        const customer = String(row.customer_no || "").trim();
        if (!customer || !period) {
          problems.push({ line: line.join(" · "), why: !customer ? "אין מספר לקוח"
            : "אין חודש" });
          return;
        }
        rows.push({
          c: customer,
          p: String(row.payer_no || customer).trim(),
          name: cleanName(row.customer_name),
          payerName: cleanName(row.payer_name),
          agent: String(row.agent_no || "").trim(),
          agentName: cleanName(row.agent_name),
          cur: currencyOf(row.currency),
          y: period.year, m: period.month, a: amount,
        });
        return;
      }
      // בלי כותרות: שתי עמודות — לקוח (מספר או שם) וסכום.
      const amountText = line[line.length - 1];
      const label = line.slice(0, -1).join(" ").trim() || line[0];
      const amount = Math.round(Fmt.parseAmount(amountText) * 100) / 100;
      const digits = (label.match(/\d[\d-]{5,}/) || [])[0];
      const party = digits ? Store.party(digits) : matchByName(label);
      if (!amount || (!party && !digits)) {
        problems.push({ line: line.join(" · "),
                        why: !amount ? "אין סכום" : "לא זוהה לקוח" });
        return;
      }
      if (!fallback) {
        problems.push({ line: line.join(" · "), why: "אין חודש" });
        return;
      }
      const no = party ? party.no : digits;
      rows.push({ c: no, p: no, name: party ? party.name : label.replace(digits, "").trim(),
                  payerName: "", agent: "", agentName: "", cur: "",
                  y: fallback.year, m: fallback.month, a: amount });
    });

    return { rows, problems };
  }

  const normal = (text) => String(text).replace(/["'`״׳()\-]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();

  function matchByName(label) {
    const key = normal(label);
    if (!key) return null;
    const hits = Store.parties().filter((p) => normal(p.name) === key);
    return hits.length === 1 ? hits[0] : null;
  }

  /**
   * מה יקרה אם נאשר: אילו חודשים יוחלפו, מה ייכנס, ומי ייפתח.
   *
   * חודש שמגיע בקובץ מחליף את החודש במלואו — זו המשמעות של ייצוא מחדש של
   * חודש, ואחרת שורות ישנות היו נשארות מתחת לחדשות.
   */
  function plan(rows, problems) {
    const byMonth = new Map();
    rows.forEach((row) => {
      const id = `${row.y}|${row.m}`;
      if (!byMonth.has(id)) byMonth.set(id, { year: row.y, month: row.m, rows: [] });
      byMonth.get(id).rows.push(row);
    });

    const months = [...byMonth.values()].sort((a, b) => a.year - b.year || a.month - b.month)
      .map((entry) => {
        const current = Store.sales().filter((s) => s.y === entry.year && s.m === entry.month);

        /* מה ישתנה בפועל, לקוח אחר לקוח.
           סכום החודש לבדו אינו מספיק כדי לאשר החלפה: הוא יכול להיות זהה
           כמעט לגמרי ובכל זאת להזיז עשרות אלפים בין שני לקוחות. מי שמאשר
           צריך לראות את השורות שזזות, לא רק את הסך. */
        const now = new Map();
        const was = new Map();
        const names = new Map();
        entry.rows.forEach((r) => {
          now.set(r.c, Math.round(((now.get(r.c) || 0) + r.a) * 100) / 100);
          if (r.name) names.set(r.c, r.name);
        });
        current.forEach((s) => {
          was.set(s.c, Math.round(((was.get(s.c) || 0) + s.a) * 100) / 100);
        });
        const changes = [...new Set([...now.keys(), ...was.keys()])]
          .map((no) => {
            const before = was.get(no) || 0;
            const after = now.get(no) || 0;
            return { no, before, after, delta: Math.round((after - before) * 100) / 100,
                     name: (Store.party(no) || {}).name || names.get(no) || no,
                     gone: !now.has(no), fresh: !was.has(no) };
          })
          .filter((c) => Math.abs(c.delta) > 0.005)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

        return {
          ...entry,
          total: Metrics.sum(entry.rows.map((r) => r.a)),
          currentTotal: Metrics.sum(current.map((s) => s.a)),
          currentRows: current.length,
          customers: new Set(entry.rows.map((r) => r.c)).size,
          changes,
        };
      });

    const parties = new Map();
    const agents = new Map();
    rows.forEach((row) => {
      if (!Store.party(row.c) && !parties.has(row.c)) {
        parties.set(row.c, { no: row.c, name: row.name || row.c });
      }
      if (row.p && !Store.party(row.p) && !parties.has(row.p)) {
        parties.set(row.p, { no: row.p, name: row.payerName || row.p });
      }
      if (row.agent && !Store.state.agents.some((a) => a.no === row.agent)
        && !agents.has(row.agent)) {
        agents.set(row.agent, { no: row.agent, name: row.agentName || row.agent });
      }
    });

    return {
      months,
      parties: [...parties.values()],
      agents: [...agents.values()],
      problems: problems || [],
      rowCount: rows.length,
      total: Metrics.sum(rows.map((r) => r.a)),
    };
  }

  /** טקסט שהודבק → תוכנית מוכנה לאישור. */
  function fromText(text, fallback) {
    const { rows, problems } = rowsFrom(grid(text), fallback);
    return plan(rows, problems);
  }

  /* ------------------------------------------------------ קריאת xlsx מקומית
     קובץ xlsx הוא ארכיון zip של קבצי XML. הדפדפן יודע לפרוס deflate בעצמו
     (DecompressionStream), ולכן אין כאן תלות בספרייה חיצונית: הלקוח גורר את
     הייצוא מה-ERP וזה עובד גם כשאין רשת, וגם כשה-CDN חסום ברשת של החברה.
     אם הדפדפן ישן מדי, נופלים בחזרה לספריית xlsx. */

  /** שולף מתוך ה-zip את הקבצים המבוקשים כטקסט. */
  async function unzip(buffer, wanted) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // סוף הארכיון: חותמת ה-EOCD, שמצביעה על ספריית הקבצים המרכזית.
    let eocd = -1;
    for (let i = view.byteLength - 22; i >= 0 && i > view.byteLength - 65558; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("הקובץ אינו xlsx תקין");
    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);
    const out = {};
    const decoder = new TextDecoder("utf-8");

    for (let i = 0; i < count; i += 1) {
      if (view.getUint32(at, true) !== 0x02014b50) break;
      const method = view.getUint16(at + 10, true);
      const compressed = view.getUint32(at + 20, true);
      const nameLen = view.getUint16(at + 28, true);
      const extraLen = view.getUint16(at + 30, true);
      const commentLen = view.getUint16(at + 32, true);
      const header = view.getUint32(at + 42, true);
      const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
      at += 46 + nameLen + extraLen + commentLen;
      if (!wanted(name)) continue;
      // הכותרת המקומית מחזיקה את אורכיה שלה, ורק אחריה מתחיל התוכן.
      const localName = view.getUint16(header + 26, true);
      const localExtra = view.getUint16(header + 28, true);
      const start = header + 30 + localName + localExtra;
      const raw = bytes.subarray(start, start + compressed);
      if (method === 0) {
        out[name] = decoder.decode(raw);
      } else {
        const stream = new Blob([raw]).stream()
          .pipeThrough(new DecompressionStream("deflate-raw"));
        out[name] = await new Response(stream).text();
      }
    }
    return out;
  }

  const TEXT = /<t[ >][^>]*>([\s\S]*?)<\/t>|<t\/>|<t>([\s\S]*?)<\/t>/g;

  const unescapeXml = (text) => text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

  /** xlsx → רשת תאים, בלי ספריות. */
  async function cellsFromXlsx(buffer) {
    const files = await unzip(buffer, (name) => (
      name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d*\.xml$/.test(name)));

    // חלק מהייצואים כותבים את ה-XML עם קידומת מרחב שמות (<x:row>) וחלק בלעדיה.
    // הסרת הקידומת משאירה קריאה אחת לשתי הצורות.
    const plain = (xml) => String(xml).replace(/<(\/?)[A-Za-z0-9]+:/g, "<$1");

    const shared = [];
    const strings = files["xl/sharedStrings.xml"] && plain(files["xl/sharedStrings.xml"]);
    if (strings) {
      strings.split("<si>").slice(1).forEach((item) => {
        let text = "";
        let match;
        TEXT.lastIndex = 0;
        while ((match = TEXT.exec(item)) !== null) text += match[1] || match[2] || "";
        shared.push(unescapeXml(text));
      });
    }

    const column = (ref) => {
      let index = 0;
      for (const ch of String(ref).replace(/\d/g, "")) index = index * 26 + (ch.charCodeAt(0) - 64);
      return index - 1;
    };

    const rows = [];
    Object.keys(files).filter((name) => name !== "xl/sharedStrings.xml").sort()
      .forEach((name) => {
        plain(files[name]).split(/<row[ >]/).slice(1).forEach((line) => {
          const cells = [];
          let max = -1;
          line.split(/<c[ >]/).slice(1).forEach((cell) => {
            const ref = (cell.match(/r="([A-Z]+\d+)"/) || [])[1];
            const type = (cell.match(/t="([^"]+)"/) || [])[1];
            const inline = cell.match(/<is>([\s\S]*?)<\/is>/);
            const value = cell.match(/<v>([\s\S]*?)<\/v>/);
            let text = "";
            if (inline) {
              let match;
              TEXT.lastIndex = 0;
              while ((match = TEXT.exec(inline[1])) !== null) text += match[1] || match[2] || "";
              text = unescapeXml(text);
            } else if (value) {
              text = type === "s" ? (shared[Number(value[1])] || "") : unescapeXml(value[1]);
            }
            const i = ref ? column(ref) : max + 1;
            cells[i] = text;
            if (i > max) max = i;
          });
          if (max >= 0) {
            for (let i = 0; i <= max; i += 1) if (cells[i] === undefined) cells[i] = "";
            rows.push(cells);
          }
        });
      });
    return rows;
  }

  /** נפילה לאחור לספריית xlsx, לדפדפן שאינו יודע לפרוס zip בעצמו. */
  async function cellsFromLibrary(buffer) {
    const XLSX = await Store.loadScript(window.APP_CONFIG.xlsxCdn).then(() => window.XLSX);
    const book = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const cells = [];
    book.SheetNames.forEach((name) => {
      XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, blankrows: false, raw: true })
        .forEach((line) => cells.push(line.map((cell) => (cell === undefined ? "" : cell))));
    });
    return cells;
  }

  /** קובץ שנגרר פנימה → תוכנית. */
  async function fromFile(file, fallback) {
    if (/\.(csv|txt|tsv)$/i.test(file.name)) return fromText(await file.text(), fallback);
    const buffer = await file.arrayBuffer();
    let cells;
    try {
      if (typeof DecompressionStream !== "function") throw new Error("אין פריסת zip");
      cells = await cellsFromXlsx(buffer);
    } catch (err) {
      cells = await cellsFromLibrary(buffer);
    }
    const { rows, problems } = rowsFrom(cells, fallback);
    return plan(rows, problems);
  }

  /** מאשר את התוכנית: לקוחות, סוכנים, והחלפת החודשים — בפעולת ביטול אחת. */
  function apply(planned, label) {
    Store.applyImport({
      parties: planned.parties,
      agents: planned.agents,
      months: planned.months.map((m) => ({ year: m.year, month: m.month, rows: m.rows })),
    }, label);
  }

  return { fromText, fromFile, apply, readPeriod, plan, cellsFromXlsx };
})();
