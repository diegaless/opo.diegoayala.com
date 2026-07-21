#!/usr/bin/env python3
"""Create a Murcia exam-phase oriented view of all organized resources."""

from __future__ import annotations

import csv
import json
import os
import re
import shutil
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path


ROOT = Path("/mnt/c/Users/diego/Desktop/Oposicion")
THEORY_ROOT = ROOT / "Teoria organizada por tema"
EXTRA_ROOT = ROOT / "Material complementario organizado"
OUTPUT = ROOT / "Material por fases del examen - Murcia"
REPORTS = OUTPUT / "00_Informes"
REPO = Path("/home/diego/projects/opo-diegoayala")
WEB_MATERIALS = REPO / "data" / "materials.json"
THEORY_MANIFEST = THEORY_ROOT / "00_Informes" / "manifest.json"
EXTRA_SELECTED = EXTRA_ROOT / "00_Informes" / "seleccionados.csv"
EXTRA_IGNORED = EXTRA_ROOT / "00_Informes" / "ignorados.csv"


LEGAL_SOURCES = [
    {
        "nivel": "Convocatoria autonómica Murcia",
        "norma": "Orden de 20 de noviembre de 2024, BORM núm. 272 de 22/11/2024",
        "relevancia": "Bases y convocatoria de Secundaria/FP 2025 en la Región de Murcia. Define pruebas, entrega de programación, méritos y fase de prácticas.",
        "url": "https://www.borm.es/services/anuncio/ano/2024/numero/5838/pdf?id=831952",
    },
    {
        "nivel": "Criterios oficiales Murcia - Informática 590107",
        "norma": "Criterios de valoración y actuación 2025 de 590107 Informática",
        "relevancia": "Concreta tiempos, material permitido, ponderaciones de programación, unidad y debate, y rúbricas de valoración.",
        "url": "https://www.carm.es/web/pagina?IDCONTENIDO=74501&IDTIPO=100&RASTRO=c798%24m3977%2C74131%2C74447%2C74448",
    },
    {
        "nivel": "Reglamento estatal de ingreso",
        "norma": "Real Decreto 276/2007, de 23 de febrero",
        "relevancia": "Marco general del ingreso, accesos y adquisición de nuevas especialidades docentes.",
        "url": "https://www.boe.es/buscar/act.php?id=BOE-A-2007-4372",
    },
    {
        "nivel": "Temario estatal",
        "norma": "Orden de 9 de septiembre de 1993, Orden de 1 de febrero de 1996 y Orden ECD/191/2012",
        "relevancia": "Temarios vigentes aplicables hasta aprobación de temarios definitivos.",
        "url": "https://www.borm.es/services/anuncio/ano/2024/numero/5838/pdf?id=831952",
    },
    {
        "nivel": "Currículo Murcia - ESO/Bachillerato",
        "norma": "Decreto n.º 235/2022 y Decreto n.º 251/2022",
        "relevancia": "Currículo autonómico de ESO y Bachillerato en la Región de Murcia.",
        "url": "https://www.borm.es/services/anuncio/ano/2024/numero/5838/pdf?id=831952",
    },
    {
        "nivel": "FP estatal y currículo del ciclo elegido",
        "norma": "Ley Orgánica 3/2022, Real Decreto 659/2023 y normativa curricular del título/módulo",
        "relevancia": "Base para programar módulos de FP: resultados de aprendizaje, criterios de evaluación, competencias y unidades de competencia.",
        "url": "https://www.boe.es/buscar/act.php?id=BOE-A-2023-16889",
    },
    {
        "nivel": "Título DAW - estatal",
        "norma": "Real Decreto 686/2010 y actualización por Real Decreto 405/2023",
        "relevancia": "Referente estatal para Técnico Superior en Desarrollo de Aplicaciones Web.",
        "url": "https://www.boe.es/buscar/doc.php?id=BOE-A-2010-9269",
    },
    {
        "nivel": "Actualización estatal DAW",
        "norma": "Real Decreto 405/2023, de 29 de mayo",
        "relevancia": "Actualiza el título de Técnico Superior en Desarrollo de Aplicaciones Web y fija enseñanzas mínimas.",
        "url": "https://www.boe.es/buscar/doc.php?id=BOE-A-2023-13221",
    },
    {
        "nivel": "Currículo Murcia - DAW",
        "norma": "Orden de 12 de marzo de 2013, currículo de Desarrollo de Aplicaciones Web en Murcia",
        "relevancia": "Currículo autonómico de Murcia para programar el módulo si se elige DAW.",
        "url": "https://www.borm.es/borm/documento?id=562568&obj=anu",
    },
    {
        "nivel": "Guía FP Murcia 2025/2026 - DAW",
        "norma": "Guía de Formación Profesional de la Consejería de Educación y Formación Profesional de la Región de Murcia",
        "relevancia": "Oferta y organización actual del ciclo DAW: módulo 0373 en segundo curso con 135 horas.",
        "url": "https://llegarasalto.com/guiafp/ciclos/IFC-323.html",
    },
    {
        "nivel": "Actualización curricular Murcia informática",
        "norma": "Orden de 10 de septiembre de 2022, BORM núm. 217 de 19/09/2022",
        "relevancia": "Modifica currículos de ciclos de Informática y Comunicaciones en Murcia e incluye contenidos del módulo 0373.",
        "url": "https://www.borm.es/services/anuncio/ano/2022/numero/4674/pdf?id=810699",
    },
]


