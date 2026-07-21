#!/usr/bin/env python3
"""Audit the static data before publishing the site.

Default mode is local and deterministic: it validates JSON structure, counts,
pending resources, Drive id consistency, and duplicate ids.

Use --check-drive to verify Drive ids and owner-only permissions against the
authenticated rclone remote.
Use --check-http to verify non-Drive URLs over HTTP.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


REPO = Path(__file__).resolve().parents[1]
MATERIALS_JSON = REPO / "data" / "materials.json"
PHASES_JSON = REPO / "data" / "phases.json"
INDEX_HTML = REPO / "index.html"

DEFAULT_TOPIC_COUNT = 74
DEFAULT_PHASE_DRIVE_ROOT = "1Yc0I72JAJi4QfbvPJKyvhSaz2yyxJdRs"
DRIVE_REMOTE = "opo-drive:"

DRIVE_FILE_RE = re.compile(
    r"(?:/file/d/|/document/d/|/spreadsheets/d/|/presentation/d/)([A-Za-z0-9_-]+)"
)
DRIVE_ID_PARAM_RE = re.compile(r"[?&]id=([A-Za-z0-9_-]+)")
DRIVE_FOLDER_RE = re.compile(r"/drive/folders/([A-Za-z0-9_-]+)")
HREF_RE = re.compile(r"""href=["']([^"']+)["']""")
HTTP_OK = range(200, 400)
CANONICAL_TOPIC_SHA256 = "1c36b01723937e2065a09c1a5b7db0c644b0f82e9a84b4ae0307ca940a9de913"
CANONICAL_TOPIC_SOURCE = "BOE-A-1996-3102, suplemento del BOE n.º 38 de 13/02/1996"
OFFICIAL_WRITTEN_TOPIC_TITLE = "Primera prueba - Parte B: Desarrollo por escrito de un tema"
PART_B_PHASE_ID = "01_Primera_prueba_B_Tema_escrito"
ORGANIZATIONAL_MODULE_REFERENCE_URL = (
    "https://www.llegarasalto.com/wp-content/uploads/2025/11/"
    "TABLAS-HORARIAS-GS-NOVIEMBRE_2025.pdf"
)
OFFICIAL_2026_MODULE_REFERENCE_URL = "https://www.borm.es/services/anuncio/841940/pdf"
VALID_SOURCE_KINDS = {
    "archive-private",
    "official-murcia",
    "official-state",
    "private-study",
    "regional-guide",
}
VALID_STATUS_KINDS = {"archive", "current", "done", "historical", "pending", "verified"}
VALID_PROGRESS_STATUSES = {"not-started", "draft", "reviewed", "memorizable", "mock-ready"}
OFFICIAL_HOSTS = {
    "boe.es",
    "borm.es",
    "carm.es",
    "educarm.es",
}
MURCIA_OFFICIAL_HOSTS = {"borm.es", "carm.es", "educarm.es"}
STATE_OFFICIAL_HOSTS = {"boe.es"}
OTHER_CCAA_NAMES = {
    "andalucia",
    "aragon",
    "asturias",
    "baleares",
    "canarias",
    "cantabria",
    "castilla y leon",
    "castilla-la mancha",
    "ceuta",
    "comunidad valenciana",
    "extremadura",
    "galicia",
    "la rioja",
    "madrid",
    "melilla",
    "navarra",
    "pais vasco",
}


@dataclass(frozen=True)
class Finding:
    level: str
    code: str
    location: str
    message: str


class Audit:
    def __init__(self, max_review_age: int = 120) -> None:
        self.findings: list[Finding] = []
        self.stats: Counter[str] = Counter()
        self.drive_refs: dict[str, list[str]] = defaultdict(list)
        self.http_urls: dict[str, list[str]] = defaultdict(list)
        self.max_review_age = max_review_age

    def error(self, code: str, location: str, message: str) -> None:
        self.findings.append(Finding("ERROR", code, location, message))

    def warning(self, code: str, location: str, message: str) -> None:
        self.findings.append(Finding("WARN", code, location, message))

    @property
    def errors(self) -> list[Finding]:
        return [finding for finding in self.findings if finding.level == "ERROR"]


class IndexTopicParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.topics: list[tuple[str, str]] = []
        self.ids: list[str] = []
        self.current: dict[str, list[str]] | None = None
        self.number_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = dict(attrs)
        if attrs_map.get("id"):
            self.ids.append(str(attrs_map["id"]))
        if tag == "li" and "data-topic" in attrs_map:
            self.current = {"all": [], "number": []}
            return
        if self.current is None or tag != "span":
            return
        classes = set((attrs_map.get("class") or "").split())
        if "topic-number" in classes:
            self.number_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if self.current is None:
            return
        if tag == "span" and self.number_depth:
            self.number_depth -= 1
        if tag != "li":
            return
        number = collapse_text(" ".join(self.current["number"])).zfill(2)
        full_text = collapse_text(" ".join(self.current["all"]))
        title = full_text[len(number) :].strip() if full_text.startswith(number) else full_text
        self.topics.append((number, title))
        self.current = None
        self.number_depth = 0

    def handle_data(self, data: str) -> None:
        if self.current is None:
            return
        self.current["all"].append(data)
        if self.number_depth:
            self.current["number"].append(data)


def load_json(path: Path, audit: Audit) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # pragma: no cover - fatal path
        audit.error("json.invalid", str(path.relative_to(REPO)), str(exc))
        return {}


def collapse_text(value: str) -> str:
    return " ".join(value.split())


def normalize_topic_title(value: str) -> str:
    return unicodedata.normalize("NFC", collapse_text(value))


def normalize_ascii_lower(value: Any) -> str:
    return (
        unicodedata.normalize("NFKD", str(value or ""))
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )


def parse_iso_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def url_host(url: str | None) -> str:
    if not url:
        return ""
    return (urlparse(url).hostname or "").lower()


def is_official_host(host: str) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in OFFICIAL_HOSTS)


def host_matches(host: str, domains: set[str]) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in domains)


def validate_verified_date(audit: Audit, location: str, value: Any) -> None:
    verified = parse_iso_date(value)
    if verified is None:
        audit.error("provenance.date.invalid", location, "verifiedAt must use YYYY-MM-DD")
        return
    age = (date.today() - verified).days
    if age < 0:
        audit.error("provenance.date.future", location, f"verifiedAt is {abs(age)} days in the future")
    elif age > audit.max_review_age:
        audit.warning("provenance.date.stale", location, f"Verification is {age} days old")


def validate_source_metadata(audit: Audit, location: str, obj: dict[str, Any]) -> None:
    source_kind = obj.get("sourceKind")
    if source_kind == "official-other-ccaa":
        audit.error("source.other_ccaa", location, "Other CCAA material is not allowed in this Murcia site")
        return
    if source_kind not in VALID_SOURCE_KINDS:
        audit.error("source.kind.invalid", location, f"Invalid or missing sourceKind: {source_kind!r}")
    required_fields(audit, location, obj, ["officialDate", "status", "statusKind", "verifiedAt"])
    if obj.get("statusKind") not in VALID_STATUS_KINDS:
        audit.error("source.status.invalid", location, f"Invalid statusKind: {obj.get('statusKind')!r}")
    validate_verified_date(audit, f"{location}.verifiedAt", obj.get("verifiedAt"))

    host = url_host(obj.get("url"))
    if source_kind == "official-murcia" and not host_matches(host, MURCIA_OFFICIAL_HOSTS):
        audit.error(
            "source.host.mismatch",
            location,
            f"Murcia official source uses a non-CARM/BORM/Educarm host: {host or 'missing'}",
        )
    elif source_kind == "official-state" and not host_matches(host, STATE_OFFICIAL_HOSTS):
        audit.error(
            "source.host.mismatch",
            location,
            f"State official source uses a non-BOE host: {host or 'missing'}",
        )

    audit.stats["sourced_resources"] += 1
    if is_official_host(url_host(obj.get("url"))):
        audit.stats["official_resources"] += 1


def validate_index_topics(materials: dict[str, Any], audit: Audit, expected_topics: int) -> None:
    if not INDEX_HTML.exists():
        audit.error("index.missing", "index.html", "index.html does not exist")
        return

    parser = IndexTopicParser()
    parser.feed(INDEX_HTML.read_text(encoding="utf-8"))
    duplicate_html_ids = [html_id for html_id, count in Counter(parser.ids).items() if count > 1]
    for html_id in duplicate_html_ids:
        audit.error("index.id.duplicate", "index.html", f"Duplicate HTML id {html_id!r}")
    audit.stats["index_topics"] = len(parser.topics)
    if len(parser.topics) != expected_topics:
        audit.error(
            "index.topic_count",
            "index.html",
            f"Expected {expected_topics} topic rows, found {len(parser.topics)}",
        )

    seen: set[str] = set()
    for number, title in parser.topics:
        if number in seen:
            audit.error("index.topic.duplicate", "index.html", f"Duplicate topic number {number}")
        seen.add(number)
        material_title = materials.get("topics", {}).get(number, {}).get("title")
        if normalize_topic_title(title) != normalize_topic_title(str(material_title or "")):
            audit.error(
                "index.topic.title_mismatch",
                f"index.topic.{number}",
                f"HTML title {title!r} differs from materials title {material_title!r}",
            )

    topics = materials.get("topics") or {}
    canonical_text = "\n".join(
        normalize_topic_title(str(topics[key].get("title") or ""))
        for key in sorted(topics, key=int)
    )
    digest = hashlib.sha256(canonical_text.encode("utf-8")).hexdigest()
    if digest != CANONICAL_TOPIC_SHA256:
        audit.error(
            "topics.canonical_mismatch",
            "data/materials.json.topics",
            f"Topic titles differ from {CANONICAL_TOPIC_SOURCE}; digest {digest}",
        )


def validate_revision_metadata(materials: dict[str, Any], phases: dict[str, Any], audit: Audit) -> None:
    material_date = materials.get("verifiedAt")
    phase_date = phases.get("verifiedAt")
    validate_verified_date(audit, "data/materials.json.verifiedAt", material_date)
    validate_verified_date(audit, "data/phases.json.verifiedAt", phase_date)
    required_fields(
        audit,
        "data/materials.json.verification",
        materials.get("verification") or {},
        ["driveLinks", "permissions", "owner"],
    )
    required_fields(
        audit,
        "data/phases.json.verification",
        phases.get("verification") or {},
        ["scope", "officialSources", "note", "driveAccess"],
    )
    access_text = str(phases.get("access") or "")
    if not access_text:
        audit.error("access.missing", "data/phases.json.access", "Missing access description")
    elif "cuando se suba" in normalize_topic_title(access_text).lower():
        audit.error(
            "access.stale",
            "data/phases.json.access",
            "Access text still says that the already uploaded files are pending upload",
        )

    html = INDEX_HTML.read_text(encoding="utf-8") if INDEX_HTML.exists() else ""
    match = re.search(r'<meta\s+name=["\']last-reviewed["\']\s+content=["\']([^"\']+)', html)
    html_date = match.group(1) if match else None
    if not html_date:
        audit.error("revision.html.missing", "index.html", "Missing last-reviewed metadata")
    elif html_date != material_date or html_date != phase_date:
        audit.error(
            "revision.date.mismatch",
            "index.html",
            f"HTML {html_date}, materials {material_date}, phases {phase_date}",
        )


def validate_exam_and_module_metadata(phases_data: dict[str, Any], audit: Audit) -> None:
    phases = phases_data.get("phases") or []
    phase_by_id = {
        phase.get("id"): phase
        for phase in phases
        if isinstance(phase, dict) and phase.get("id")
    }
    written_topic = phase_by_id.get("01_Primera_prueba_B_Tema_escrito") or {}
    if written_topic.get("title") != OFFICIAL_WRITTEN_TOPIC_TITLE:
        audit.error(
            "exam.title.non_official",
            "phases.01_Primera_prueba_B_Tema_escrito.title",
            f"Expected official wording: {OFFICIAL_WRITTEN_TOPIC_TITLE}",
        )

    html = INDEX_HTML.read_text(encoding="utf-8") if INDEX_HTML.exists() else ""
    if "Parte B: Desarrollo por escrito de un tema" not in html:
        audit.error(
            "exam.title.html.non_official",
            "index.html",
            "The Part B heading must use the official BORM wording",
        )

    module = phases_data.get("selectedModule") or {}
    expected_module = {
        "code": "0373",
        "course": "1.º curso",
        "current_total_hours": "135 horas",
        "planning_course": "2026/2027",
    }
    for key, expected in expected_module.items():
        if module.get(key) != expected:
            audit.error(
                "module.reference.mismatch",
                f"data/phases.json.selectedModule.{key}",
                f"Expected {expected!r}, found {module.get(key)!r}",
            )
    if not str(module.get("weekly_hours") or "").startswith("4 horas semanales"):
        audit.error(
            "module.reference.mismatch",
            "data/phases.json.selectedModule.weekly_hours",
            "The November 2025 Murcia table assigns 4 weekly hours to module 0373",
        )
    if "pendiente de confirmación" not in str(module.get("weekly_hours") or "").lower():
        audit.error(
            "module.weekly_hours.overclaim",
            "data/phases.json.selectedModule.weekly_hours",
            "The 4 weekly hours must be identified as pending confirmation for DAW 2026/2027",
        )
    if "no dato oficial confirmado" not in str(module.get("weekly_hours_status") or "").lower():
        audit.error(
            "module.weekly_hours.status",
            "data/phases.json.selectedModule.weekly_hours_status",
            "Missing the non-official status of the 2026/2027 weekly distribution",
        )

    legal_urls = {
        source.get("url")
        for source in phases_data.get("legalSources") or []
        if isinstance(source, dict)
    }
    if ORGANIZATIONAL_MODULE_REFERENCE_URL not in legal_urls:
        audit.error(
            "module.reference.missing",
            "data/phases.json.legalSources",
            "Missing the November 2025 Murcia timetable used for course and hours",
        )
    if OFFICIAL_2026_MODULE_REFERENCE_URL not in legal_urls:
        audit.error(
            "module.reference.2026.missing",
            "data/phases.json.legalSources",
            "Missing the official March 2026 BORM reference applicable from 2026/2027",
        )
    if not any("BOE-A-2024-10685" in str(url or "") for url in legal_urls):
        audit.error(
            "module.attribution.missing",
            "data/phases.json.legalSources",
            "Missing RD 500/2024, which assigns module 0373 to Informática",
        )


def validate_part_b_compaction(
    materials_data: dict[str, Any], phases_data: dict[str, Any], audit: Audit
) -> None:
    topics = materials_data.get("topics") or {}
    phase = next(
        (
            item
            for item in phases_data.get("phases") or []
            if isinstance(item, dict) and item.get("id") == PART_B_PHASE_ID
        ),
        {},
    )
    catalog = phase.get("embeddedTopicCatalog") or {}
    if catalog.get("source") != "data/materials.json":
        audit.error(
            "part_b.catalog.source",
            f"phases.{PART_B_PHASE_ID}.embeddedTopicCatalog",
            "Part B must use data/materials.json as its compact topic catalog",
        )
    if catalog.get("position") != "before-complements":
        audit.error(
            "part_b.catalog.position",
            f"phases.{PART_B_PHASE_ID}.embeddedTopicCatalog",
            "The compact official syllabus must appear before complementary resources",
        )
    if catalog.get("topicCount") != len(topics):
        audit.error(
            "part_b.catalog.count",
            f"phases.{PART_B_PHASE_ID}.embeddedTopicCatalog",
            f"Expected {len(topics)} embedded topics, found {catalog.get('topicCount')}",
        )

    material_drive_ids = {
        material.get("driveFileId")
        for topic in topics.values()
        if isinstance(topic, dict)
        for material in topic.get("materials") or []
        if isinstance(material, dict) and material.get("driveFileId")
    }
    repeated = []
    for index, resource in enumerate(phase.get("resources") or []):
        drive_id = resource.get("driveFileId") if isinstance(resource, dict) else None
        if drive_id and drive_id in material_drive_ids:
            repeated.append((index, drive_id))
    if repeated:
        audit.error(
            "part_b.resource.redundant",
            f"phases.{PART_B_PHASE_ID}.resources",
            f"{len(repeated)} resources already exist in the compact official syllabus",
        )

    resources = phase.get("resources") or []
    introductions = [
        resource
        for resource in resources
        if isinstance(resource, dict) and resource.get("type") == "introduccion"
    ]
    general_resources = [
        resource
        for resource in resources
        if not isinstance(resource, dict) or resource.get("type") != "introduccion"
    ]
    audit.stats["part_b_complements"] = len(resources)
    audit.stats["part_b_introductions"] = len(introductions)
    audit.stats["part_b_general_resources"] = len(general_resources)
    if len(introductions) != 17:
        audit.error(
            "part_b.introductions.count",
            f"phases.{PART_B_PHASE_ID}.resources",
            f"Expected 17 topic introductions, found {len(introductions)}",
        )
    if len(general_resources) != 5:
        audit.error(
            "part_b.general_resources.count",
            f"phases.{PART_B_PHASE_ID}.resources",
            f"Expected 5 general criteria and schemes, found {len(general_resources)}",
        )
    for introduction in introductions:
        resource_index = resources.index(introduction)
        related_topics = introduction.get("relatedTopics")
        if not related_topics:
            audit.error(
                "part_b.introduction.unlinked",
                f"phases.{PART_B_PHASE_ID}.resources[{resource_index}]",
                "Every introduction must be linked to at least one exact BOE topic",
            )
        if introduction.get("relationBasis") != "exacta":
            audit.error(
                "part_b.introduction.inexact",
                f"phases.{PART_B_PHASE_ID}.resources[{resource_index}]",
                "Topic introductions must use an exact relationship",
            )
    html = INDEX_HTML.read_text(encoding="utf-8") if INDEX_HTML.exists() else ""
    if "Parte B · Tema escrito" not in html or "Temario oficial" not in html:
        audit.error(
            "part_b.view.missing",
            "index.html",
            "The main Part B view must identify the compact official syllabus",
        )


def extract_drive_file_id(url: str | None) -> str | None:
    if not url:
        return None
    match = DRIVE_FILE_RE.search(url)
    if match:
        return match.group(1)
    match = DRIVE_ID_PARAM_RE.search(url)
    if match:
        return match.group(1)
    return None


def extract_drive_folder_ids(text: str | None) -> list[str]:
    if not text:
        return []
    return DRIVE_FOLDER_RE.findall(text)


def is_drive_url(url: str | None) -> bool:
    return bool(url and ("drive.google.com" in url or "docs.google.com" in url))


def required_fields(
    audit: Audit,
    location: str,
    obj: dict[str, Any],
    fields: list[str],
) -> None:
    for field in fields:
        value = obj.get(field)
        if value is None or value == "":
            audit.error("field.missing", location, f"Missing required field: {field}")


def validate_url_and_drive_id(
    audit: Audit,
    location: str,
    obj: dict[str, Any],
    require_drive_id: bool,
) -> None:
    url = obj.get("url")
    if not url:
        audit.error("resource.pending", location, "Missing URL")
        return

    if obj.get("urlMode") == "drive-title-search":
        audit.error("resource.pending", location, "URL still opens a Drive title search")

    if is_drive_url(url):
        url_id = extract_drive_file_id(url)
        field_id = obj.get("driveFileId")
        if require_drive_id and not field_id:
            audit.error("drive.id.missing", location, "Drive URL has no driveFileId")
        if not url_id:
            audit.error("drive.url.invalid", location, f"Cannot parse Drive file id from URL: {url}")
        elif field_id and url_id != field_id:
            audit.error(
                "drive.id.mismatch",
                location,
                f"URL id {url_id} does not match driveFileId {field_id}",
            )
        drive_id = field_id or url_id
        if drive_id:
            audit.drive_refs[drive_id].append(location)
    else:
        audit.http_urls[url].append(location)


def collect_reference_url(audit: Audit, location: str, url: str | None) -> None:
    if not url or not url.startswith(("http://", "https://")):
        return
    if is_drive_url(url):
        drive_id = extract_drive_file_id(url)
        if drive_id:
            audit.drive_refs[drive_id].append(location)
        return
    audit.http_urls[url].append(location)


def validate_materials(materials: dict[str, Any], audit: Audit, expected_topics: int) -> None:
    topics = materials.get("topics")
    if not isinstance(topics, dict):
        audit.error("materials.topics.invalid", "data/materials.json", "topics must be an object")
        return

    audit.stats["topics"] = len(topics)
    if len(topics) != expected_topics:
        audit.error(
            "materials.topic_count",
            "data/materials.json",
            f"Expected {expected_topics} topics, found {len(topics)}",
        )

    duplicate_ids: dict[str, list[str]] = defaultdict(list)
    developed_example_topics: set[int] = set()
    memory_sheet_count = 0
    progress = materials.get("myTopicProgress") or {}
    required_fields(
        audit,
        "data/materials.json.myTopicProgress",
        progress,
        [
            "updatedAt",
            "statusOptions",
            "scoringNote",
            "backupFolderId",
            "backupFolderUrl",
            "backupAccess",
            "backupFileName",
        ],
    )
    backup_folder_id = str(progress.get("backupFolderId") or "")
    backup_folder_url = str(progress.get("backupFolderUrl") or "")
    backup_url_ids = extract_drive_folder_ids(backup_folder_url)
    if backup_url_ids != [backup_folder_id]:
        audit.error(
            "progress.backup.folder_mismatch",
            "data/materials.json.myTopicProgress",
            f"Backup folder URL and id do not match: {backup_folder_url!r} / {backup_folder_id!r}",
        )
    elif backup_folder_id:
        audit.drive_refs[backup_folder_id].append("materials.myTopicProgress.backupFolderUrl")
    if progress.get("backupAccess") != "private-owner-only":
        audit.error(
            "progress.backup.access",
            "data/materials.json.myTopicProgress.backupAccess",
            "The progress backup folder must be labelled private-owner-only",
        )
    if not str(progress.get("backupFileName") or "").endswith(".json"):
        audit.error(
            "progress.backup.filename",
            "data/materials.json.myTopicProgress.backupFileName",
            "The progress backup filename must use the .json extension",
        )
    status_options = progress.get("statusOptions") or []
    status_values = {
        option.get("value")
        for option in status_options
        if isinstance(option, dict) and option.get("value") and option.get("label")
    }
    if status_values != VALID_PROGRESS_STATUSES:
        audit.error(
            "progress.statuses.invalid",
            "data/materials.json.myTopicProgress.statusOptions",
            f"Expected {sorted(VALID_PROGRESS_STATUSES)}, found {sorted(status_values)}",
        )

    for topic_key, topic in sorted(topics.items()):
        location = f"materials.topics.{topic_key}"
        if not isinstance(topic, dict):
            audit.error("materials.topic.invalid", location, "Topic must be an object")
            continue
        if str(topic.get("number", "")).zfill(2) != str(topic_key).zfill(2):
            audit.error("materials.topic.number", location, "Topic key and number do not match")
        materials_list = topic.get("materials")
        if not isinstance(materials_list, list) or not materials_list:
            audit.error("materials.topic.empty", location, "Topic has no materials")
            continue

        academy_counts = Counter(
            str(material.get("academy") or "")
            for material in materials_list
            if isinstance(material, dict)
        )
        if academy_counts["Preparador online"] != 1:
            audit.error(
                "materials.preparador.count",
                location,
                f"Expected one curated Preparador online version, found {academy_counts['Preparador online']}",
            )
        if academy_counts["Mi temario"] != 1:
            audit.error(
                "materials.my_topic.count",
                location,
                f"Expected one private editable topic, found {academy_counts['Mi temario']}",
            )

        for index, material in enumerate(materials_list):
            item_location = f"{location}.materials[{index}]"
            if not isinstance(material, dict):
                audit.error("materials.item.invalid", item_location, "Material must be an object")
                continue
            audit.stats["materials"] += 1
            required_fields(
                audit,
                item_location,
                material,
                ["academy", "label", "type", "fileName", "extension", "url", "urlMode"],
            )
            if material.get("extension") == ".pdf":
                audit.stats["materials_pdf"] += 1
            if material.get("urlMode") == "drive-pdf-preview":
                audit.stats["materials_preview"] += 1
            if material.get("urlMode") == "drive-title-search" or not material.get("url"):
                audit.stats["materials_pending"] += 1

            validate_url_and_drive_id(audit, item_location, material, require_drive_id=True)
            drive_id = material.get("driveFileId")
            if drive_id:
                duplicate_ids[drive_id].append(item_location)

            if material.get("urlMode") == "drive-pdf-preview" and material.get("extension") != ".pdf":
                audit.error("materials.pdf.expected", item_location, "PDF preview points to a non-PDF material")
            pages = material.get("pages")
            if material.get("extension") == ".pdf" and (not isinstance(pages, int) or pages <= 0):
                audit.error("materials.pages.invalid", item_location, "PDF material must have a positive page count")
            if material.get("academy") == "Mi temario":
                if material.get("urlMode") != "google-doc-edit":
                    audit.error("materials.my_topic.mode", item_location, "My topic must open in Google Docs edit mode")
                if material.get("access") != "private-owner-only":
                    audit.error("materials.my_topic.access", item_location, "My topic must be labelled private-owner-only")
                if material.get("initialStudyStatus") not in VALID_PROGRESS_STATUSES:
                    audit.error(
                        "materials.my_topic.progress",
                        item_location,
                        "My topic has no valid initialStudyStatus",
                    )
            if material.get("academy") == "Ejemplos míos":
                if material.get("urlMode") != "google-doc-edit":
                    audit.error(
                        "materials.my_example.mode",
                        item_location,
                        "My example must open in Google Docs edit mode",
                    )
                if material.get("access") != "private-owner-only":
                    audit.error(
                        "materials.my_example.access",
                        item_location,
                        "My example must be labelled private-owner-only",
                    )
                variant = material.get("variant")
                if variant == "tema-desarrollado":
                    developed_example_topics.add(int(topic_key))
                    if "codex" not in str(material.get("authorship") or "").lower():
                        audit.error(
                            "materials.my_example.authorship",
                            item_location,
                            "Developed examples must disclose Codex authorship",
                        )
                    if not material.get("sourceReferences"):
                        audit.error(
                            "materials.my_example.sources",
                            item_location,
                            "Developed examples must declare sourceReferences",
                        )
                elif variant == "memorizacion":
                    memory_sheet_count += 1

    for drive_id, locations in duplicate_ids.items():
        if len(locations) > 1:
            audit.error("drive.id.duplicate.materials", locations[0], f"Duplicate material Drive id {drive_id}: {locations}")

    declared = materials.get("materialCount")
    if declared is not None and declared != audit.stats["materials"]:
        audit.error(
            "materials.count.declared",
            "data/materials.json.materialCount",
            f"Declared {declared}, counted {audit.stats['materials']}",
        )

    example_blocks = [(1, 14), (15, 22), (23, 33), (34, 47), (48, 60), (61, 74)]
    for start, end in example_blocks:
        if not any(start <= topic_number <= end for topic_number in developed_example_topics):
            audit.error(
                "materials.my_example.block_missing",
                "data/materials.json.myTopicProgress",
                f"Missing a developed example for the topic block {start}-{end}",
            )

    declared_example_topics = progress.get("exampleTopics")
    actual_example_topics = sorted(developed_example_topics)
    if declared_example_topics != actual_example_topics:
        audit.error(
            "progress.example_topics.invalid",
            "data/materials.json.myTopicProgress.exampleTopics",
            f"Declared {declared_example_topics}, found {actual_example_topics}",
        )
    if progress.get("examplesAvailable") != len(actual_example_topics):
        audit.error(
            "progress.example_count.invalid",
            "data/materials.json.myTopicProgress.examplesAvailable",
            f"Declared {progress.get('examplesAvailable')}, found {len(actual_example_topics)}",
        )
    if progress.get("memorySheetsAvailable") != memory_sheet_count:
        audit.error(
            "progress.memory_count.invalid",
            "data/materials.json.myTopicProgress.memorySheetsAvailable",
            f"Declared {progress.get('memorySheetsAvailable')}, found {memory_sheet_count}",
        )


def count_by(items: list[dict[str, Any]], key: str, default: str = "General") -> Counter[str]:
    return Counter(str(item.get(key) or default) for item in items)


def validate_resource_curation(audit: Audit, location: str, resource: dict[str, Any]) -> None:
    source_kind = resource.get("sourceKind")
    if source_kind not in VALID_SOURCE_KINDS:
        audit.error("resource.source_kind.invalid", location, f"Invalid or missing sourceKind: {source_kind!r}")

    display_title = str(resource.get("displayTitle") or "").strip()
    if not display_title:
        audit.error("resource.display_title.missing", location, "Missing curated displayTitle")
    elif re.search(r"\.(?:pdf|docx?|odt|rtf|html?|xlsx?|pptx?|jpe?g|png|zip|rar)$", display_title, re.I):
        audit.error("resource.display_title.extension", location, f"Display title keeps a file extension: {display_title!r}")
    elif "__" in display_title or re.search(r"\s\([1-9]\d?\)$", display_title):
        audit.error("resource.display_title.copy_suffix", location, f"Display title keeps a copy suffix: {display_title!r}")

    if not isinstance(resource.get("hasSolution"), bool):
        audit.error("resource.solution_flag.invalid", location, "hasSolution must be boolean")

    related_topics = resource.get("relatedTopics")
    if not isinstance(related_topics, list):
        audit.error("resource.related_topics.invalid", location, "relatedTopics must be a list")
    else:
        invalid_topics = [topic for topic in related_topics if not isinstance(topic, int) or not 1 <= topic <= 74]
        if invalid_topics:
            audit.error(
                "resource.related_topics.range",
                location,
                f"Invalid related topic values: {invalid_topics}",
            )

    publication_year = resource.get("publicationYear")
    if publication_year is not None and (
        not isinstance(publication_year, int) or not 1900 <= publication_year <= date.today().year
    ):
        audit.error("resource.publication_year.invalid", location, f"Invalid publicationYear: {publication_year!r}")

    if source_kind == "private-study":
        required_fields(audit, location, resource, ["contentStatus", "cataloguedAt"])
        validate_verified_date(audit, f"{location}.cataloguedAt", resource.get("cataloguedAt"))
        if not is_drive_url(resource.get("url")):
            audit.error("resource.private.not_drive", location, "Private study material must use a Drive URL")


def validate_count_list(
    audit: Audit,
    location: str,
    declared: Any,
    actual: Counter[str],
) -> None:
    if not isinstance(declared, list):
        audit.error("phase.counts.invalid", location, "Declared count block must be a list")
        return
    declared_map = {str(item.get("name")): item.get("count") for item in declared if isinstance(item, dict)}
    actual_map = dict(actual)
    if declared_map != actual_map:
        audit.error("phase.counts.mismatch", location, f"Declared {declared_map}, counted {actual_map}")


def validate_phases(phases_data: dict[str, Any], audit: Audit) -> None:
    phases = phases_data.get("phases")
    if not isinstance(phases, list):
        audit.error("phases.invalid", "data/phases.json", "phases must be a list")
        return

    audit.stats["phases"] = len(phases)
    phase_ids: set[str] = set()
    total_resources = 0
    total_public = 0

    for phase_index, phase in enumerate(phases):
        location = f"phases[{phase_index}]"
        if not isinstance(phase, dict):
            audit.error("phase.invalid", location, "Phase must be an object")
            continue
        phase_id = phase.get("id")
        if not phase_id:
            audit.error("phase.id.missing", location, "Phase has no id")
        elif phase_id in phase_ids:
            audit.error("phase.id.duplicate", location, f"Duplicate phase id {phase_id}")
        else:
            phase_ids.add(phase_id)

        resources = phase.get("resources") or []
        if not isinstance(resources, list):
            audit.error("phase.resources.invalid", location, "resources must be a list")
            continue

        practice_guides = phase.get("practiceGuides")
        if practice_guides is not None:
            if not isinstance(practice_guides, list) or not practice_guides:
                audit.error("practice_guides.invalid", f"{location}.practiceGuides", "practiceGuides must be a non-empty list")
            else:
                authorship = phase.get("authorship") or {}
                if authorship.get("createdWith") != "Codex":
                    audit.error(
                        "practice_guides.authorship",
                        f"{location}.authorship",
                        "Practice solutions must declare createdWith=Codex",
                    )

                guide_ids: set[str] = set()
                for guide_index, guide in enumerate(practice_guides):
                    guide_location = f"{location}.practiceGuides[{guide_index}]"
                    if not isinstance(guide, dict):
                        audit.error("practice_guide.invalid", guide_location, "Practice guide must be an object")
                        continue

                    required_fields(
                        audit,
                        guide_location,
                        guide,
                        ["id", "name", "priority", "frequency", "whatFalls", "method", "errors", "example"],
                    )
                    guide_id = guide.get("id")
                    if guide_id in guide_ids:
                        audit.error("practice_guide.id.duplicate", guide_location, f"Duplicate practice guide id {guide_id}")
                    elif guide_id:
                        guide_ids.add(guide_id)

                    for field in ("whatFalls", "method", "errors"):
                        value = guide.get(field)
                        if not isinstance(value, list) or not value or not all(isinstance(item, str) and item.strip() for item in value):
                            audit.error(
                                "practice_guide.list.invalid",
                                f"{guide_location}.{field}",
                                f"{field} must be a non-empty list of strings",
                            )

                    example = guide.get("example")
                    if not isinstance(example, dict):
                        audit.error("practice_guide.example.invalid", f"{guide_location}.example", "example must be an object")
                    else:
                        required_fields(
                            audit,
                            f"{guide_location}.example",
                            example,
                            ["statement", "solution", "explanation"],
                        )
                    audit.stats["practice_guides"] += 1

        source_years = phase.get("sourceYears")
        if source_years is not None:
            if not isinstance(source_years, list) or not source_years:
                audit.error("source_years.invalid", f"{location}.sourceYears", "sourceYears must be a non-empty list")
            else:
                seen_years: set[str] = set()
                for source_index, source in enumerate(source_years):
                    source_location = f"{location}.sourceYears[{source_index}]"
                    if not isinstance(source, dict):
                        audit.error("source.invalid", source_location, "Source year must be an object")
                        continue
                    required_fields(
                        audit,
                        source_location,
                        source,
                        ["year", "title", "summary", "url", "sourceKind"],
                    )
                    year = str(source.get("year") or "")
                    if year in seen_years:
                        audit.error("source_years.duplicate", source_location, f"Duplicate source year {year}")
                    seen_years.add(year)
                    validate_source_metadata(audit, source_location, source)
                    collect_reference_url(audit, f"{source_location}.url", source.get("url"))

        duplicate_ids: dict[str, list[str]] = defaultdict(list)
        display_titles: dict[tuple[str, str], list[str]] = defaultdict(list)
        public_count = 0
        for resource_index, resource in enumerate(resources):
            item_location = f"{location}.resources[{resource_index}]"
            if not isinstance(resource, dict):
                audit.error("phase.resource.invalid", item_location, "Resource must be an object")
                continue
            audit.stats["phase_resources"] += 1
            required_fields(
                audit,
                item_location,
                resource,
                ["title", "phase", "section", "type", "academy", "topic", "area", "url", "urlMode"],
            )
            validate_resource_curation(audit, item_location, resource)
            if (
                phase_id == "02_Primera_prueba_A_Practico"
                and resource.get("sourceKind") == "private-study"
                and normalize_ascii_lower(resource.get("area")) != "general"
                and not resource.get("relatedTopics")
            ):
                audit.error(
                    "resource.practical.unlinked",
                    item_location,
                    "Area-specific practical material must be linked to BOE topics",
                )
            if resource.get("phase") != phase_id:
                audit.error("phase.resource.phase_mismatch", item_location, "Resource phase does not match parent phase")
            if resource.get("hasPublicLink") is not True:
                audit.error("resource.pending", item_location, "Resource hasPublicLink is not true")
            if resource.get("url"):
                public_count += 1
            validate_url_and_drive_id(audit, item_location, resource, require_drive_id=is_drive_url(resource.get("url")))

            resource_url = resource.get("url")
            if resource_url and resource_url.startswith(("http://", "https://")) and not is_drive_url(resource_url):
                validate_source_metadata(audit, item_location, resource)

            title_and_note = normalize_ascii_lower(
                f"{resource.get('title') or ''} {resource.get('note') or ''}"
            )
            if (
                any(region in title_and_note for region in OTHER_CCAA_NAMES)
                and re.search(
                    r"oposicion|convocatoria|criterio|prueba|examen|tribunal|curriculo|normativa|decreto|orden|boja",
                    title_and_note,
                )
            ):
                audit.error(
                    "source.other_ccaa",
                    item_location,
                    "Opposition or normative material from another CCAA is not allowed",
                )

            if phase_id == "00_Normativa_y_orden_legal":
                normalized_title = normalize_ascii_lower(resource.get("title"))
                if "andalucia" in normalized_title or "boja" in normalized_title:
                    audit.error(
                        "source.normativa.out_of_scope",
                        item_location,
                        "Andalusia material must not appear in the Murcia normative view",
                    )
                if resource.get("sourceKind") == "archive-private" and resource.get("statusKind") != "archive":
                    audit.error(
                        "source.archive.status",
                        item_location,
                        "Private normative references must be labelled as archive",
                    )
                if resource.get("sourceKind") == "archive-private":
                    required_fields(audit, item_location, resource, ["reviewedAt", "note"])
                    validate_verified_date(
                        audit,
                        f"{item_location}.reviewedAt",
                        resource.get("reviewedAt"),
                    )
                if (
                    str(resource.get("sourceKind") or "").startswith("official-")
                    and resource.get("statusKind") == "historical"
                    and not re.search(
                        r"cerrad|historic|convocatoria|anterior",
                        normalize_ascii_lower(resource.get("status")),
                    )
                ):
                    audit.error(
                        "source.normativa.status",
                        item_location,
                        "An official normative source cannot be made historical from its title year alone",
                    )

            drive_id = resource.get("driveFileId")
            if drive_id:
                duplicate_ids[drive_id].append(item_location)
            display_key = (
                normalize_ascii_lower(resource.get("section")),
                normalize_ascii_lower(resource.get("displayTitle")),
            )
            display_titles[display_key].append(item_location)

        total_resources += len(resources)
        total_public += public_count

        if phase.get("resourceCount") != len(resources):
            audit.error(
                "phase.resource_count",
                f"{location}.resourceCount",
                f"Declared {phase.get('resourceCount')}, counted {len(resources)}",
            )
        if phase.get("publicLinkCount") != public_count:
            audit.error(
                "phase.public_count",
                f"{location}.publicLinkCount",
                f"Declared {phase.get('publicLinkCount')}, counted {public_count}",
            )

        validate_count_list(audit, f"{location}.sections", phase.get("sections"), count_by(resources, "section"))
        validate_count_list(audit, f"{location}.academies", phase.get("academies"), count_by(resources, "academy"))
        validate_count_list(audit, f"{location}.types", phase.get("types"), count_by(resources, "type"))

        for drive_id, locations in duplicate_ids.items():
            if len(locations) > 1:
                audit.error("drive.id.duplicate.phase", locations[0], f"Duplicate phase Drive id {drive_id}: {locations}")
        for (_, display_title), locations in display_titles.items():
            if display_title and len(locations) > 1:
                audit.error(
                    "resource.display_title.duplicate",
                    locations[0],
                    f"Duplicate curated title within a section: {locations}",
                )

    if phases_data.get("totalResources") != total_resources:
        audit.error(
            "phases.total_resources",
            "data/phases.json.totalResources",
            f"Declared {phases_data.get('totalResources')}, counted {total_resources}",
        )
    if phases_data.get("publicLinkCount") != total_public:
        audit.error(
            "phases.public_link_count",
            "data/phases.json.publicLinkCount",
            f"Declared {phases_data.get('publicLinkCount')}, counted {total_public}",
        )

    for index, source in enumerate(phases_data.get("legalSources") or []):
        source_location = f"phases.legalSources[{index}]"
        if not isinstance(source, dict):
            audit.error("source.invalid", source_location, "Legal source must be an object")
            continue
        required_fields(
            audit,
            source_location,
            source,
            ["nivel", "norma", "relevancia", "url", "sourceKind"],
        )
        validate_source_metadata(audit, source_location, source)
        collect_reference_url(audit, f"{source_location}.url", source.get("url"))


def collect_index_urls(audit: Audit) -> None:
    if not INDEX_HTML.exists():
        return
    text = INDEX_HTML.read_text(encoding="utf-8")
    for index, match in enumerate(HREF_RE.finditer(text)):
        collect_reference_url(audit, f"index.href[{index}]", match.group(1))


def validate_cross_view_duplicates(audit: Audit, strict: bool) -> None:
    duplicate_refs = {drive_id: locations for drive_id, locations in audit.drive_refs.items() if len(locations) > 1}
    audit.stats["unique_drive_ids"] = len(audit.drive_refs)
    audit.stats["reused_drive_ids"] = len(duplicate_refs)
    if strict:
        for drive_id, locations in duplicate_refs.items():
            audit.error("drive.id.duplicate.global", locations[0], f"Drive id {drive_id} reused at {locations}")


def collect_folder_ids(materials: dict[str, Any], extra_ids: list[str]) -> list[str]:
    folder_ids: list[str] = []

    def add(value: str | None) -> None:
        if not value:
            return
        if re.fullmatch(r"[A-Za-z0-9_-]+", value):
            if value not in folder_ids:
                folder_ids.append(value)
            return
        for folder_id in extract_drive_folder_ids(value):
            if folder_id not in folder_ids:
                folder_ids.append(folder_id)

    add(materials.get("driveFolderId"))
    add(materials.get("driveRootUrl"))
    progress = materials.get("myTopicProgress") or {}
    add(progress.get("backupFolderId"))
    add(progress.get("backupFolderUrl"))

    for topic in (materials.get("topics") or {}).values():
        for material in topic.get("materials", []):
            add(material.get("driveFolderUrl"))

    if INDEX_HTML.exists():
        add(INDEX_HTML.read_text(encoding="utf-8"))

    for folder_id in extra_ids:
        add(folder_id)

    if DEFAULT_PHASE_DRIVE_ROOT not in folder_ids:
        folder_ids.append(DEFAULT_PHASE_DRIVE_ROOT)

    return folder_ids


def rclone_list_entries(remote: str, folder_id: str) -> dict[str, dict[str, Any]]:
    command = [
        "rclone",
        "lsjson",
        "--drive-root-folder-id",
        folder_id,
        remote,
        "-R",
        "--fast-list",
        "--metadata",
        "--drive-metadata-owner=read",
        "--drive-metadata-permissions=read",
    ]
    proc = subprocess.run(command, check=True, text=True, capture_output=True)
    entries = json.loads(proc.stdout)
    return {
        entry["ID"]: entry
        for entry in entries
        if isinstance(entry, dict) and entry.get("ID")
    }


def parse_drive_permissions(entry: dict[str, Any]) -> list[dict[str, Any]] | None:
    raw = (entry.get("Metadata") or {}).get("permissions")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, list) or not all(isinstance(item, dict) for item in raw):
        return None
    return raw


def validate_drive_permissions(
    audit: Audit,
    entries: dict[str, dict[str, Any]],
    owner: str,
) -> None:
    for drive_id, locations in audit.drive_refs.items():
        entry = entries.get(drive_id)
        if not entry:
            continue
        location = locations[0]
        metadata = entry.get("Metadata") or {}
        entry_owner = metadata.get("owner")
        if entry_owner != owner:
            audit.error(
                "drive.owner.mismatch",
                location,
                f"Drive owner is {entry_owner!r}, expected {owner!r}",
            )

        permissions = parse_drive_permissions(entry)
        if permissions is None:
            audit.error(
                "drive.permissions.unreadable",
                location,
                "Drive permissions metadata is missing or invalid",
            )
            continue

        allowed_owner = [
            permission
            for permission in permissions
            if permission.get("type") == "user"
            and permission.get("role") == "owner"
            and permission.get("emailAddress") == owner
        ]
        unexpected = [permission for permission in permissions if permission not in allowed_owner]
        if len(allowed_owner) != 1 or unexpected:
            public_or_shared = [
                {
                    key: permission.get(key)
                    for key in ("type", "role", "emailAddress", "domain")
                    if permission.get(key) is not None
                }
                for permission in unexpected
            ]
            audit.error(
                "drive.permissions.not_private",
                location,
                f"Expected owner-only access; extra permissions: {public_or_shared}",
            )
            continue
        audit.stats["drive_permissions_checked"] += 1


def check_drive(
    audit: Audit,
    materials: dict[str, Any],
    remote: str,
    extra_folder_ids: list[str],
    owner: str,
) -> None:
    if shutil.which("rclone") is None:
        audit.error("drive.rclone.missing", "rclone", "rclone is required for --check-drive")
        return

    folder_ids = collect_folder_ids(materials, extra_folder_ids)
    audit.stats["drive_folders_checked"] = len(folder_ids)
    available_entries: dict[str, dict[str, Any]] = {}

    for folder_id in folder_ids:
        try:
            available_entries.update(rclone_list_entries(remote, folder_id))
        except subprocess.CalledProcessError as exc:
            audit.error(
                "drive.folder.unreadable",
                folder_id,
                (exc.stderr or exc.stdout or str(exc)).strip(),
            )
        except (json.JSONDecodeError, TypeError) as exc:
            audit.error("drive.folder.invalid_json", folder_id, str(exc))

    missing = sorted(set(audit.drive_refs) - set(available_entries))
    audit.stats["drive_ids_required"] = len(audit.drive_refs)
    audit.stats["drive_ids_available"] = len(set(audit.drive_refs) & set(available_entries))
    if missing:
        for drive_id in missing[:20]:
            audit.error("drive.id.unavailable", audit.drive_refs[drive_id][0], f"Drive id is not visible to rclone: {drive_id}")
        if len(missing) > 20:
            audit.error("drive.id.unavailable", "drive", f"{len(missing) - 20} more Drive ids unavailable")
    validate_drive_permissions(audit, available_entries, owner)


def check_one_http_url(url: str, timeout: float) -> tuple[bool, str]:
    headers = {"User-Agent": "opo-diegoayala-audit/1.0"}
    for method, extra_headers in (("HEAD", {}), ("GET", {"Range": "bytes=0-0"})):
        request = urllib.request.Request(url, method=method, headers={**headers, **extra_headers})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = response.status
                if status in HTTP_OK:
                    return True, str(status)
                last = str(status)
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}"
            if method == "HEAD" and exc.code in {405, 403, 501}:
                continue
        except Exception as exc:
            last = exc.__class__.__name__ + ": " + str(exc)
            if method == "HEAD":
                continue
    return False, last


def check_http(audit: Audit, timeout: float) -> None:
    urls = sorted(url for url in audit.http_urls if url.startswith(("http://", "https://")))
    audit.stats["http_urls_checked"] = len(urls)
    for url in urls:
        ok, detail = check_one_http_url(url, timeout)
        if not ok:
            audit.error("http.url.broken", audit.http_urls[url][0], f"{url} failed: {detail}")


def print_report(audit: Audit) -> None:
    print("Audit summary")
    print(f"- topics: {audit.stats['topics']}")
    print(
        "- official topic index: "
        f"{audit.stats['index_topics']} HTML rows, canonical BOE titles verified"
    )
    print(
        "- materials: "
        f"{audit.stats['materials']} total, "
        f"{audit.stats['materials_pdf']} PDF, "
        f"{audit.stats['materials_preview']} Drive preview, "
        f"{audit.stats['materials_pending']} pending"
    )
    print(f"- phases: {audit.stats['phases']}")
    print(f"- phase resources: {audit.stats['phase_resources']}")
    print(f"- Part B unique complements: {audit.stats['part_b_complements']}")
    print(
        "- Part B organization: "
        f"{audit.stats['part_b_introductions']} introductions integrated by topic, "
        f"{audit.stats['part_b_general_resources']} general resources"
    )
    print(f"- practical solution guides: {audit.stats['practice_guides']}")
    print(
        "- sourced references: "
        f"{audit.stats['sourced_resources']} described, "
        f"{audit.stats['official_resources']} on official domains"
    )
    print(
        "- Drive ids: "
        f"{audit.stats['unique_drive_ids']} unique, "
        f"{audit.stats['reused_drive_ids']} reused across views"
    )
    if audit.stats["drive_folders_checked"]:
        print(
            "- Drive check: "
            f"{audit.stats['drive_ids_available']}/{audit.stats['drive_ids_required']} ids available, "
            f"{audit.stats['drive_permissions_checked']} owner-only, "
            f"{audit.stats['drive_folders_checked']} folders listed"
        )
    if audit.stats["http_urls_checked"]:
        print(f"- HTTP check: {audit.stats['http_urls_checked']} non-Drive URLs checked")

    if audit.findings:
        print()
        for finding in audit.findings:
            print(f"{finding.level} {finding.code} {finding.location}: {finding.message}")

    print()
    print("PASS" if not audit.errors else "FAIL")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit site data before publishing.")
    parser.add_argument("--materials", type=Path, default=MATERIALS_JSON)
    parser.add_argument("--phases", type=Path, default=PHASES_JSON)
    parser.add_argument("--expected-topics", type=int, default=DEFAULT_TOPIC_COUNT)
    parser.add_argument("--check-drive", action="store_true", help="Validate Drive ids using rclone.")
    parser.add_argument("--check-http", action="store_true", help="Validate non-Drive URLs with HEAD/GET.")
    parser.add_argument("--check-links", action="store_true", help="Alias for --check-drive --check-http.")
    parser.add_argument("--drive-remote", default=DRIVE_REMOTE)
    parser.add_argument(
        "--drive-owner",
        default="diego.ayala.bernal2@gmail.com",
        help="Only this account may appear in Drive permissions.",
    )
    parser.add_argument(
        "--drive-root-folder-id",
        action="append",
        default=[],
        help="Extra Drive folder id or folder URL to list recursively.",
    )
    parser.add_argument("--http-timeout", type=float, default=12.0)
    parser.add_argument(
        "--max-review-age",
        type=int,
        default=120,
        help="Warn when a verification date is older than this number of days.",
    )
    parser.add_argument(
        "--fail-on-warning",
        action="store_true",
        help="Return a failing exit code when the audit emits warnings.",
    )
    parser.add_argument(
        "--strict-global-drive-ids",
        action="store_true",
        help="Fail when a Drive id is reused across materials and phase views.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.check_links:
        args.check_drive = True
        args.check_http = True

    audit = Audit(max_review_age=args.max_review_age)
    materials = load_json(args.materials, audit)
    phases = load_json(args.phases, audit)

    validate_materials(materials, audit, args.expected_topics)
    validate_phases(phases, audit)
    validate_index_topics(materials, audit, args.expected_topics)
    validate_revision_metadata(materials, phases, audit)
    validate_exam_and_module_metadata(phases, audit)
    validate_part_b_compaction(materials, phases, audit)
    collect_index_urls(audit)
    validate_cross_view_duplicates(audit, strict=args.strict_global_drive_ids)

    if args.check_drive:
        check_drive(audit, materials, args.drive_remote, args.drive_root_folder_id, args.drive_owner)
    if args.check_http:
        check_http(audit, args.http_timeout)

    print_report(audit)
    has_warnings = any(finding.level == "WARN" for finding in audit.findings)
    return 1 if audit.errors or (args.fail_on_warning and has_warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
