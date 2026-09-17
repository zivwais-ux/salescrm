#!/usr/bin/env python3
"""
Turn the parsed PDF reports into the app's seed data.

Usage:  python3 tools/build_dataset.py <pdf-directory> [more directories or files]

Every report carries its own period ("מתאריך 01/01/23 , עד תאריך 31/12/23"), so the
year comes from the document rather than from the file name. A year the app already
holds and that no given PDF covers is carried over from the existing dataset, which
is what lets a single new report be added without the older PDFs at hand.

Writes:
  web/data/dataset.js    - the app's seed (a plain script, so the app also runs
                           straight from the filesystem)
  web/data/dataset.json  - the same payload for any other tooling
"""
import glob
import json
import os
import re
import sys

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from parse_pdf import parse  # noqa: E402

DATA_DIR = os.path.join(ROOT, "web", "data")
PERIOD_RE = re.compile(r"(\d{2})/(\d{2})/(\d{2,4})")
# Raised whenever the seed's contents change, so a browser holding the previous
# seed takes the new one in instead of staying on yesterday's picture.
SEED_VERSION = 3


def report_year(path):
    """The year the report covers, read from its own period line."""
    page = pymupdf.open(path)[0]
    words = page.get_text("words")
    line = {}
    for w in words:
        line.setdefault(round(w[1], 1), []).append(w)
    for y in sorted(line):
        tokens = [w[4] for w in sorted(line[y], key=lambda w: -w[0])]
        if "מתאריך" not in tokens:
            continue
        years = {int(m.group(3)) for t in tokens for m in [PERIOD_RE.match(t)] if m}
        years = {y if y > 100 else 2000 + y for y in years}
        if len(years) == 1:
            return years.pop()
        raise SystemExit(f"{path}: the report spans {sorted(years)}, expected one year")
    raise SystemExit(f"{path}: no period line found")


def sources(args):
    paths = []
    for arg in args:
        paths += sorted(glob.glob(os.path.join(arg, "*.pdf"))) if os.path.isdir(arg) else [arg]
    found = {}
    for path in paths:
        year = report_year(path)
        if year in found:
            raise SystemExit(f"two reports cover {year}: {found[year]} and {path}")
        found[year] = path
    return found


def from_pdfs(found):
    """parties, agents, sales and control totals as parsed from the reports."""
    parties, agents, sales, control, months = {}, {}, [], {}, {}
    for year, path in sorted(found.items()):
        rows, last_month = parse(path, year)
        control[str(year)] = parse.control
        months[str(year)] = last_month
        for row in rows:
            if row["agent_no"] and year >= agents.get(row["agent_no"], (0, ""))[0]:
                agents[row["agent_no"]] = (year, row["agent_name"])
            for no, name in ((row["customer_no"], row["customer_name"]),
                             (row["payer_no"], row["payer_name"])):
                # A party is named as its most recent report spells it: a company
                # renames itself, and the reader itself keeps being corrected.
                if name and year >= parties.get(no, (0, ""))[0]:
                    parties[no] = (year, name)
            for month, amount in row["months"].items():
                if amount:
                    sales.append({"c": row["customer_no"], "p": row["payer_no"],
                                  "y": year, "m": int(month), "a": round(amount, 2),
                                  "agent": row["agent_no"], "cur": row["currency"]})
    return agents, parties, sales, control, months


def from_existing(keep_years):
    """The years the app already holds, decoded back out of the current seed."""
    path = os.path.join(DATA_DIR, "dataset.json")
    if not keep_years or not os.path.exists(path):
        return {}, {}, [], {}, {}
    old = json.load(open(path, encoding="utf-8"))
    agent_no = [a[0] for a in old["agents"]]
    party_no = [p[0] for p in old["parties"]]
    sales = []
    for row in old["sales"]:
        c, p, a, y, m, amount = row[:6]
        if y in keep_years:
            sales.append({"c": party_no[c], "p": party_no[p], "y": y, "m": m,
                          "a": amount, "agent": agent_no[a],
                          "cur": row[6] if len(row) > 6 else "ש'ח"})
    newest = max(keep_years)
    used = {s["c"] for s in sales} | {s["p"] for s in sales}
    parties = {no: (newest, name) for no, name in old["parties"] if no in used}
    agents = {no: (newest, name) for no, name in old["agents"]
              if no in {s["agent"] for s in sales} and no}
    control = {str(y): old["control"][str(y)] for y in keep_years if str(y) in old["control"]}
    months = {str(y): old["last_closed_month"][str(y)] for y in keep_years
              if str(y) in old.get("last_closed_month", {})}
    return agents, parties, sales, control, months


