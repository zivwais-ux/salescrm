#!/usr/bin/env python3
"""
Parse the GADOT "ניתוח מכירות (ת.משלוח) - מחירים" PDF report into structured JSON.

The report is an RTL table: one row per (ship-to customer, paying customer) pair,
with one "מחיר כולל" column per month plus a total column. Plain text extraction
scrambles the columns, so rows and columns are rebuilt from word coordinates:

  * column x-ranges come from the header band, so a 12-month and a 9-month report
    both parse without hardcoded offsets;
  * every data row prints the currency (ש"ח), which makes it the row anchor;
  * the ship-to customer is printed once per group and blank on continuation rows,
    so it is filled forward.
"""
import json
import re
import sys

import pymupdf

NUM_RE = re.compile(r"^-?[\d,]+\.\d{2}$")
# A customer number may carry a sub-account suffix, e.g. "202270313-1".
ID_RE = re.compile(r"^\d[\d-]*$")
# Lines that belong to the report furniture rather than to a data row.
NOISE_TOKENS = {"מחיר", "כולל", "מטבע", "סה", "כללי", "GADOT"}
WORD_GAP = 0.8      # points; gaps inside a word measure ~0, between words >= 1.3
LTR_CHARS = re.compile(r"[0-9A-Za-z]")
REVERSED_BRACKETS = re.compile(r"\)([^()]{1,40})\(")
FIELDS = ["agent_no", "agent_name", "customer_no", "customer_name", "payer_no", "payer_name"]


def cluster(values, gap=4.0):
    """Group (x0, x1) spans into columns separated by at least `gap` points."""
    cols = []
    for x0, x1 in sorted(values):
        if cols and x0 - cols[-1][1] <= gap:
            cols[-1][1] = max(cols[-1][1], x1)
        else:
            cols.append([x0, x1])
    return cols


def layout(page):
    """Return (month_columns, text_columns) as x-ranges keyed by field/month."""
    words = page.get_text("words")
    # "מחיר כולל" repeats once per value column and marks the header band; the page
    # titles sit above it and the first data row can start just below it.
    head_y = min(w[1] for w in words if w[4] == "מחיר")
    head = [w for w in words if abs(w[1] - head_y) <= 8]
    layout.head_y = head_y

    # Rightmost value column is the first month, leftmost is the total (סה"כ).
    value_cells = cluster([(w[0], w[2]) for w in head if w[4] in ("מחיר", "כולל")], gap=4.0)
    value_cells.sort(key=lambda c: -c[0])
    months = {i + 1: c for i, c in enumerate(value_cells[:-1])}
    months[0] = value_cells[-1]

    currency = next(w for w in head if w[4] == "מטבע")
    text = dict(zip(FIELDS, header_columns([w for w in head if w[0] > currency[2] - 1])))
    text["currency"] = [currency[0], currency[2]]

    return months, text


def header_columns(head):
    """The six text columns, from the header labels rather than from gaps alone.

    Read right to left the labels are "מס' סוכן", "שם סוכן", "מס. לקוח",
    "שם לקוח", "לקוח משלם", "שם לקוח משלם", so every column but the payer number
    opens with מס or שם. Clustering on whitespace alone is not enough: in some
    years the agent columns sit 3pt apart and merge, while the payer number
    opens with a word that also appears mid-label. Splitting on those two
    markers first, then on whitespace inside each group, separates both.
    """
    groups, cols = [], []
    for word in sorted(head, key=lambda w: -w[0]):
        if word[4] in ("מס", "שם") or not groups:
            groups.append([])
        groups[-1].append(word)
    for group in groups:
        cols += cluster([(w[0], w[2]) for w in group], gap=4.0)
    cols.sort(key=lambda c: -c[0])
    if len(cols) != len(FIELDS):
        raise SystemExit(f"header has {len(cols)} text columns, expected {len(FIELDS)}")
    return cols