SELECTED_MODULE = {
    "cycle_status": "DAW - Técnico Superior en Desarrollo de Aplicaciones Web",
    "recommended_cycle": "Ciclo cerrado por decisión del opositor: DAW.",
    "module": "Lenguajes de marcas y sistemas de gestión de información",
    "code": "0373",
    "family": "Informática y Comunicaciones",
    "course": "2.º curso",
    "current_total_hours": "135 horas",
    "weekly_hours": "6 horas semanales como referencia de distribución ordinaria",
    "old_curriculum_hours": "125 horas, 6 horas semanales y 7 ECTS en el Anexo III de la Orden de 12/03/2013",
    "hours_note": "Para la programación final usar 135 horas si se contextualiza en la organización vigente 2025/2026; conservar la nota de 125 horas solo como referencia histórica del currículo BORM 2013.",
    "content_blocks": [
        "lenguajes de marcas y XML",
        "HTML/XHTML y hojas de estilo",
        "sindicación de contenidos",
        "esquemas y vocabularios XML",
        "transformación de documentos XML",
        "almacenamiento y consulta de información XML",
        "sistemas de gestión empresarial",
    ],
}


PHASES = {
    "00_Normativa_y_orden_legal": {
        "label": "Normativa y orden legal",
        "legal": "Jerarquía normativa y convocatoria oficial.",
    },
    "01_Primera_prueba_B_Tema_escrito": {
        "label": "Primera prueba - Parte B - Tema escrito",
        "legal": "Parte B de la primera prueba: desarrollo de un tema del temario oficial.",
    },
    "02_Primera_prueba_A_Practico": {
        "label": "Primera prueba - Parte A - Práctico",
        "legal": "Parte A de la primera prueba: ejercicio práctico de la especialidad.",
    },
    "03_Segunda_prueba_Programacion_didactica": {
        "label": "Segunda prueba - Programación didáctica / plan didáctico",
        "legal": "Defensa de la programación didáctica, elaborada individualmente.",
    },
    "04_Segunda_prueba_Unidad_didactica": {
        "label": "Segunda prueba - Unidad didáctica / unidad de trabajo",
        "legal": "Preparación y exposición oral de una unidad didáctica, unidad de trabajo o unidad de actuación.",
    },
    "05_Fase_concurso_meritos": {
        "label": "Fase de concurso - Méritos",
        "legal": "Méritos: experiencia docente, formación académica y otros méritos.",
    },
    "06_Fase_practicas": {
        "label": "Fase de prácticas",
        "legal": "Fase posterior al nombramiento como funcionario en prácticas.",
    },
    "99_Transversal_Bibliografia_y_simulacros": {
        "label": "Recursos transversales",
        "legal": "Bibliografía, simulacros, correcciones y materiales de apoyo que sirven a varias fases.",
    },
}


