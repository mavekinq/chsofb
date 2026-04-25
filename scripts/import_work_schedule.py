from __future__ import annotations

import argparse
import json
import re
from datetime import date, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


XML_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
DATE_COLUMNS = ["C", "D", "E", "F", "G", "H", "I"]


def excel_date_to_iso(serial: str) -> str:
    base = date(1899, 12, 30)
    return (base + timedelta(days=int(float(serial)))).isoformat()


def parse_team(raw_value: str) -> tuple[str, str]:
    raw_value = (raw_value or "").strip()
    match = re.match(r"^Group:\s*(.*?)\s*--\s*Team:\s*(.*)$", raw_value)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return "", raw_value


def load_shared_strings(zip_file: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zip_file.namelist():
        return []

    root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    values: list[str] = []
    for shared_item in root:
        text = "".join(
            node.text or ""
            for node in shared_item.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
        )
        values.append(text)
    return values


def read_rows(source_path: Path) -> list[dict[str, str]]:
    with ZipFile(source_path) as zip_file:
        workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
        relationships = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
        relationship_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in relationships}

        first_sheet = workbook.find("a:sheets", XML_NS)[0]
        relation_id = first_sheet.attrib[
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        ]
        worksheet_path = "xl/" + relationship_map[relation_id].lstrip("/")

        shared_strings = load_shared_strings(zip_file)
        worksheet = ET.fromstring(zip_file.read(worksheet_path))
        rows: list[dict[str, str]] = []

        for row in worksheet.find("a:sheetData", XML_NS):
            row_data: dict[str, str] = {}
            for cell in row:
                reference = cell.attrib.get("r", "")
                column = "".join(ch for ch in reference if ch.isalpha())
                value = cell.find("a:v", XML_NS)
                if value is None:
                    row_data[column] = ""
                    continue

                text = value.text or ""
                if cell.attrib.get("t") == "s":
                    text = shared_strings[int(text)]
                row_data[column] = text.strip()
            rows.append(row_data)

        return rows


def build_payload(rows: list[dict[str, str]]) -> dict[str, object]:
    if not rows:
        raise ValueError("Excel dosyasi bos veya okunamadi")

    header = rows[0]
    title = header.get("A", "").strip()
    date_columns = [column for column in DATE_COLUMNS if header.get(column)]
    week_dates = [excel_date_to_iso(header[column]) for column in date_columns]

    employees = []
    for row in rows[1:]:
        name = (row.get("A") or "").strip()
        raw_team = (row.get("B") or "").strip()
        if not name or not raw_team:
            continue

        group, team = parse_team(raw_team)
        shifts = {
            week_dates[index]: (row.get(column) or "").strip()
            for index, column in enumerate(date_columns)
        }
        employees.append(
            {
                "name": name,
                "group": group,
                "team": team,
                "rawTeam": raw_team,
                "shifts": shifts,
            }
        )

    return {
        "title": title,
        "weekDates": week_dates,
        "employees": employees,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Excel calisma programini JSON dosyasina cevirir")
    parser.add_argument("source", help="Kaynak .xlsx dosya yolu")
    parser.add_argument(
        "--output",
        default="src/data/workSchedule.json",
        help="Hedef JSON yolu. Varsayilan: src/data/workSchedule.json",
    )
    args = parser.parse_args()

    source_path = Path(args.source)
    output_path = Path(args.output)

    if not source_path.exists():
        raise FileNotFoundError(f"Kaynak dosya bulunamadi: {source_path}")

    rows = read_rows(source_path)
    payload = build_payload(rows)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    print(f"Kaynak: {source_path}")
    print(f"Hedef: {output_path}")
    print(f"Baslik: {payload['title']}")
    print(f"Hafta: {' - '.join(payload['weekDates'])}")
    print(f"Personel: {len(payload['employees'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())