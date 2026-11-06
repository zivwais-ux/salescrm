#!/usr/bin/env python3
"""
בדיקת שלמות הזרע — בלי דפדפן, בלי תלויות.

הקובץ ``web/data/dataset.json`` הוא מקור האמת של חמש שנות המכירות, והוא
נבנה פעם אחת מדוחות ה-ERP ואומת לאגורה מול סיכומי הבקרה שהודפסו בהם.
הבדיקה כאן שואלת שאלה אחת: האם הוא עדיין מסכים עם עצמו.

    python3 tools/check_dataset.py

יוצא בקוד 1 אם לא, כדי שה-CI ייעצר.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "web", "data", "dataset.json")
JS_PATH = os.path.join(ROOT, "web", "data", "dataset.js")

AGORA = 0.005  # הסכומים נשמרים בשתי ספרות; פער קטן מאגורה הוא ייצוג, לא נתון


def money(value):
    return f"{value:,.2f}"


def main():
    problems = []
    notes = []

    with open(JSON_PATH, encoding="utf-8") as fh:
        data = json.load(fh)

    # --- dataset.js ו-dataset.json נבנים יחד וחייבים להחזיק אותו תוכן ---
    with open(JS_PATH, encoding="utf-8") as fh:
        js = fh.read()
    match = re.search(r"window\.GADOT_DATASET\s*=\s*(\{.*\});?\s*$", js, re.S)
    if not match:
        problems.append("dataset.js אינו במבנה הצפוי")
    else:
        try:
            if json.loads(match.group(1).rstrip().rstrip(";")) != data:
                problems.append("dataset.js ו-dataset.json אינם זהים — הזרע נבנה חלקית")
            else:
                notes.append("dataset.js זהה ל-dataset.json")
        except json.JSONDecodeError as err:
            problems.append(f"dataset.js אינו JSON תקין: {err}")

    agents = data["agents"]
    parties = data["parties"]
    sales = data["sales"]

    # --- כל שורה מצביעה על לקוח וסוכן שקיימים, והסכום הוא מספר ---
    bad_refs = 0
    for row in sales:
        c, p, a = row[0], row[1], row[2]
        if not (0 <= c < len(parties) and 0 <= p < len(parties) and 0 <= a < len(agents)):
            bad_refs += 1
        if not isinstance(row[5], (int, float)):
            bad_refs += 1
    if bad_refs:
        problems.append(f"{bad_refs} שורות מצביעות על לקוח/סוכן שאינו קיים, או שסכומן אינו מספר")
    else:
        notes.append(f"{len(sales):,} שורות · {len(parties)} לקוחות · {len(agents)} סוכנים")

    # --- אותו מפתח זהות פעמיים הוא שורה שדורסת שורה ---
    seen = set()
    duplicates = 0
    for row in sales:
        key = (row[0], row[1], row[2], row[3], row[4], row[6] if len(row) > 6 else "")
        if key in seen:
            duplicates += 1
        seen.add(key)
    if duplicates:
        problems.append(f"{duplicates} שורות חוזרות על אותו מפתח זהות")

    # --- הסיכומים: שנה מול שורת הבקרה, וחודש מול חודש ---
    for year in sorted(data["years"]):
        rows = [r for r in sales if r[3] == year]
        total = round(sum(r[5] for r in rows), 2)
        control = data.get("control", {}).get(str(year))
        if not control:
            notes.append(f"{year}: {money(total)} (אין שורת בקרה)")
            continue

        if abs(total - control["total"]) > AGORA:
            problems.append(
                f"{year}: הסכום במאגר {money(total)} מול {money(control['total'])} בבקרה")
        else:
            notes.append(f"{year}: {money(total)} ✓")

        for month, printed in sorted(control.get("months", {}).items(), key=lambda x: int(x[0])):
            actual = round(sum(r[5] for r in rows if r[4] == int(month)), 2)
            if abs(actual - printed) > AGORA:
                problems.append(
                    f"{year}/{month}: {money(actual)} מול {money(printed)} בבקרה")

    # --- החודש האחרון שנסגר אינו יכול להקדים את הנתונים שיש ---
    for year, closed in data.get("last_closed_month", {}).items():
        months = [r[4] for r in sales if r[3] == int(year)]
        if months and max(months) > closed:
            problems.append(
                f"{year}: יש נתונים עד חודש {max(months)} אבל הזרע מצהיר על {closed}")

    print("\nבדיקת הזרע\n")
    for note in notes:
        print(f"    {note}")
    for problem in problems:
        print(f"    ✗ {problem}")
    print("")

    if problems:
        print(f"נכשל: {len(problems)} ממצאים\n")
        return 1
    print("הזרע מסכים עם עצמו\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