def snap_to_data(columns, doc, head_y):
    """Widen each header column to the x-range its data actually occupies.

    Names are printed wider than their header, so the header alone would clip
    them. The printed columns are separated by clear vertical whitespace, which
    makes the data's own clustering a reliable set of boundaries.
    """
    chars = []
    for page in doc:
        skip = noise_lines(page, head_y)
        chars += [c for c in page_chars(page) if round(c[3], 1) not in skip]
    data_cols = cluster([(c[1], c[2]) for c in chars], gap=3.0)
    for span in columns.values():
        hits = [c for c in data_cols if c[0] < span[1] and c[1] > span[0]]
        if hits:
            span[0], span[1] = min(h[0] for h in hits) - 0.5, max(h[1] for h in hits) + 0.5
    return columns


def in_col(word, span):
    return span[0] <= (word[0] + word[2]) / 2 <= span[1]


def page_chars(page):
    """Every glyph on the page as (char, x0, x1, y), from the raw layout."""
    chars = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                for ch in span["chars"]:
                    x0, y0, x1, _ = ch["bbox"]
                    if ch["c"].strip():
                        chars.append((ch["c"], x0, x1, y0))
    return chars


def rtl_text(chars):
    """Rebuild text laid out for right-to-left display, from its glyphs.

    The report places every glyph itself, with no space glyphs and no bidi
    reordering, so the text is read right-to-left and word breaks come from the
    horizontal gaps. Digits and latin letters keep their own left-to-right run.
    """
    lines = {}
    for ch in chars:
        lines.setdefault(round(ch[3], 0), []).append(ch)
    out = []
    for y in sorted(lines):
        pieces, run, prev = [], [], None
        for ch, x0, x1, _ in sorted(lines[y], key=lambda c: -c[1]):
            gap = prev is not None and prev - x1 > WORD_GAP
            if LTR_CHARS.match(ch):
                if gap and run:
                    pieces.append("".join(reversed(run)))
                    run = []
                    pieces.append(" ")
                run.append(ch)
            else:
                if run:
                    pieces.append("".join(reversed(run)))
                    run = []
                if gap:
                    pieces.append(" ")
                pieces.append(ch)
            prev = x0
        if run:
            pieces.append("".join(reversed(run)))
        line = "".join(pieces).strip()
        # A latin phrase inside the cell still reads left-to-right, so the words
        # of such a line come out in reverse.
        letters = [c for c in line if c.isalpha()]
        if letters and sum(bool(LTR_CHARS.match(c)) for c in letters) / len(letters) > 0.6:
            line = " ".join(reversed(line.split(" ")))
        out.append(line)
    text = re.sub(r"\s+", " ", " ".join(out)).strip()
    # A bracketed insert comes out with its brackets in reading order, i.e. ")x(".
    return REVERSED_BRACKETS.sub(r"(\1)", text)


def clean_name(text):
    """Strip the branch marker the report appends to every name.

    It is printed as ``ב-``, ``-ב`` or ``(ב)`` depending on the row, always as a
    standalone letter at one end of the name.
    """
    text = text.strip()
    # The marker stands on its own, so it is only stripped when a space, a hyphen
    # or a bracket separates it: names like "תמי יהב" end in the same letter.
    text = re.sub(r"(?:(?<=\s)|(?<=-)|^)\(?\s*ב\s*\)?\s*$", "", text)
    text = re.sub(r"^\s*(?:\(\s*ב\s*\)|ב\s*-)\s*", "", text)
    text = re.sub(r"\s*\(\s*\)\s*", " ", text)
    # On a latin name the marker ends up mid-string, since that line reads
    # left-to-right while the marker was printed at its right edge.
    text = re.sub(r"\s(?:-ב|ב-)\s", " ", text)
    # The report packs glyphs tightly where the script changes; restore the space.
    text = re.sub(r"(?<=[\u05d0-\u05ea])(?=[0-9A-Za-z(])", " ", text)
    text = re.sub(r"(?<=[0-9A-Za-z)])(?=[\u05d0-\u05ea])", " ", text)
    return re.sub(r"\s+", " ", text).strip(" -")


def noise_lines(page, head_y):
    """y of every line that is page furniture: titles, header, subtotals."""
    lines = {}
    for w in page.get_text("words"):
        lines.setdefault(round(w[1], 1), []).append(w[4])
    # The header itself spans a few points below head_y; on some pages the first
    # data row starts only ~8pt below it, so the cut has to stay tight.
    return {y for y, tokens in lines.items()
            if y <= head_y + 5 or NOISE_TOKENS & set(tokens)}