@dataclass
class PhaseLink:
    phase: str
    section: str
    resource_type: str
    academy: str
    topic: str
    area: str
    source_path: str
    destination_path: str
    notes: str


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return value.lower()


def safe_part(value: str, max_len: int = 100) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"[^A-Za-z0-9._() -]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    if not value:
        return "General"
    return value[:max_len].rstrip(" .")


def safe_path(value: str) -> Path:
    return Path(*[safe_part(part) for part in value.split("/") if part.strip()])


def reset_output() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for child in OUTPUT.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    REPORTS.mkdir(parents=True, exist_ok=True)


def link_file(src: Path, dst: Path) -> str:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    try:
        os.link(src, dst)
        return "hardlink"
    except OSError:
        shutil.copy2(src, dst)
        return "copy"


def unique_destination(base: Path, used: set[str]) -> Path:
    text = base.as_posix()
    if text not in used:
        used.add(text)
        return base
    stem = base.stem
    suffix = base.suffix
    parent = base.parent
    counter = 2
    while True:
        candidate = parent / f"{stem}__{counter}{suffix}"
        text = candidate.as_posix()
        if text not in used:
            used.add(text)
            return candidate
        counter += 1


def load_extra_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def load_theory_records() -> dict[tuple[str, str, str, str], dict[str, object]]:
    data = json.loads(THEORY_MANIFEST.read_text(encoding="utf-8"))
    lookup: dict[tuple[str, str, str, str], dict[str, object]] = {}
    for row in data["records"]:
        key = (
            f"{int(row['topic']):02d}",
            row["academy"],
            row["variant"],
            row["file_name"],
        )
        lookup[key] = row
    return lookup


def iter_web_selected_theory() -> list[dict[str, object]]:
    data = json.loads(WEB_MATERIALS.read_text(encoding="utf-8"))
    lookup = load_theory_records()
    selected = []
    for topic_key, topic in data["topics"].items():
        for material in topic["materials"]:
            if material.get("hidden"):
                continue
            key = (
                topic_key,
                material["academy"],
                material["variant"],
                material["fileName"],
            )
            record = lookup.get(key)
            if not record:
                continue
            selected.append({"topic": topic, "material": material, "record": record})
    return selected


def add_link(
    links: list[PhaseLink],
    used: set[str],
    src: Path,
    rel_dst: Path,
    phase: str,
    section: str,
    resource_type: str,
    academy: str = "",
    topic: str = "",
    area: str = "",
    notes: str = "",
) -> None:
    dst = unique_destination(OUTPUT / rel_dst, used)
    mode = link_file(src, dst)
    links.append(
        PhaseLink(
            phase=phase,
            section=section,
            resource_type=resource_type,
            academy=academy,
            topic=topic,
            area=area,
            source_path=str(src),
            destination_path=str(dst),
            notes=(notes + "; " if notes else "") + mode,
        )
    )


