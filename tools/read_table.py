#!/usr/bin/env python3
"""
Read a table out of an ERP export — .xlsx or .csv — into plain rows.

The ERP prints the same table it puts in the PDF, one row per
(agent, ship-to customer, paying customer, currency, month), so a monthly
export is a complete replacement for that month. The columns are matched by
their Hebrew headers rather than by position, because the export's column
order is not promised.

Written against the file format itself (zip + XML) rather than a spreadsheet
library: the styles openpyxl chokes on are irrelevant to the values.
"""
import csv
import re
import zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

FIELDS = {
    "agent_no": ["מס' סוכן", "מס סוכן", "מספר סוכן", "קוד סוכן"],
    "agent_name": ["שם סוכן"],
    "customer_no": ["מס. לקוח", "מס' לקוח", "מס לקוח", "מספר לקוח", "קוד לקוח"],
    "customer_name": ["שם לקוח"],
    "payer_no": ["לקוח משלם", "מס משלם", "מספר משלם", "קוד משלם"],
    "payer_name": ["שם לקוח משלם", "שם משלם"],
    "currency": ["מטבע"],
    "period": ["חודש ושנה", "חודש", "תקופה", "תאריך"],
    "amount": ["מחיר כולל", "סכום", "מחזור", "סה\"כ", "סהכ"],
}

MONTHS = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"]


def clean(text):
    return re.sub(r"[\s\"'`״׳.]+", "", str(text or "")).strip()


def match_header(cells):
    """Map column index -> field name, from a header row. None when it is not one."""
    found = {}
    for i, cell in enumerate(cells):
        key = clean(cell)
        if not key:
            continue
        for field, names in FIELDS.items():
            if field in found.values():
                continue
            if any(key == clean(name) for name in names):
                found[i] = field
                break
    # לפחות לקוח וסכום — אחרת זו אינה שורת כותרות אלא שורת נתונים.
    return found if {"customer_no", "amount"} <= set(found.values()) else None


def read_period(value):
    """'ספט-2026', '09/2026', '2026-09' → (2026, 9)."""
    text = str(value or "").strip()
    for i, name in enumerate(MONTHS):
        if text.startswith(name):
            year = re.search(r"(\d{4})", text)
            if year:
                return int(year.group(1)), i + 1
    numbers = [int(n) for n in re.findall(r"\d+", text)]
    if len(numbers) >= 2:
        a, b = numbers[0], numbers[1]
        if a > 1900:
            return a, b
        if b > 1900:
            return b, a
        if b > 100:
            return 2000 + b if b < 100 else b, a
    return None


def read_xlsx(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for item in tree.findall(NS + "si"):
            shared.append("".join(t.text or "" for t in item.iter(NS + "t")))
    names = [n for n in z.namelist() if n.startswith("xl/worksheets/sheet")]
    rows = []
    for name in sorted(names):
        sheet = ET.fromstring(z.read(name))
        for row in sheet.iter(NS + "row"):
            cells = {}
            for cell in row.findall(NS + "c"):
                column = re.sub(r"\d", "", cell.get("r") or "")
                index = 0
                for ch in column:
                    index = index * 26 + (ord(ch) - 64)
                inline = cell.find(NS + "is")
                value = cell.find(NS + "v")
                if inline is not None:
                    text = "".join(t.text or "" for t in inline.iter(NS + "t"))
                elif value is None:
                    text = ""
                elif cell.get("t") == "s":
                    text = shared[int(value.text)] if value.text else ""
                else:
                    text = value.text or ""
                cells[index - 1] = text
            if cells:
                rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return [row for row in csv.reader(fh) if any(cell.strip() for cell in row)]


def read(path):
    """The export's rows as dicts, one per sale line."""
    grid = read_xlsx(path) if path.lower().endswith((".xlsx", ".xlsm")) else read_csv(path)
    header = None
    out = []
    for cells in grid:
        if header is None:
            header = match_header(cells)
            if header:
                continue
            raise SystemExit(f"{path}: לא נמצאה שורת כותרות עם 'מס. לקוח' ו'מחיר כולל'")
        row = {field: str(cells[i]).strip() if i < len(cells) else ""
               for i, field in header.items()}
        if not row.get("customer_no") or not row.get("amount"):
            continue
        period = read_period(row.get("period"))
        if not period:
            continue
        row["year"], row["month"] = period
        row["amount"] = float(str(row["amount"]).replace(",", ""))
        out.append(row)
    return out


if __name__ == "__main__":
    import sys
    rows = read(sys.argv[1])
    months = sorted({(r["year"], r["month"]) for r in rows})
    print(f"{len(rows)} שורות · {months} · סה\"כ {sum(r['amount'] for r in rows):,.2f}")