def data_words(page, head_y):
    """Page words minus the titles, the repeated header and the subtotal lines."""
    skip = noise_lines(page, head_y)
    return [w for w in page.get_text("words") if round(w[1], 1) not in skip]


def parse_page(page, months, text_cols, head_y):
    words = data_words(page, head_y)
    skip = noise_lines(page, head_y)
    chars = [c for c in page_chars(page) if round(c[3], 1) not in skip]
    anchors = sorted({round(w[1], 1) for w in words if in_col(w, text_cols["currency"])})
    rows = []
    for i, y in enumerate(anchors):
        lo = (anchors[i - 1] + y) / 2 if i else y - 11
        hi = (y + anchors[i + 1]) / 2 if i + 1 < len(anchors) else y + 11
        band = [w for w in words if lo < w[1] < hi]
        band_chars = [c for c in chars if lo < c[3] < hi]

        amounts = {}
        for w in band:
            if abs(w[1] - y) > 2.5 or not NUM_RE.match(w[4]):
                continue
            for month, span in months.items():
                if in_col(w, span):
                    amounts[month] = float(w[4].replace(",", ""))

        row = {}
        for field in FIELDS:
            if field.endswith("_no"):
                row[field] = "".join(w[4] for w in band
                                     if in_col(w, text_cols[field]) and ID_RE.match(w[4]))
            else:
                cell = [c for c in band_chars
                        if text_cols[field][0] <= (c[1] + c[2]) / 2 <= text_cols[field][1]]
                row[field] = clean_name(rtl_text(cell))
        cell = [c for c in band_chars
                if text_cols["currency"][0] - 1 <= (c[1] + c[2]) / 2 <= text_cols["currency"][1] + 1]
        row["currency"] = rtl_text(cell).replace(" ", "") or "ש'ח"
        row["reported_total"] = amounts.pop(0, None)
        row["months"] = {str(k): v for k, v in sorted(amounts.items())}
        rows.append(row)
    return rows


def control_totals(doc, months, head_y):
    """The report's own printed summary line ("סה"כ כללי").

    Used as an independent check on the parse: the app compares what it holds
    against these figures, so a drift is visible rather than assumed away.
    """
    for page in doc:
        lines = {}
        for w in page.get_text("words"):
            lines.setdefault(round(w[1], 1), []).append(w)
        for y, tokens in lines.items():
            texts = {w[4] for w in tokens}
            if "סה" not in texts or "כללי" not in texts:
                continue
            found = {}
            for w in tokens:
                if not NUM_RE.match(w[4]):
                    continue
                for month, span in months.items():
                    if in_col(w, span):
                        found[month] = float(w[4].replace(",", ""))
            return {"total": found.get(0),
                    "months": {str(k): v for k, v in sorted(found.items()) if k}}
    return None


def parse(path, year):
    doc = pymupdf.open(path)
    months, text_cols = layout(doc[0])
    snap_to_data({**months, **text_cols}, doc, layout.head_y)
    rows = [r for page in doc for r in parse_page(page, months, text_cols, layout.head_y)]
    parse.control = control_totals(doc, months, layout.head_y)

    # Every one of these is printed once per group and left blank on the rows that
    # continue it: the agent and the ship-to customer across their whole block, and
    # the payer on a second line that bills the same pair in another currency.
    carry = {"agent_no": "", "agent_name": "", "customer_no": "", "customer_name": "",
             "payer_no": "", "payer_name": ""}
    for row in rows:
        for field in carry:
            if row[field]:
                carry[field] = row[field]
            else:
                row[field] = carry[field]
        row["year"] = year
        row["total"] = round(sum(row["months"].values()), 2)
    return [r for r in rows if r["payer_no"]], max(int(m) for m in months if m)


if __name__ == "__main__":
    src, year, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    rows, last_month = parse(src, year)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"year": year, "months": last_month, "rows": rows}, fh,
                  ensure_ascii=False, indent=1)
    print(f"{out}: {len(rows)} rows, {last_month} months, "
          f"total={sum(r['total'] for r in rows):,.2f}")