def phase_for_extra(row: dict[str, str]) -> tuple[str, str]:
    category = row["category"]
    material_type = row["material_type"]
    source = normalize(row["source_path"])
    area = row["subarea"]

    if category == "04_Legislacion_normativa":
        return "00_Normativa_y_orden_legal", f"Normativa/{safe_part(area)}"
    if category == "03_Didactica_programacion":
        if "unidad" in source or "actividades" in source:
            return "04_Segunda_prueba_Unidad_didactica", f"Didactica_y_unidades/{safe_part(area)}"
        return "03_Segunda_prueba_Programacion_didactica", f"Programacion_y_plan/{safe_part(area)}"
    if category == "01_Practicos":
        return "02_Primera_prueba_A_Practico", f"Practicos_por_area/{safe_part(area)}"
    if category == "02_Esquemas_resumenes":
        return "01_Primera_prueba_B_Tema_escrito", f"Esquemas_y_resumenes/{safe_part(area)}"
    if category == "06_Examenes_correcciones":
        if "introduccion" in source:
            return "01_Primera_prueba_B_Tema_escrito", "Introducciones_y_correcciones_de_temas"
        if area in {"Programacion", "Bases de datos", "Redes", "Sistemas operativos", "Circuitos digitales", "Web XML scripts"}:
            return "02_Primera_prueba_A_Practico", f"Examenes_y_correcciones_practicas/{safe_part(area)}"
        return "99_Transversal_Bibliografia_y_simulacros", f"Correcciones_y_simulacros/{safe_part(area)}"
    if category == "05_Bibliografia":
        return "99_Transversal_Bibliografia_y_simulacros", f"Bibliografia_por_area/{safe_part(area)}"
    if material_type in {"documento", "archivo"}:
        return "99_Transversal_Bibliografia_y_simulacros", "Otros_documentos"
    return "99_Transversal_Bibliografia_y_simulacros", f"Otros/{safe_part(area)}"


def write_phase_readmes(summary_counts: Counter[str]) -> None:
    for phase, meta in PHASES.items():
        readme = OUTPUT / phase / "README.md"
        readme.parent.mkdir(parents=True, exist_ok=True)
        count = summary_counts.get(phase, 0)
        lines = [
            f"# {meta['label']}",
            "",
            f"Recursos enlazados: {count}",
            "",
            f"Encaje legal: {meta['legal']}",
            "",
        ]
        if phase == "01_Primera_prueba_B_Tema_escrito":
            lines.extend(
                [
                    "## Murcia 2025 - Parte B: tema escrito",
                    "",
                    "- Tiempo oficial: 2 horas.",
                    "- En especialidades con más de 50 temas, el aspirante elige entre cuatro temas extraídos al azar.",
                    "- En los criterios de valoración de Informática 590107, el tema se valora sobre 10: conocimiento científico actualizado 6 puntos, estructura/originalidad 2,5 puntos y presentación/orden/redacción 1,5 puntos.",
                    "- Esta carpeta va primero porque es el orden de estudio que has pedido, aunque legalmente en Murcia se llama Parte B de la primera prueba.",
                    "",
                    "Los temas están organizados por número, academia y tipo de recurso, manteniendo la versión última/mejor que ya dejamos seleccionada para la web.",
                    "",
                ]
            )
        if phase == "02_Primera_prueba_A_Practico":
            lines.extend(
                [
                    "## Murcia 2025 - Parte A: práctico",
                    "",
                    "- Tiempo oficial: 3 horas.",
                    "- En Informática 590107, la prueba práctica se valora sobre 10: rigor 0,5, conocimiento científico 0,5, dominio técnico 0,5, resolución/claridad 0,5 y resultados obtenidos 8 puntos.",
                    "- Material permitido en la mesa durante la primera prueba: dos bolígrafos azul o negro, documento identificativo, pañuelos y agua sin etiqueta. No se permite calculadora.",
                    "- Práctico y tema computan al 50% cada uno dentro de la primera prueba. Para superarla hay que sacar al menos 1,25 puntos en cada parte y 5 puntos en total.",
                    "",
                    "Los materiales están agrupados por área práctica para entrenar programación, bases de datos, redes, sistemas, web/XML, arquitectura y otros bloques.",
                    "",
                ]
            )
        if phase == "03_Segunda_prueba_Programacion_didactica":
            lines.extend(
                [
                    "## Requisitos rápidos",
                    "",
                    "- La programación didáctica debe ser personal y elaborada individualmente.",
                    "- Debe ajustarse al currículo y normativa vigente de la Región de Murcia del nivel educativo elegido.",
                    "- Formato crítico según los criterios de Informática 590107: máximo 70 páginas, Arial 11 o superior sin comprimir, interlineado mínimo sencillo y formato UNE-A4.",
                    "- Si se incumple alguno de esos aspectos formales, la programación no se valora en los indicadores correspondientes y la unidad se elabora a partir del temario oficial.",
                    "- La defensa de la programación supone el 20% de la segunda prueba.",
                    "",
                    "Módulo elegido para cerrar la parte didáctica:",
                    "",
                    f"- {SELECTED_MODULE['module']} ({SELECTED_MODULE['code']}).",
                    f"- Ciclo de referencia: {SELECTED_MODULE['cycle_status']}.",
                    f"- Curso: {SELECTED_MODULE['course']}.",
                    f"- Carga horaria actual de referencia: {SELECTED_MODULE['current_total_hours']}.",
                    f"- Distribución semanal: {SELECTED_MODULE['weekly_hours']}.",
                    "- La contextualización debe hacerse sobre el perfil profesional de Desarrollo de Aplicaciones Web.",
                    f"- Nota normativa: {SELECTED_MODULE['hours_note']}",
                    "",
                ]
            )
        if phase == "04_Segunda_prueba_Unidad_didactica":
            lines.extend(
                [
                    "## Exposición oral",
                    "",
                    "- Preparación de la unidad didáctica/unidad de trabajo: 1 hora.",
                    "- Defensa oral total de la segunda prueba: 1 hora y 30 minutos.",
                    "- La defensa de la programación ocupa como máximo 30 minutos; el debate final dura 15 minutos; el resto se dedica a la unidad.",
                    "- Se puede usar material en papel y materiales manipulativos durante la exposición.",
                    "- Guion máximo: un folio por una cara, que se entrega al tribunal al terminar.",
                    "- La unidad vale el 60% de la segunda prueba y el debate con el tribunal el 20%.",
                    "",
                    "La rúbrica prioriza contextualización, objetivos/resultados de aprendizaje, competencias, contenidos, metodología, actividades, atención a la diversidad, evaluación y exposición.",
                    "",
                    f"Unidad de trabajo recomendada: una unidad de {SELECTED_MODULE['course']} del módulo {SELECTED_MODULE['code']} - {SELECTED_MODULE['module']} en DAW, orientada a HTML/CSS/XML, publicación web, validación, transformación o intercambio de información.",
                    "",
                ]
            )
        if phase == "05_Fase_concurso_meritos":
            lines.extend(
                [
                    "## Méritos",
                    "",
                    "La fase de concurso se revisa después de superar la fase de oposición. La documentación debe ordenarse según los bloques del baremo: experiencia docente, formación académica y otros méritos.",
                    "",
                ]
            )
        if phase == "06_Fase_practicas":
            lines.extend(
                [
                    "## Después de aprobar",
                    "",
                    "Esta carpeta queda como recordatorio de la fase de prácticas posterior al nombramiento. No he movido aquí material de estudio porque ahora mismo el objetivo real es preparar oposición, programación y unidad.",
                    "",
                ]
            )
        readme.write_text("\n".join(lines), encoding="utf-8")


