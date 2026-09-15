/* פורמטים והצגה */
window.Fmt = (function () {
  const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
                  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const SHORT = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ",
                 "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];

  const money = new Intl.NumberFormat("he-IL", {
    style: "currency", currency: "ILS", maximumFractionDigits: 0,
  });
  const moneyExact = new Intl.NumberFormat("he-IL", {
    style: "currency", currency: "ILS", minimumFractionDigits: 2,
  });
  const plain = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });

  return {
    MONTHS, SHORT,
    month: (m) => MONTHS[m - 1] || "",
    monthShort: (m) => SHORT[m - 1] || "",
    money: (v) => money.format(v || 0),
    moneyExact: (v) => moneyExact.format(v || 0),
    number: (v) => plain.format(v || 0),
    /** מספר מקוצר לכרטיסי נתונים: 1.2 מ׳ / 340 א׳ */
    short(v) {
      const n = Math.abs(v || 0);
      if (n >= 1e6) return `${(v / 1e6).toFixed(n >= 1e7 ? 0 : 1)} מ׳ ₪`;
      if (n >= 1e3) return `${Math.round(v / 1e3)} א׳ ₪`;
      return `${Math.round(v || 0)} ₪`;
    },
    percent(v, digits = 0) {
      if (v === null || v === undefined || !isFinite(v)) return "—";
      return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
    },
    date: (iso) => (iso ? new Date(iso).toLocaleDateString("he-IL") : ""),
    /** מנקה קלט מספרי בעברית/אנגלית: "1,234.5 ₪" -> 1234.5 */
    parseNumber(raw) {
      if (typeof raw === "number") return raw;
      const cleaned = String(raw ?? "").replace(/[^\d.\-]/g, "");
      const value = parseFloat(cleaned);
      return isFinite(value) ? value : 0;
    },
    escape(text) {
      return String(text ?? "").replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      ));
    },
  };
})();
