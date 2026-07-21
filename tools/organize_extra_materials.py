#!/usr/bin/env python3
"""Organize non-theory opposition materials into a reviewable structure.

The script creates hard links instead of copies where possible. This keeps the
organized folder lightweight even when the source tree contains large PDFs.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import unicodedata
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable


ROOT = Path("/mnt/c/Users/diego/Desktop/Oposicion")
THEORY_MANIFEST = ROOT / "Teoria organizada por tema" / "00_Informes" / "manifest.json"
OUTPUT = ROOT / "Material complementario organizado"
REPORTS = OUTPUT / "00_Informes"

SOURCE_ROOTS = [
    ROOT / "OPO COMPARTIDO MATERIAL.docx",
    ROOT / "PROGRAMACION DIDACTICA FP.docx",
    ROOT / "Salario2022.pdf",
    ROOT / "Practica",
    ROOT / "Práctica",
    ROOT / "Teoría" / "3. Preparador online",
]

VIDEO_EXTENSIONS = {
    ".3gp",
    ".aac",
    ".avi",
    ".flv",
    ".m4a",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".ts",
    ".wav",
    ".weba",
    ".webm",
    ".wmv",
}

COMPILED_EXTENSIONS = {
    ".bin",
    ".class",
    ".dat",
    ".dll",
    ".dylib",
    ".exe",
    ".jar",
    ".o",
    ".obj",
    ".pyc",
}

LINKABLE_EXTENSIONS = {
    ".c",
    ".cc",
    ".cpp",
    ".css",
    ".doc",
    ".docx",
    ".htm",
    ".html",
    ".java",
    ".jpeg",
    ".jpg",
    ".md",
    ".pdf",
    ".png",
    ".sql",
    ".txt",
    ".xml",
    ".xsd",
    ".xsl",
    ".zip",
}

CODE_EXTENSIONS = {
    ".c",
    ".cc",
    ".cpp",
    ".css",
    ".java",
    ".sql",
    ".xml",
    ".xsd",
    ".xsl",
}

PRUNE_DIR_NAMES = {
    ".git",
    "__pycache__",
    "__MACOSX",
    "_images",
    "build",
    "dist",
    "nbproject",
    "Teoria organizada por tema",
    "Material complementario organizado",
}

PRUNE_DIR_MARKERS = [
    "/VIDEOS 2022 2023",
    "/VIDEOS OPOSICIONES",
]

THEORY_ONLY_DIR_MARKERS = [
    "/PREPARACION ONLINE/TEMAS/",
    "/PREPARACION ONLINE V2/TEMAS V2/",
    "/MATERIAL COMPLETO ONLINE/temas adaptados/",
]


@dataclass
class Record:
    selected: bool
    ignored_reason: str
    duplicate_of_sha256_16: str
    category: str
    subarea: str
    topic: str
    topic_label: str
    topic_title: str
    block_title: str
    academy: str
    material_type: str
    variant: str
    file_name: str
    organized_relative_path: str
    source_path: str
    source_relative_path: str
    extension: str
    size_bytes: int
    sha256_16: str
    pdf_pages: str
    text_chars_checked: int
    content_check: str
    notes: str


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return value.lower()


def safe_part(value: str, max_len: int = 90) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"[^A-Za-z0-9._() -]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    if not value:
        value = "sin-nombre"
    return value[:max_len].rstrip(" .")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_topics() -> dict[int, dict[str, str]]:
    data = json.loads(THEORY_MANIFEST.read_text(encoding="utf-8"))
    topics: dict[int, dict[str, str]] = {}
    for row in data["records"]:
        topic = int(row["topic"])
        topics.setdefault(
            topic,
            {
                "title": row["topic_title"],
                "block": row["block_title"],
            },
        )
    return topics


def iter_files() -> Iterable[Path]:
    seen: set[Path] = set()
    for source in SOURCE_ROOTS:
        if not source.exists():
            continue
        if source.is_file():
            resolved = source.resolve()
            if resolved not in seen:
                seen.add(resolved)
                yield source
            continue
        for dirpath, dirnames, filenames in os.walk(source):
            current = Path(dirpath)
            current_text = current.as_posix()
            if any(marker in current_text for marker in PRUNE_DIR_MARKERS):
                dirnames[:] = []
                continue
            dirnames[:] = [
                name
                for name in dirnames
                if name not in PRUNE_DIR_NAMES
                and not name.startswith(".")
                and not name.startswith("~$")
                and not any(marker in (current / name).as_posix() for marker in PRUNE_DIR_MARKERS)
            ]
            for filename in filenames:
                if filename.startswith("~$") or filename.startswith("._"):
                    continue
                path = current / filename
                try:
                    resolved = path.resolve()
                except OSError:
                    continue
                if resolved in seen:
                    continue
                seen.add(resolved)
                yield path


def is_old_theory_path(path: Path) -> bool:
    text = "/" + path.as_posix()
    if any(marker in text for marker in THEORY_ONLY_DIR_MARKERS):
        return True
    name = normalize(path.name)
    parent = normalize(path.parent.as_posix())
    if "muestras informaticapreparacion" in parent:
        return True
    if re.match(r"tema\s*\d+\s*(v2|v2\.0|pes|sai|-tsf)", name):
        return True
    return False


def detect_topic(path: Path, topics: dict[int, dict[str, str]]) -> tuple[str, str, str, str]:
    text = normalize(path.as_posix())
    if "curso completo db con actividades resueltas" in text:
        return "", "", "", ""
    patterns = [
        r"\btema\s*0?(\d{1,2})\b",
        r"\btema0?(\d{1,2})\b",
        r"\btema\s*0?(\d{1,2})[-_ .]",
        r"\b0?(\d{1,2})\s*sai\b",
        r"\b0?(\d{1,2})\s*pes\b",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            number = int(match.group(1))
            if 1 <= number <= 74 and number in topics:
                info = topics[number]
                return (
                    f"{number:02d}",
                    f"Tema {number:02d}",
                    info["title"],
                    info["block"],
                )
    return "", "", "", ""


def detect_academy(path: Path) -> str:
    text = normalize(path.as_posix())
    if "ecoem" in text:
        return "Ecoem"
    if "abacus" in text:
        return "Abacus"
    if "preparador" in text or "preparacion online" in text:
        return "Preparador online"
    return "General"


def detect_area(path: Path) -> str:
    text = normalize(path.as_posix())
    checks = [
        ("Redes", ["redes", "subnet", "cidr", "enrut", "tcp", "mac ", "ipv4", "router"]),
        ("Bases de datos", ["bbdd", "base de datos", "bases de datos", "sql", "relacional", "normalizacion", "entidad-relacion", "modelo datos"]),
        ("Sistemas operativos", ["sistemas operativos", "gestion memoria", "gestion procesos", "archivos"]),
        ("Circuitos digitales", ["circuito", "digital", "secuencial", "combinacional"]),
        ("Programacion", ["programacion en c", "lenguaje c", "c++", "java", "poo", "algorit", "pseudocodigo"]),
        ("Web XML scripts", ["web", "xml", "html", "css", "php", "scripts linux", "script"]),
        ("Ingenieria software", ["ingenieria", "dfd", "uml", "software"]),
        ("Didactica", ["didactica", "programacion didactica", "unidad didactica"]),
        ("Legislacion", ["legislacion", "normativa", "lomloe", "real decreto", "ley", "bases oposicion", "idiomas aceptados"]),
    ]
    for area, needles in checks:
        if any(needle in text for needle in needles):
            return area
    return "General"


def detect_category(path: Path, ext: str) -> tuple[str, str, str]:
    text = normalize(path.as_posix())
    area = detect_area(path)
    if ext in VIDEO_EXTENSIONS or "videos oposiciones" in text or "videos 2022" in text:
        return "08_Videos", area, "video"
    if "bibliografia" in text:
        return "05_Bibliografia", area, "bibliografia"
    if "legislacion" in text or "normativa" in text or "bases oposicion" in text:
        return "04_Legislacion_normativa", area, "legislacion"
    if "didactica" in text or "programacion didactica" in text or "unidad didactica" in text:
        return "03_Didactica_programacion", area, "didactica"
    if "temas alumnos" in text or "corregid" in text or "correcion" in text or "correccion" in text or "introduccion" in text or "rubrica" in text:
        return "06_Examenes_correcciones", area, "correccion"
    if "esquema" in text or "resumenes" in text or "resumen " in text:
        return "02_Esquemas_resumenes", area, "esquema"
    if "practica" in text or "practicos" in text or "problemas" in text or "ejercicios" in text or ext in CODE_EXTENSIONS:
        return "01_Practicos", area, "practico"
    if ext in {".doc", ".docx", ".pdf"}:
        return "09_Otros_documentos", area, "documento"
    return "10_Otros_archivos", area, "archivo"


def detect_variant(path: Path, material_type: str) -> str:
    text = normalize(path.as_posix())
    name = normalize(path.name)
    variants = []
    if "v2" in text or "2022 2023" in text or "ok 2021" in text:
        variants.append("version-reciente")
    if "resuelt" in text or "solucion" in text or "soluciones" in text:
        variants.append("resuelto")
    if "propuest" in text or "resolver" in text:
        variants.append("propuesto")
    if "tipo examen" in text or "examen" in text:
        variants.append("tipo-examen")
    if "teoria" in name or "manual" in name:
        variants.append("manual")
    if "muestra" in text:
        variants.append("muestra")
    return "+".join(variants) or material_type


def source_relative(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def source_score(path: Path) -> tuple[int, int, int]:
    text = normalize(path.as_posix())
    score = 0
    if "preparacion online v2" in text or "2022 2023" in text:
        score += 50
    if "aun mas practicos" in text or "ok 2021" in text:
        score += 35
    if "preparacion online-20230131" in text:
        score += 20
    if "practica" in text:
        score += 15
    if "muestra" in text or "__macosx" in text:
        score -= 100
    # Prefer shorter paths and richer filenames when everything else ties.
    return (score, -len(path.parts), len(path.name))


def pdf_pages(path: Path) -> str:
    try:
        proc = subprocess.run(
            ["pdfinfo", str(path)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        )
    except Exception:
        return ""
    for line in proc.stdout.splitlines():
        if line.lower().startswith("pages:"):
            return line.split(":", 1)[1].strip()
    return ""


def text_chars_checked(path: Path, ext: str, size: int) -> int:
    if ext == ".docx" and size <= 10 * 1024 * 1024:
        try:
            from docx import Document

            doc = Document(str(path))
            text = "\n".join(p.text for p in doc.paragraphs[:80])
            return len(text.strip())
        except Exception:
            return 0
    return 0


def make_dest_path(record: Record, used: set[str]) -> str:
    category = safe_part(record.category)
    subarea = safe_part(record.subarea)
    academy = safe_part(record.academy)
    if record.topic:
        topic_dir = safe_part(f"{record.topic_label} - {record.topic_title}")
    else:
        topic_dir = "General"
    variant = safe_part(record.variant)
    stem = safe_part(Path(record.file_name).stem, max_len=80)
    ext = record.extension or ""
    base = f"{stem}{ext}"
    rel = Path(category) / subarea / topic_dir / academy / variant / base
    rel_text = rel.as_posix()
    counter = 2
    while rel_text in used:
        rel = Path(category) / subarea / topic_dir / academy / variant / f"{stem}__{counter}{ext}"
        rel_text = rel.as_posix()
        counter += 1
    used.add(rel_text)
    return rel_text


def hardlink_or_copy(src: Path, dst: Path) -> str:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    try:
        os.link(src, dst)
        return "hardlink"
    except OSError:
        shutil.copy2(src, dst)
        return "copy"


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    topics = load_topics()
    REPORTS.mkdir(parents=True, exist_ok=True)
    for child in OUTPUT.iterdir():
        if child.name == "00_Informes":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    raw_records: list[Record] = []
    ignored: list[Record] = []
    selected_candidates: list[Record] = []

    for path in iter_files():
        if not path.exists() or not path.is_file():
            continue
        ext = path.suffix.lower()
        rel = source_relative(path)
        size = path.stat().st_size
        category, subarea, material_type = detect_category(path, ext)
        topic, topic_label, topic_title, block_title = detect_topic(path, topics)
        academy = detect_academy(path)
        variant = detect_variant(path, material_type)
        reason = ""
        selected = True
        sha = ""

        if is_old_theory_path(path):
            selected = False
            reason = "excluded_theory_already_organized"
        elif ext in VIDEO_EXTENSIONS:
            selected = False
            reason = "indexed_video_not_linked"
        elif ext in COMPILED_EXTENSIONS:
            selected = False
            reason = "ignored_compiled_or_binary_artifact"
        elif ext not in LINKABLE_EXTENSIONS:
            selected = False
            reason = "indexed_non_study_extension"

        large_file = selected and size > 1 * 1024 * 1024
        if large_file:
            sha = "large-" + hashlib.sha1(rel.encode("utf-8", errors="ignore")).hexdigest()[:10]
        elif selected:
            sha = sha256_file(path)[:16]

        pages = ""
        checked = text_chars_checked(path, ext, size) if selected and not large_file else 0
        content_check = "content_checked" if checked else ("metadata_only" if selected else "not_checked")

        record = Record(
            selected=selected,
            ignored_reason=reason,
            duplicate_of_sha256_16="",
            category=category,
            subarea=subarea,
            topic=topic,
            topic_label=topic_label,
            topic_title=topic_title,
            block_title=block_title,
            academy=academy,
            material_type=material_type,
            variant=variant,
            file_name=path.name,
            organized_relative_path="",
            source_path=str(path),
            source_relative_path=rel,
            extension=ext,
            size_bytes=size,
            sha256_16=sha,
            pdf_pages=pages,
            text_chars_checked=checked,
            content_check=content_check,
            notes="large_file_not_hashed" if large_file else "",
        )
        raw_records.append(record)
        if selected:
            selected_candidates.append(record)
        else:
            ignored.append(record)

    by_sha: dict[str, list[Record]] = defaultdict(list)
    for record in selected_candidates:
        by_sha[record.sha256_16].append(record)

    final_selected: list[Record] = []
    for sha, records in by_sha.items():
        records.sort(key=lambda item: source_score(Path(item.source_path)), reverse=True)
        winner = records[0]
        final_selected.append(winner)
        for duplicate in records[1:]:
            duplicate.selected = False
            duplicate.ignored_reason = "duplicate_exact"
            duplicate.duplicate_of_sha256_16 = sha
            duplicate.notes = f"same content as {winner.source_relative_path}"
            ignored.append(duplicate)

    used_paths: set[str] = set()
    for record in sorted(final_selected, key=lambda r: (r.category, r.subarea, r.topic, r.academy, r.file_name)):
        record.organized_relative_path = make_dest_path(record, used_paths)
        mode = hardlink_or_copy(Path(record.source_path), OUTPUT / record.organized_relative_path)
        record.notes = (record.notes + "; " if record.notes else "") + mode

    all_rows = [asdict(row) for row in raw_records]
    selected_rows = [asdict(row) for row in final_selected]
    ignored_rows = [asdict(row) for row in ignored]
    fields = list(asdict(raw_records[0]).keys()) if raw_records else []

    write_csv(REPORTS / "manifest.csv", all_rows, fields)
    write_csv(REPORTS / "seleccionados.csv", selected_rows, fields)
    write_csv(REPORTS / "ignorados.csv", ignored_rows, fields)

    duplicate_groups = []
    for sha, records in by_sha.items():
        if len(records) > 1:
            kept = next((r for r in records if r.selected), records[0])
            duplicate_groups.append(
                {
                    "sha256_16": sha,
                    "count": len(records),
                    "kept": kept.source_relative_path,
                    "duplicates": " | ".join(r.source_relative_path for r in records if r is not kept),
                }
            )
    write_csv(
        REPORTS / "duplicados_exactos.csv",
        duplicate_groups,
        ["sha256_16", "count", "kept", "duplicates"],
    )

    videos = [asdict(row) for row in raw_records if row.ignored_reason == "indexed_video_not_linked"]
    if videos:
        write_csv(REPORTS / "videos_indexados.csv", videos, fields)

    summary = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source_root": str(ROOT),
        "output_root": str(OUTPUT),
        "total_indexed": len(raw_records),
        "selected": len(final_selected),
        "ignored": len(ignored),
        "duplicate_groups": len(duplicate_groups),
        "videos_indexed_not_linked": len(videos),
        "selected_by_category": Counter(r.category for r in final_selected),
        "selected_by_subarea": Counter(r.subarea for r in final_selected),
        "ignored_by_reason": Counter(r.ignored_reason for r in ignored),
        "records": selected_rows,
        "ignored_records": ignored_rows,
    }
    (REPORTS / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Inventario material complementario organizado",
        "",
        f"Generado: {summary['generated_at']}",
        f"Origen: `{ROOT}`",
        f"Destino: `{OUTPUT}`",
        "",
        "## Resumen",
        "",
        f"- Archivos indexados: {len(raw_records)}",
        f"- Archivos organizados: {len(final_selected)}",
        f"- Archivos ignorados o solo indexados: {len(ignored)}",
        f"- Grupos de duplicados exactos: {len(duplicate_groups)}",
        f"- Videos indexados sin enlazar: {len(videos)}",
        "",
        "## Seleccionados por categoria",
        "",
    ]
    for category, count in Counter(r.category for r in final_selected).most_common():
        lines.append(f"- {category}: {count}")
    lines.extend(["", "## Seleccionados por area", ""])
    for subarea, count in Counter(r.subarea for r in final_selected).most_common():
        lines.append(f"- {subarea}: {count}")
    lines.extend(["", "## Criterios usados", ""])
    lines.extend(
        [
            "- Se excluye la teoria ya organizada para no mezclarla de nuevo.",
            "- Se mantienen documentos de estudio, practicos, esquemas, legislacion, didactica, bibliografia, imagenes utiles y codigo fuente.",
            "- Los videos quedan indexados en `videos_indexados.csv`, pero no se enlazan fisicamente para evitar mover decenas de GB.",
            "- Los duplicados exactos se reducen a una sola copia organizada. La preferencia es V2/2022-2023, luego AUN MAS PRACTICOS/OK 2021 y despues fuentes antiguas.",
            "- Los archivos organizados son hardlinks cuando Windows lo permite, asi que no duplican espacio en disco.",
        ]
    )
    lines.extend(["", "## Archivos de informe", ""])
    lines.extend(
        [
            "- `manifest.csv`: todo lo indexado.",
            "- `seleccionados.csv`: lo que queda organizado.",
            "- `ignorados.csv`: duplicados, videos, binarios y teoria ya organizada.",
            "- `duplicados_exactos.csv`: grupos de archivos identicos.",
            "- `manifest.json`: resumen preparado para una futura subida a Drive/web.",
            "- Las carpetas grandes de video se podan para evitar recorrer decenas de GB; los videos indexados son solo los que aparecen fuera de esas carpetas.",
        ]
    )
    (REPORTS / "INVENTARIO.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({k: v for k, v in summary.items() if k not in {"records", "ignored_records"}}, default=dict, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