def write_master_readme(links: list[PhaseLink]) -> None:
    counts = Counter(link.phase for link in links)
    lines = [
        "# Material por fases del examen",
        "",
        f"Generado: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## Orden real del proceso",
        "",
        "Según la Orden de 20 de noviembre de 2024 de la Región de Murcia y los criterios oficiales de Informática 590107, el procedimiento consta de fase de oposición, fase de concurso y fase de prácticas. Para estudiar lo dejo en el orden que has pedido, aunque legalmente el práctico se llama Parte A y el tema Parte B:",
        "",
        "1. Tema escrito: primera prueba, Parte B, 2 horas.",
        "2. Práctico: primera prueba, Parte A, 3 horas.",
        "3. Programación didáctica / plan didáctico: segunda prueba, defensa oral.",
        "4. Unidad didáctica / unidad de trabajo: segunda prueba, 1 hora de preparación y exposición oral.",
        "5. Fase de concurso: méritos, una vez superada la oposición.",
        "6. Fase de prácticas: posterior al nombramiento como funcionario en prácticas.",
        "",
        "## Carpetas creadas",
        "",
    ]
    for phase, meta in PHASES.items():
        lines.append(f"- `{phase}`: {meta['label']} ({counts.get(phase, 0)} recursos).")

    lines.extend(
        [
            "",
            "## Ponderaciones clave",
            "",
            "- Primera prueba: práctico y tema pesan 50% cada uno; mínimo 1,25 puntos en cada parte y 5 puntos en total.",
            "- Práctico de Informática 590107: supuesto práctico de 3 horas, sin calculadora.",
            "- Tema escrito: 2 horas; en especialidades con más de 50 temas se elige entre cuatro extraídos al azar.",
            "- Segunda prueba: programación 20%, unidad 60% y debate 20%; se supera con 5 o más.",
            "- Programación: máximo 70 páginas, Arial 11 mínimo, interlineado mínimo sencillo y formato UNE-A4.",
            "- La fase de concurso valora experiencia docente, formación académica y otros méritos.",
            "",
            "## Fuentes oficiales usadas",
            "",
        ]
    )
    for source in LEGAL_SOURCES:
        lines.append(f"- {source['nivel']}: {source['norma']} - {source['url']}")
    lines.extend(
        [
            "",
            "## Notas",
            "",
            "- Los archivos se enlazan mediante hardlinks cuando es posible para no duplicar espacio.",
            "- La teoría ya depurada se toma de la web/local `data/materials.json`, por lo que mantiene la versión última/mejor que dejamos antes.",
            "- Los recursos complementarios vienen del inventario `Material complementario organizado`.",
            f"- Módulo didáctico elegido: {SELECTED_MODULE['code']} - {SELECTED_MODULE['module']}.",
            "- Ciclo didáctico elegido: DAW - Técnico Superior en Desarrollo de Aplicaciones Web.",
            f"- Curso y horas de referencia: {SELECTED_MODULE['course']}, {SELECTED_MODULE['current_total_hours']}, {SELECTED_MODULE['weekly_hours']}.",
        ]
    )
    (OUTPUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_phase_index(links: list[PhaseLink]) -> None:
    by_phase: dict[str, list[PhaseLink]] = {}
    for link in links:
        by_phase.setdefault(link.phase, []).append(link)

    lines = [
        "# Índice de recursos por fase - Murcia",
        "",
        f"Generado: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "Este índice resume qué recursos aparecen en cada fase. La carpeta `README.md` de cada fase explica el encaje legal y los criterios de Murcia.",
        "",
    ]

    for phase, meta in PHASES.items():
        phase_links = by_phase.get(phase, [])
        lines.extend(
            [
                f"## {phase}",
                "",
                f"- Fase: {meta['label']}",
                f"- Recursos enlazados: {len(phase_links)}",
                f"- Encaje legal: {meta['legal']}",
            ]
        )
        if not phase_links:
            lines.extend(["- Estado: carpeta de control, sin recursos específicos enlazados todavía.", ""])
            continue

        section_counts = Counter(link.section for link in phase_links)
        academy_counts = Counter(link.academy or "General" for link in phase_links)
        type_counts = Counter(link.resource_type or "archivo" for link in phase_links)
        lines.append("- Secciones principales:")
        for section, count in section_counts.most_common(12):
            lines.append(f"  - {section}: {count}")
        lines.append("- Academias/fuentes principales:")
        for academy, count in academy_counts.most_common(10):
            lines.append(f"  - {academy}: {count}")
        lines.append("- Tipos de recurso:")
        for resource_type, count in type_counts.most_common(10):
            lines.append(f"  - {resource_type}: {count}")
        lines.append("")

    (REPORTS / "INDICE_POR_FASE.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_selected_module_note() -> None:
    lines = [
        "# Módulo elegido para programación y unidad",
        "",
        f"Módulo profesional: {SELECTED_MODULE['module']}",
        f"Código: {SELECTED_MODULE['code']}",
        f"Familia profesional: {SELECTED_MODULE['family']}",
        f"Ciclo de referencia: {SELECTED_MODULE['cycle_status']}",
        f"Curso: {SELECTED_MODULE['course']}",
        f"Horas actuales de referencia: {SELECTED_MODULE['current_total_hours']}",
        f"Distribución semanal: {SELECTED_MODULE['weekly_hours']}",
        "",
        "## Por qué hay que fijarlo",
        "",
        "La teoría y el práctico se preparan por especialidad, pero la programación didáctica y la unidad deben ajustarse a un currículo concreto. Por eso no basta con decir Informática: hay que decir ciclo, curso y módulo.",
        "",
        "En este caso, Lenguajes de marcas y sistemas de gestión de información es una buena elección porque conecta directamente con muchos recursos que ya tienes: HTML, XML, CSS, XSD/DTD, XSLT/XPath, sindicación, almacenamiento XML y sistemas de gestión empresarial.",
        "",
        "## Decisión práctica",
        "",
        "- Decisión cerrada: DAW.",
        "- La programación debe contextualizarse en el título de Técnico Superior en Desarrollo de Aplicaciones Web.",
        "- El módulo 0373 se orientará a desarrollo web, validación de documentos, HTML/CSS/XML, transformación/intercambio de información y sistemas de gestión de información.",
        f"- Se toma como referencia actual la Guía FP Murcia 2025/2026: {SELECTED_MODULE['course']} y {SELECTED_MODULE['current_total_hours']}.",
        f"- Distribución para programar: {SELECTED_MODULE['weekly_hours']}.",
        f"- Precaución: {SELECTED_MODULE['old_curriculum_hours']}.",
        f"- Criterio de trabajo: {SELECTED_MODULE['hours_note']}",
        "",
        "## Bloques de contenido del módulo",
        "",
    ]
    for block in SELECTED_MODULE["content_blocks"]:
        lines.append(f"- {block}")
    lines.extend(
        [
            "",
            "## Normativa que se usará",
            "",
            "- Estatal: Real Decreto 686/2010 para DAW y Real Decreto 405/2023 como actualización del título.",
            "- Murcia DAW: Orden de 12 de marzo de 2013 del currículo de Desarrollo de Aplicaciones Web, modificada por la Orden de 10 de septiembre de 2022.",
            "- Organización actual: Guía FP Murcia 2025/2026 de la Consejería de Educación y Formación Profesional.",
            "",
        ]
    )
    target = OUTPUT / "00_Normativa_y_orden_legal" / "01_Modulo_elegido_LMSGI_0373.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines), encoding="utf-8")


def write_legal_order() -> None:
    lines = [
        "# Orden legal y encaje por fase",
        "",
        "## Jerarquía práctica",
        "",
        "1. Normativa estatal básica: LOE/LOMLOE, Ley Orgánica 3/2022 de FP, Real Decreto 276/2007 de ingreso, reales decretos de currículo y FP.",
        "2. Normativa autonómica de la Región de Murcia: decretos y órdenes autonómicas de currículo, evaluación y organización del nivel elegido.",
        "3. Convocatoria concreta: Orden de 20 de noviembre de 2024, BORM núm. 272 de 22/11/2024, para los procedimientos selectivos de 2025.",
        "4. Criterios de tribunal/comisión de Informática 590107: concretan tiempos, material permitido, ponderaciones y rúbricas.",
        "",
        "## Encaje por fase",
        "",
        "- Tema escrito: temario vigente y criterios de valoración de la Parte B de Informática 590107.",
        "- Práctico: criterios de actuación y valoración de la Parte A de Informática 590107.",
        "- Programación didáctica: currículo vigente de la Región de Murcia y normativa FP/ESO/Bachillerato según nivel elegido; formato máximo 70 páginas, Arial 11, interlineado sencillo y UNE-A4.",
        "- Unidad didáctica/unidad de trabajo: currículo vigente, programación propia y reglas de preparación/exposición oral de la segunda prueba.",
        "- Méritos: baremo de la convocatoria, ordenado por experiencia docente, formación académica y otros méritos.",
        "- Fase de prácticas: regulación posterior al proceso selectivo, cuando se obtenga plaza.",
        "",
        "## Nivel legal de la programación",
        "",
        f"Se toma como módulo didáctico de referencia `{SELECTED_MODULE['code']} - {SELECTED_MODULE['module']}`.",
        "",
        "El ciclo elegido es DAW: Técnico Superior en Desarrollo de Aplicaciones Web. La programación final debe contextualizarse con el perfil profesional, competencia general y entorno profesional de DAW.",
        "",
        f"Organización de referencia: {SELECTED_MODULE['course']}, {SELECTED_MODULE['current_total_hours']} y {SELECTED_MODULE['weekly_hours']}. La Orden de 12/03/2013 recoge una distribución anterior de {SELECTED_MODULE['old_curriculum_hours']}; para una programación actual se usa la guía FP Murcia 2025/2026, dejando constancia de la diferencia.",
        "",
        "## Fuentes oficiales",
        "",
    ]
    for source in LEGAL_SOURCES:
        lines.extend(
            [
                f"### {source['nivel']}",
                "",
                f"- Norma: {source['norma']}",
                f"- Uso: {source['relevancia']}",
                f"- URL: {source['url']}",
                "",
            ]
        )
    target = OUTPUT / "00_Normativa_y_orden_legal" / "00_Orden_legal_y_encaje.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    reset_output()
    links: list[PhaseLink] = []
    used: set[str] = set()

    for item in iter_web_selected_theory():
        topic = item["topic"]
        material = item["material"]
        record = item["record"]
        src = THEORY_ROOT / record["relative_path"]
        if not src.exists():
            continue
        topic_dir = safe_part(f"Tema {topic['number']} - {topic['title']}")
        academy = safe_part(material["academy"])
        material_type = safe_part(material["type"])
        rel_dst = (
            Path("01_Primera_prueba_B_Tema_escrito")
            / "Temario_y_resumenes_por_tema"
            / topic_dir
            / academy
            / material_type
            / safe_part(material["driveFileName"])
        )
        add_link(
            links,
            used,
            src,
            rel_dst,
            "01_Primera_prueba_B_Tema_escrito",
            "Temario_y_resumenes_por_tema",
            material["type"],
            academy=material["academy"],
            topic=f"Tema {topic['number']}",
            area=record.get("block_title", ""),
            notes=f"variant={material['variant']}",
        )

    for row in load_extra_rows(EXTRA_SELECTED):
        src = Path(row["organized_relative_path"])
        src = EXTRA_ROOT / src
        if not src.exists():
            src = Path(row["source_path"])
        if not src.exists():
            continue
        phase, section = phase_for_extra(row)
        topic = row["topic_label"] or "General"
        academy = row["academy"] or "General"
        filename = safe_part(Path(row["organized_relative_path"]).name or row["file_name"])
        rel_dst = Path(phase) / safe_path(section) / safe_part(topic) / safe_part(academy) / filename
        add_link(
            links,
            used,
            src,
            rel_dst,
            phase,
            section,
            row["material_type"],
            academy=academy,
            topic=topic,
            area=row["subarea"],
            notes=f"category={row['category']}",
        )

    ignored_rows = load_extra_rows(EXTRA_IGNORED)
    if ignored_rows:
        ignored_target = REPORTS / "ignorados_del_material_complementario.csv"
        shutil.copy2(EXTRA_IGNORED, ignored_target)

    write_legal_order()
    write_selected_module_note()
    summary_counts = Counter(link.phase for link in links)
    write_phase_readmes(summary_counts)
    write_master_readme(links)
    write_phase_index(links)

    rows = [asdict(link) for link in links]
    fields = list(rows[0].keys()) if rows else []
    with (REPORTS / "recursos_por_fase.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    manifest = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source_root": str(ROOT),
        "output_root": str(OUTPUT),
        "phase_counts": summary_counts,
        "total_resources": len(links),
        "legal_sources": LEGAL_SOURCES,
        "resources": rows,
    }
    (REPORTS / "recursos_por_fase.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, default=dict) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in manifest.items() if k != "resources"}, ensure_ascii=False, indent=2, default=dict))


if __name__ == "__main__":
    main()