def newest_names(*books):
    """Merge {no: (year, name)} books, keeping the name from the latest report."""
    out = {}
    for book in books:
        for no, (year, name) in book.items():
            if year >= out.get(no, (0, ""))[0]:
                out[no] = (year, name)
    return {no: name for no, (_, name) in out.items()}


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__.strip())
    found = sources(sys.argv[1:])
    agents, parties, sales, control, months = from_pdfs(found)

    existing = json.load(open(os.path.join(DATA_DIR, "dataset.json"), encoding="utf-8")) \
        if os.path.exists(os.path.join(DATA_DIR, "dataset.json")) else {"years": []}
    keep = [y for y in existing.get("years", []) if y not in found]
    old_agents, old_parties, old_sales, old_control, old_months = from_existing(keep)
    agents = newest_names(old_agents, agents)
    parties = newest_names(old_parties, parties)
    sales += old_sales
    control = {**old_control, **control}
    months = {**old_months, **months}

    years = sorted({s["y"] for s in sales})
    # Compact encoding: parties and agents are listed once, and every sale refers
    # to them by index. Cuts the payload the browser downloads by about two
    # thirds compared with one object per sale.
    agent_list = sorted(agents.items())
    party_list = sorted(parties.items())
    agent_at = {no: i for i, (no, _) in enumerate(agent_list)}
    party_at = {no: i for i, (no, _) in enumerate(party_list)}
    # הדוח משאיר מדי פעם שורה בלי מספר סוכן. היא מקבלת מקום ברשימה רק אם יש
    # לה באמת תנועות — רשומה ריקה היא המצאה, ולא נתון.
    if any(not s["agent"] for s in sales):
        agent_at[""] = len(agent_list)
        agent_list.append(("", "ללא שיוך"))

    def encode(s):
        row = [party_at[s["c"]], party_at[s["p"]], agent_at[s["agent"]], s["y"], s["m"], s["a"]]
        # A row the report priced in another currency keeps that currency, which is
        # how the data screen can point at it instead of it passing for shekels.
        return row + [s["cur"]] if s["cur"] not in ("ש'ח", 'ש"ח') else row

    dataset = {
        "generated_from": "GADOT ניתוח מכירות (ת.משלוח) - מחירים",
        "format": "agents/parties: [no, name]; sales: [customerIndex, payerIndex, "
                  "agentIndex, year, month, amount, currency?]",
        "seed_version": SEED_VERSION,
        "agents": [[no, name] for no, name in agent_list],
        "parties": [[no, name] for no, name in party_list],
        "sales": [encode(s) for s in sorted(sales, key=lambda s: (s["y"], s["m"], s["c"]))],
        "years": years,
        # סיכומי הבקרה כפי שהודפסו בדוח עצמו - הבסיס להצלבה במסך הנתונים.
        "control": control,
        "last_closed_month": {str(y): months.get(str(y), max(
            s["m"] for s in sales if s["y"] == y)) for y in years},
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    payload = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA_DIR, "dataset.json"), "w", encoding="utf-8") as fh:
        fh.write(payload)
    with open(os.path.join(DATA_DIR, "dataset.js"), "w", encoding="utf-8") as fh:
        fh.write("// Generated by tools/build_dataset.py - do not edit by hand.\n")
        fh.write("window.GADOT_DATASET = " + payload + ";\n")

    for year in years:
        total = sum(s["a"] for s in sales if s["y"] == year)
        printed = (control.get(str(year)) or {}).get("total")
        mark = "=" if printed and abs(total - printed) < 0.005 else "?"
        source = os.path.basename(found[year]) if year in found else "כבר במאגר"
        print(f"{year}: {total:>16,.2f} {mark} {printed:>16,.2f}   {source}")
    print(f"parties={len(parties)} agents={len(agent_list)} sales={len(sales)}")


if __name__ == "__main__":
    main()
