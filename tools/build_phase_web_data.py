#!/usr/bin/env python3
"""Build the public phase-oriented JSON used by the static site."""

from __future__ import annotations

import csv
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from organize_exam_phases import LEGAL_SOURCES, OUTPUT, SELECTED_MODULE


REPO = Path("/home/diego/projects/opo-diegoayala")
MATERIALS_JSON = REPO / "data" / "materials.json"
PHASE_REPORT = OUTPUT / "00_Informes" / "recursos_por_fase.csv"
TARGET = REPO / "data" / "phases.json"


PHASE_META = {
    "00_Normativa_y_orden_legal": {
        "order": 0,
        "label": "Normativa",
        "title": "Normativa y orden legal",
        "legal": "Jerarquía normativa, convocatoria Murcia y fuentes DAW.",
        "description": "Base legal para interpretar cada fase, con Murcia, Informática 590107 y DAW como referencia didáctica.",
    },
    "01_Primera_prueba_B_Tema_escrito": {
        "order": 1,
        "label": "Tema",
        "title": "Primera prueba - Tema escrito",
        "legal": "Parte B de la primera prueba.",
        "description": "Temario oficial por número, academia y tipo de material. Los PDFs ya enlazan al visor de Drive cuando están subidos.",
    },
    "02_Primera_prueba_A_Practico": {
        "order": 2,
        "label": "Práctico",
        "title": "Primera prueba - Práctico",
        "legal": "Parte A de la primera prueba.",
        "description": "Prácticos organizados por área: programación, bases de datos, redes, sistemas, circuitos y web/XML.",
    },
    "03_Segunda_prueba_Programacion_didactica": {
        "order": 3,
        "label": "Programación",
        "title": "Segunda prueba - Programación didáctica",
        "legal": "Defensa de programación didáctica.",
        "description": "Material de programación con el módulo cerrado como DAW: Lenguajes de marcas y sistemas de gestión de información.",
    },
    "04_Segunda_prueba_Unidad_didactica": {
        "order": 4,
        "label": "Unidad",
        "title": "Segunda prueba - Unidad didáctica",
        "legal": "Preparación y exposición oral de unidad de trabajo.",
        "description": "Recursos para construir unidades de trabajo del módulo 0373, orientadas a HTML/CSS/XML y gestión de información.",
    },
    "05_Fase_concurso_meritos": {
        "order": 5,
        "label": "Méritos",
        "title": "Fase de concurso - Méritos",
        "legal": "Baremo de experiencia, formación académica y otros méritos.",
        "description": "Carpeta de control para incorporar documentación de méritos cuando toque.",
    },
    "06_Fase_practicas": {
        "order": 6,
        "label": "Prácticas",
        "title": "Fase de prácticas",
        "legal": "Fase posterior al nombramiento como funcionario en prácticas.",
        "description": "Seguimiento posterior a la obtención de plaza. No contiene material de estudio específico por ahora.",
    },
    "99_Transversal_Bibliografia_y_simulacros": {
        "order": 99,
        "label": "Transversal",
        "title": "Bibliografía, simulacros y apoyo",
        "legal": "Recursos útiles para varias fases.",
        "description": "Bibliografía, correcciones, simulacros y documentos generales que conviene tener a mano.",
    },
}


def load_drive_lookup() -> dict[str, dict[str, str]]:
    data = json.loads(MATERIALS_JSON.read_text(encoding="utf-8"))
    lookup: dict[str, dict[str, str]] = {}
    for topic in data["topics"].values():
        for material in topic.get("materials", []):
            drive_name = material.get("driveFileName")
            if not drive_name:
                continue
            lookup[drive_name] = {
                "url": material.get("url", ""),
                "urlMode": material.get("urlMode", ""),
                "driveFileId": material.get("driveFileId", ""),
            }
    return lookup


def clean_title(path_text: str) -> str:
    return Path(path_text).name


def load_rows() -> list[dict[str, str]]:
    with PHASE_REPORT.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def summarize_counter(rows: list[dict[str, str]], key: str) -> list[dict[str, object]]:
    counter = Counter(row[key] or "General" for row in rows)
    return [{"name": name, "count": count} for name, count in counter.most_common()]


def build_resource(row: dict[str, str], drive_lookup: dict[str, dict[str, str]]) -> dict[str, object]:
    title = clean_title(row["destination_path"])
    linked = drive_lookup.get(title)
    resource = {
        "title": title,
        "phase": row["phase"],
        "section": row["section"],
        "type": row["resource_type"] or "archivo",
        "academy": row["academy"] or "General",
        "topic": row["topic"] or "General",
        "area": row["area"] or "General",
        "hasPublicLink": bool(linked and linked.get("url")),
    }
    if linked and linked.get("url"):
        resource.update(linked)
    return resource


def main() -> None:
    rows = load_rows()
    drive_lookup = load_drive_lookup()
    resources = [build_resource(row, drive_lookup) for row in rows]
    by_phase: dict[str, list[dict[str, object]]] = {phase: [] for phase in PHASE_META}
    for resource in resources:
        by_phase.setdefault(str(resource["phase"]), []).append(resource)

    phases = []
    for phase_id, meta in sorted(PHASE_META.items(), key=lambda item: item[1]["order"]):
        phase_resources = by_phase.get(phase_id, [])
        source_rows = [row for row in rows if row["phase"] == phase_id]
        public_count = sum(1 for resource in phase_resources if resource["hasPublicLink"])
        phases.append(
            {
                "id": phase_id,
                **meta,
                "resourceCount": len(phase_resources),
                "publicLinkCount": public_count,
                "sections": summarize_counter(source_rows, "section"),
                "academies": summarize_counter(source_rows, "academy"),
                "types": summarize_counter(source_rows, "resource_type"),
                "resources": sorted(
                    phase_resources,
                    key=lambda item: (
                        str(item["section"]),
                        str(item["topic"]),
                        str(item["academy"]),
                        str(item["title"]),
                    ),
                ),
            }
        )

    payload = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "Material por fases del examen - Murcia",
        "access": "Los materiales complementarios aparecerán como enlaces cuando se suba la carpeta final a Drive.",
        "selectedModule": SELECTED_MODULE,
        "legalSources": LEGAL_SOURCES,
        "phases": phases,
        "totalResources": len(resources),
        "publicLinkCount": sum(1 for resource in resources if resource["hasPublicLink"]),
    }
    TARGET.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
