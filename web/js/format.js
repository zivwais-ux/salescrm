/* ============================================================================
   פורמטים. שני כללים שקובעים איך המספרים נראים בכל המערכת:
     • סכומים נכתבים כמספר ואחריו ₪, בלי סימני כיוון של Intl — הם מייצרים
       "‏11,228,824 ‏₪" עם תווים נסתרים שנראים שבורים בתוך טבלה.
     • כל מספר מיושר לשמאל ובספרות טבלאיות, כדי שעמודות יתיישרו לפי הספרה.
   ========================================================================== */
window.Fmt = (function () {
  const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
                  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const SHORT = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ",
                 "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];

  const whole = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
  const exact = new Intl.NumberFormat("he-IL", { minimumFractionDigits: 2,
                                                 maximumFractionDigits: 2 });

  return {
    MONTHS, SHORT,
    month: (m) => MONTHS[m - 1] || "",
    monthShort: (m) => SHORT[m - 1] || "",

    money: (v) => `${whole.format(Math.round(v || 0))} ₪`,
    moneyExact: (v) => `${exact.format(v || 0)} ₪`,
    number: (v) => whole.format(v || 0),

    /** סכום מקוצר לכרטיסים ולצירי גרפים: 1.2 מ׳ / 340 א׳ */
    short(v) {
      const n = Math.abs(v || 0);
      if (n >= 1e6) return `${(v / 1e6).toFixed(n >= 1e7 ? 0 : 1)} מ׳`;
      if (n >= 1e4) return `${Math.round(v / 1e3)} א׳`;
      if (n >= 1e3) return `${(v / 1e3).toFixed(1)} א׳`;
      return String(Math.round(v || 0));
    },
    shortMoney(v) { return `${this.short(v)} ₪`; },

    /** סכום עם סימן מפורש — לשימוש בהפרשים */
    signed(v) { return `${v >= 0 ? "+" : "−"}${whole.format(Math.abs(Math.round(v || 0)))} ₪`; },

    percent(v, digits = 0) {
      if (v === null || v === undefined || !isFinite(v)) return "—";
      return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
    },

    date(iso) {
      if (!iso) return "";
      return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
    },
    dateLong(iso) {
      if (!iso) return "";
      return new Date(iso).toLocaleDateString("he-IL",
        { day: "numeric", month: "long", year: "numeric" });
    },

    /** מנקה קלט מספרי: "1,234.5 ₪" → 1234.5 */
    parseNumber(raw) {
      if (typeof raw === "number") return raw;
      const value = parseFloat(String(raw ?? "").replace(/[^\d.\-]/g, ""));
      return isFinite(value) ? value : 0;
    },

    /**
     * סכום שאפשר להקליד כחשבון: "1200+840", "3*1250", "9600-120".
     *
     * כך נראית הזנה אמיתית של חודש — כמה חשבוניות לאותו לקוח, או כמות כפול
     * מחיר — ובלי זה צריך מחשבון בצד. החישוב נעשה על מספרים שחולצו מהטקסט
     * בלבד, בלי להריץ את מה שהוקלד כקוד.
     */
    parseAmount(raw) {
      if (typeof raw === "number") return raw;
      const text = String(raw ?? "").replace(/[,\s₪]/g, "");
      if (!text) return 0;
      if (!/[+\-*/]/.test(text.slice(1))) return this.parseNumber(text);
      const tokens = text.match(/\d*\.?\d+|[+\-*/]/g);
      if (!tokens || !/^\d*\.?\d+$/.test(tokens[0])) return this.parseNumber(text);
      // כפל וחילוק נפתרים תחילה, ואחר כך חיבור וחיסור משמאל לימין.
      const flat = [Number(tokens[0])];
      for (let i = 1; i < tokens.length; i += 2) {
        const op = tokens[i];
        const value = Number(tokens[i + 1]);
        if (!isFinite(value)) return this.parseNumber(text);
        if (op === "*") flat[flat.length - 1] *= value;
        else if (op === "/") flat[flat.length - 1] = value ? flat[flat.length - 1] / value : 0;
        else flat.push(op === "-" ? -value : value);
      }
      const total = flat.reduce((a, b) => a + b, 0);
      return isFinite(total) ? Math.round(total * 100) / 100 : 0;
    },

    escape(text) {
      return String(text ?? "").replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      ));
    },
  };
})();
