#!/usr/bin/env python3
"""Build the historical exam coverage map from curated phase resources."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


REPO = Path(__file__).resolve().parents[1]
PHASES_PATH = REPO / "data" / "phases.json"
OUTPUT_PATH = REPO / "data" / "historical-coverage.json"
PART_A_ID = "02_Primera_prueba_A_Practico"
PART_B_ID = "01_Primera_prueba_B_Tema_escrito"
TRENDS_ID = "97_Que_cae_mas"
NEWS_ID = "98_Novedades_y_publicaciones"


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    return " ".join("".join(char for char in text if not unicodedata.combining(char)).lower().split())


def resource_year(resource: dict[str, Any]) -> int | None:
    value = resource.get("publicationYear") or resource.get("year")
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return year if 1980 <= year <= 2100 else None


def process_year(resource: dict[str, Any]) -> int | None:
    text = " ".join(
        str(resource.get(field) or "")
        for field in ("displayTitle", "title", "section")
    )
    match = re.search(r"\b(20\d{2})\b", text)
    return int(match.group(1)) if match else resource_year(resource)


def canonical_resource_key(resource: dict[str, Any]) -> str:
    value = str(resource.get("url") or "")
    if not value:
        return str(resource.get("title") or resource.get("displayTitle") or "")
    parsed = urlparse(value)
    query = urlencode(
        sorted(
            (key, item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
            if key.upper() != "RASTRO"
        ),
        doseq=True,
    )
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, "", query, ""))


def unique_resources(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for resource in resources:
        key = canonical_resource_key(resource)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(resource)
    return result


def descriptive_link_label(resource: dict[str, Any], label: str) -> str:
    text = normalize(f"{resource.get('displayTitle')} {resource.get('title')}")
    if label.startswith("Criterios "):
        part = label.rsplit(" ", 1)[-1]
        if "valoracion" in text:
            return f"Valoración {part}"
        if "actuacion" in text or "normas" in text:
            return f"Actuación {part}"
        if "especific" in text or "requisit" in text:
            return f"Especificaciones {part}"
    if label == "Tribunales":
        tribunal = re.search(r"tribunal\s*0?(\d+)", text)
        suffix = f" T{int(tribunal.group(1)):02d}" if tribunal else ""
        if "seleccionad" in text:
            return "Seleccionados"
        if "publicaciones de tribunales" in text:
            return "Portal tribunales"
        if "valoracion" in text:
            return f"Valoración{suffix}"
        if "actuacion" in text:
            return f"Actuación{suffix}"
    return label


def link_items(resources: list[dict[str, Any]], label: str) -> list[dict[str, str]]:
    return [
        {
            "label": descriptive_link_label(resource, label),
            "title": str(resource.get("displayTitle") or resource.get("title") or label),
            "url": str(resource.get("url")),
        }
        for resource in unique_resources(resources)
        if resource.get("url")
    ]


def build_coverage(phases_data: dict[str, Any]) -> dict[str, Any]:
    phases = {
        phase.get("id"): phase
        for phase in phases_data.get("phases") or []
        if isinstance(phase, dict) and phase.get("id")
    }
    part_a = phases.get(PART_A_ID, {})
    part_b = phases.get(PART_B_ID, {})
    trends = phases.get(TRENDS_ID, {})
    news = phases.get(NEWS_ID, {})

    official_exams: dict[int, list[dict[str, Any]]] = defaultdict(list)
    criteria_a: dict[int, list[dict[str, Any]]] = defaultdict(list)
    criteria_b: dict[int, list[dict[str, Any]]] = defaultdict(list)
    tribunal_docs: dict[int, list[dict[str, Any]]] = defaultdict(list)
    private_materials: dict[int, list[dict[str, Any]]] = defaultdict(list)
    private_solutions: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for source in trends.get("sourceYears") or []:
        year = resource_year(source)
        if year and source.get("sourceKind") == "official-murcia":
            official_exams[year].append(source)

    for resource in part_a.get("resources") or []:
        year = resource_year(resource)
        if not year:
            continue
        text = normalize(f"{resource.get('type')} {resource.get('displayTitle')} {resource.get('title')}")
        if resource.get("sourceKind") == "official-murcia":
            if "prueba practica" in text and "criter" not in text and "especific" not in text:
                official_exams[year].append(resource)
            if "criter" in text or "especific" in text or "requisit" in text:
                criteria_a[year].append(resource)
        elif resource.get("sourceKind") == "private-study":
            private_materials[year].append(resource)
            if resource.get("hasSolution") is True:
                private_solutions[year].append(resource)

    for resource in part_b.get("resources") or []:
        year = resource_year(resource)
        if year and resource.get("sourceKind") == "official-murcia":
            criteria_b[year].append(resource)

    for resource in news.get("resources") or []:
        year = process_year(resource)
        if not year or resource.get("sourceKind") != "official-murcia":
            continue
        text = normalize(f"{resource.get('type')} {resource.get('displayTitle')} {resource.get('title')}")
        if re.search(r"tribunal|resultado|seleccionad", text):
            tribunal_docs[year].append(resource)

    years = sorted(
        set(official_exams)
        | set(criteria_a)
        | set(criteria_b)
        | set(tribunal_docs)
        | set(private_materials),
        reverse=True,
    )
    rows: list[dict[str, Any]] = []

    for year in years:
        exams = unique_resources(official_exams[year])
        a_criteria = unique_resources(criteria_a[year])
        b_criteria = unique_resources(criteria_b[year])
        tribunals = unique_resources(tribunal_docs[year])
        private = unique_resources(private_materials[year])
        solutions = unique_resources(private_solutions[year])
        official_count = len(exams) + len(a_criteria) + len(b_criteria) + len(tribunals)

        if exams:
            exam_status = "official"
            exam_label = "Enunciado oficial"
        elif private:
            exam_status = "private"
            exam_label = "Solo archivo privado"
        else:
            exam_status = "missing"
            exam_label = "No localizado"

        if a_criteria and b_criteria:
            criteria_status = "official"
            criteria_label = "Partes A y B"
        elif a_criteria:
            criteria_status = "partial"
            criteria_label = "Solo Parte A"
        elif b_criteria:
            criteria_status = "partial"
            criteria_label = "Solo Parte B"
        else:
            criteria_status = "missing"
            criteria_label = "No localizados"

        if official_count and private:
            source_status = "mixed"
            source_label = "Oficial + archivo privado"
        elif official_count:
            source_status = "official"
            source_label = "Oficial Murcia"
        else:
            source_status = "private"
            source_label = "Archivo privado"

        missing = []
        if not exams:
            missing.append("Enunciado oficial Parte A")
        if not a_criteria:
            missing.append("Criterios Parte A")
        if not b_criteria:
            missing.append("Criterios Parte B")
        if not solutions:
            missing.append("Solución identificada")

        links = [
            *link_items(exams, "Enunciado A"),
            *link_items(a_criteria, "Criterios A"),
            *link_items(b_criteria, "Criterios B"),
            *link_items(tribunals, "Tribunales"),
        ]

        rows.append(
            {
                "year": year,
                "sourceStatus": source_status,
                "sourceLabel": source_label,
                "partA": {
                    "status": exam_status,
                    "label": exam_label,
                    "officialCount": len(exams),
                    "privateCount": len(private),
                },
                "criteria": {
                    "status": criteria_status,
                    "label": criteria_label,
                    "partACount": len(a_criteria),
                    "partBCount": len(b_criteria),
                },
                "solutions": {
                    "status": "private" if solutions else "missing",
                    "label": f"{len(solutions)} privadas" if solutions else "No localizada",
                    "count": len(solutions),
                },
                "tribunalCount": len(tribunals),
                "missing": missing,
                "links": links,
            }
        )

    summary = {
        "years": len(rows),
        "officialEvidenceYears": sum(row["sourceStatus"] in {"official", "mixed"} for row in rows),
        "officialExamYears": sum(row["partA"]["status"] == "official" for row in rows),
        "privateSolutionYears": sum(row["solutions"]["count"] > 0 for row in rows),
        "openGaps": sum(len(row["missing"]) for row in rows),
    }
    return {
        "version": 1,
        "sourceVerifiedAt": phases_data.get("verifiedAt"),
        "scope": (
            "Inventario de documentos localizados para Informática 590107 en Murcia. "
            "Los archivos privados se cuentan aparte y no se presentan como pruebas oficiales."
        ),
        "summary": summary,
        "years": rows,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phases", type=Path, default=PHASES_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true", help="Fail when the generated file is outdated.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    phases_data = json.loads(args.phases.read_text(encoding="utf-8"))
    expected = build_coverage(phases_data)
    if args.check:
        try:
            current = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            print(f"Historical coverage is missing or invalid: {args.output}", file=sys.stderr)
            return 1
        if current != expected:
            print("Historical coverage is outdated; run scripts/build_historical_coverage.py", file=sys.stderr)
            return 1
        print(f"Historical coverage is current: {len(expected['years'])} years")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}: {len(expected['years'])} years")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
