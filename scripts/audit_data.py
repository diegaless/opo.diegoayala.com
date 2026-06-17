#!/usr/bin/env python3
"""Audit the static data before publishing the site.

Default mode is local and deterministic: it validates JSON structure, counts,
pending resources, Drive id consistency, and duplicate ids.

Use --check-drive to verify Drive ids against the authenticated rclone remote.
Use --check-http to verify non-Drive URLs over HTTP.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


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


@dataclass(frozen=True)
class Finding:
    level: str
    code: str
    location: str
    message: str


class Audit:
    def __init__(self) -> None:
        self.findings: list[Finding] = []
        self.stats: Counter[str] = Counter()
        self.drive_refs: dict[str, list[str]] = defaultdict(list)
        self.http_urls: dict[str, list[str]] = defaultdict(list)

    def error(self, code: str, location: str, message: str) -> None:
        self.findings.append(Finding("ERROR", code, location, message))

    def warning(self, code: str, location: str, message: str) -> None:
        self.findings.append(Finding("WARN", code, location, message))

    @property
    def errors(self) -> list[Finding]:
        return [finding for finding in self.findings if finding.level == "ERROR"]


def load_json(path: Path, audit: Audit) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # pragma: no cover - fatal path
        audit.error("json.invalid", str(path.relative_to(REPO)), str(exc))
        return {}


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


def count_by(items: list[dict[str, Any]], key: str, default: str = "General") -> Counter[str]:
    return Counter(str(item.get(key) or default) for item in items)


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

        duplicate_ids: dict[str, list[str]] = defaultdict(list)
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
            if resource.get("phase") != phase_id:
                audit.error("phase.resource.phase_mismatch", item_location, "Resource phase does not match parent phase")
            if resource.get("hasPublicLink") is not True:
                audit.error("resource.pending", item_location, "Resource hasPublicLink is not true")
            if resource.get("url"):
                public_count += 1
            validate_url_and_drive_id(audit, item_location, resource, require_drive_id=is_drive_url(resource.get("url")))
            drive_id = resource.get("driveFileId")
            if drive_id:
                duplicate_ids[drive_id].append(item_location)

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
        if isinstance(source, dict):
            collect_reference_url(audit, f"phases.legalSources[{index}].url", source.get("url"))


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


def rclone_list_ids(remote: str, folder_id: str) -> dict[str, str]:
    command = [
        "rclone",
        "lsf",
        "--drive-root-folder-id",
        folder_id,
        remote,
        "--format",
        "pi",
        "-R",
    ]
    proc = subprocess.run(command, check=True, text=True, capture_output=True)
    ids: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if not line or ";" not in line:
            continue
        path, drive_id = line.rsplit(";", 1)
        if drive_id:
            ids[drive_id] = path
    return ids


def check_drive(
    audit: Audit,
    materials: dict[str, Any],
    remote: str,
    extra_folder_ids: list[str],
) -> None:
    if shutil.which("rclone") is None:
        audit.error("drive.rclone.missing", "rclone", "rclone is required for --check-drive")
        return

    folder_ids = collect_folder_ids(materials, extra_folder_ids)
    audit.stats["drive_folders_checked"] = len(folder_ids)
    available_ids: dict[str, str] = {}

    for folder_id in folder_ids:
        try:
            available_ids.update(rclone_list_ids(remote, folder_id))
        except subprocess.CalledProcessError as exc:
            audit.error(
                "drive.folder.unreadable",
                folder_id,
                (exc.stderr or exc.stdout or str(exc)).strip(),
            )

    missing = sorted(set(audit.drive_refs) - set(available_ids))
    audit.stats["drive_ids_required"] = len(audit.drive_refs)
    audit.stats["drive_ids_available"] = len(set(audit.drive_refs) & set(available_ids))
    if missing:
        for drive_id in missing[:20]:
            audit.error("drive.id.unavailable", audit.drive_refs[drive_id][0], f"Drive id is not visible to rclone: {drive_id}")
        if len(missing) > 20:
            audit.error("drive.id.unavailable", "drive", f"{len(missing) - 20} more Drive ids unavailable")


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
        "- materials: "
        f"{audit.stats['materials']} total, "
        f"{audit.stats['materials_pdf']} PDF, "
        f"{audit.stats['materials_preview']} Drive preview, "
        f"{audit.stats['materials_pending']} pending"
    )
    print(f"- phases: {audit.stats['phases']}")
    print(f"- phase resources: {audit.stats['phase_resources']}")
    print(
        "- Drive ids: "
        f"{audit.stats['unique_drive_ids']} unique, "
        f"{audit.stats['reused_drive_ids']} reused across views"
    )
    if audit.stats["drive_folders_checked"]:
        print(
            "- Drive check: "
            f"{audit.stats['drive_ids_available']}/{audit.stats['drive_ids_required']} ids available, "
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
        "--drive-root-folder-id",
        action="append",
        default=[],
        help="Extra Drive folder id or folder URL to list recursively.",
    )
    parser.add_argument("--http-timeout", type=float, default=12.0)
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

    audit = Audit()
    materials = load_json(args.materials, audit)
    phases = load_json(args.phases, audit)

    validate_materials(materials, audit, args.expected_topics)
    validate_phases(phases, audit)
    collect_index_urls(audit)
    validate_cross_view_duplicates(audit, strict=args.strict_global_drive_ids)

    if args.check_drive:
        check_drive(audit, materials, args.drive_remote, args.drive_root_folder_id)
    if args.check_http:
        check_http(audit, args.http_timeout)

    print_report(audit)
    return 1 if audit.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
