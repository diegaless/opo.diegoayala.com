#!/usr/bin/env python3
"""Detect relevant changes in official CARM, Educarm, and BORM sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse


REPO = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = REPO / "data" / "official-watch.json"
USER_AGENT = "opo-diegoayala-official-watch/1.0 (+https://opo.diegoayala.com/)"
WATCH_SOURCES = [
    {
        "id": "carm-oposiciones-docentes",
        "name": "CARM · Oposiciones docentes",
        "url": "https://www.carm.es/web/pagina?IDCONTENIDO=3977&IDTIPO=100",
        "kind": "html",
        "allowEmpty": True,
        "categories": ["convocatoria", "publicaciones"],
    },
    {
        "id": "carm-procedimiento-1895",
        "name": "CARM · Procedimiento PES 1895",
        "url": "https://sede.carm.es/web/pagina?IDCONTENIDO=1895&IDTIPO=240",
        "kind": "html",
        "categories": ["convocatoria", "instancia"],
    },
    {
        "id": "carm-rrhh-feed",
        "name": "CARM RRHH · Novedades PES e Informática",
        "url": "https://rrhheducacion.carm.es/feed/",
        "kind": "rss",
        "allowEmpty": True,
        "ignoreRemovals": True,
        "categories": ["convocatoria", "publicaciones"],
    },
    {
        "id": "borm-pes-selectivo",
        "name": "BORM · Procesos selectivos PES",
        "url": "https://www.borm.es/#/home/buscador",
        "requestUrl": "https://www.borm.es/services/buscador",
        "kind": "borm-search",
        "allowEmpty": True,
        "categories": ["convocatoria", "publicaciones"],
    },
]
TARGET_RE = re.compile(
    r"590\s*[/.-]?\s*107|informatica|ensenanza secundaria|profesores de secundaria|"
    r"profesores de ensenanza secundaria|cuerpo de profesores de secundaria|"
    r"secundaria y otros cuerpos|oposicion(?:es)? (?:al )?cuerpo de profesores de secundaria|\bpes\b",
    re.I,
)
ACTION_RE = re.compile(
    r"convoc|criter|tribunal|prueba|publica|admitid|seleccionad|instancia|"
    r"procedimiento(?:s)? selectivo(?:s)?|oposicion",
    re.I,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(text.lower().split())


def canonical_url(value: str, base_url: str) -> str:
    absolute = urljoin(base_url, value)
    parsed = urlparse(absolute)
    allowed_query = {
        "IDCONTENIDO",
        "IDTIPO",
        "ARCHIVO",
        "ALIAS",
        "VALORCLAVE",
        "anyo",
        "aplicacion",
        "convocatoria",
        "module",
    }
    query = urlencode(
        [(key, item) for key, item in parse_qsl(parsed.query) if key in allowed_query],
        doseq=True,
    )
    return urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path, "", query, ""))


class RelevantHTMLParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.entries: set[str] = set()
        self.anchor_href = ""
        self.anchor_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        self.anchor_href = dict(attrs).get("href") or ""
        self.anchor_text = []

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text:
            return
        if self.anchor_href:
            self.anchor_text.append(text)
        if 4 <= len(text) <= 400 and TARGET_RE.search(normalize(text)) and ACTION_RE.search(normalize(text)):
            self.entries.add(text)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self.anchor_href:
            return
        text = " ".join(" ".join(self.anchor_text).split())
        combined = normalize(f"{text} {self.anchor_href}")
        if TARGET_RE.search(combined) and ACTION_RE.search(combined):
            url = canonical_url(self.anchor_href, self.base_url)
            self.entries.add(f"{text or 'Enlace oficial'} | {url}")
        self.anchor_href = ""
        self.anchor_text = []


def request_bytes(
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    content_type: str | None = None,
    attempts: int = 4,
) -> bytes:
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xml,application/json;q=0.9,*/*;q=0.8"}
    if content_type:
        headers["Content-Type"] = content_type
    last_error: Exception | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
            if b"Captcha Page" in body or b"captcha.perfdrive.com" in body:
                raise RuntimeError("official endpoint returned an anti-bot challenge")
            return body
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    raise RuntimeError(f"cannot read {url}: {last_error}")


def html_entries(source: dict[str, Any]) -> list[str]:
    body = request_bytes(source["url"])
    parser = RelevantHTMLParser(source["url"])
    parser.feed(body.decode("utf-8", errors="replace"))
    return sorted(parser.entries, key=normalize)


def borm_payload() -> bytes:
    current_year = datetime.now(timezone.utc).year
    payload = {
        "textoLibre": "profesores de enseñanza secundaria",
        "fechaDesde": f"01/01/{current_year - 2}",
        "fechaHasta": f"31/12/{current_year}",
        "anunciante": "",
        "rango": 0,
        "tipo": "libre",
        "nombre": "",
        "apellidos": "",
        "nif": "",
        "etiqueta": 0,
        "origen": 0,
        "idApartado": "",
        "anuncianteFaceta": "",
        "idCategoria": "",
        "tipoBusqueda": 0,
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def borm_entries(source: dict[str, Any]) -> list[str]:
    body = request_bytes(
        source["requestUrl"],
        method="POST",
        data=borm_payload(),
        content_type="application/json",
    )
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise RuntimeError(f"BORM search returned invalid XML: {exc}") from exc

    entries: set[str] = set()
    for result in root.findall(".//anuncios/anuncios"):
        summary = " ".join((result.findtext("sumario") or "").split())
        normalized = normalize(summary)
        if not re.search(r"procedimiento(?:s)? selectivo(?:s)?|oposicion|convocatoria", normalized):
            continue
        if not re.search(r"profesores de ensenanza secundaria|590\s*[/.-]?\s*107|informatica", normalized):
            continue
        if re.search(r"emplazamiento|procedimiento ordinario|recurso de alzada", normalized):
            continue
        announcement_id = result.findtext("idAnuncio") or ""
        date_value = result.findtext("fechaPublicacion") or "Fecha no indicada"
        url = f"https://www.borm.es/services/anuncio/{announcement_id}/pdf" if announcement_id else source["url"]
        entries.add(f"{date_value} · {summary} | {url}")
    return sorted(entries, key=normalize)


def rss_entries(source: dict[str, Any]) -> list[str]:
    body = request_bytes(source["url"])
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise RuntimeError(f"Official RSS returned invalid XML: {exc}") from exc

    entries: set[str] = set()
    for item in root.findall(".//item"):
        title = " ".join((item.findtext("title") or "").split())
        description = " ".join((item.findtext("description") or "").split())
        if not TARGET_RE.search(normalize(f"{title} {description}")):
            continue
        date_value = " ".join((item.findtext("pubDate") or "Fecha no indicada").split())
        link = canonical_url(item.findtext("link") or source["url"], source["url"])
        entries.add(f"{date_value} · {title or 'Novedad oficial'} | {link}")
    return sorted(entries, key=normalize)


def read_source(source: dict[str, Any]) -> list[str]:
    if source["kind"] == "borm-search":
        entries = borm_entries(source)
    elif source["kind"] == "rss":
        entries = rss_entries(source)
    else:
        entries = html_entries(source)
    if not entries and not source.get("allowEmpty"):
        raise RuntimeError(f"no relevant entries found in {source['name']}")
    return entries


def fingerprint(entries: list[str]) -> str:
    payload = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def classify(entries: list[str], default_categories: list[str]) -> list[str]:
    text = normalize(" ".join(entries))
    categories = []
    for category, pattern in (
        ("convocatoria", r"convoc|procedimiento selectivo|instancia"),
        ("criterios", r"criter"),
        ("tribunales", r"tribunal"),
        ("prueba práctica", r"prueba practica|examen"),
        ("publicaciones", r"publica|admitid|seleccionad|resultado"),
    ):
        if re.search(pattern, text):
            categories.append(category)
    return categories or default_categories


def build_source_state(source: dict[str, Any], entries: list[str], checked_at: str) -> dict[str, Any]:
    return {
        "id": source["id"],
        "name": source["name"],
        "url": source["url"],
        "kind": source["kind"],
        "categories": source["categories"],
        "checkedAt": checked_at,
        "monitorStatus": "active",
        "fingerprint": fingerprint(entries),
        "entryCount": len(entries),
        "entries": entries,
    }


def write_github_output(changed: bool, alert_count: int, updated: bool, status: str) -> None:
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        return
    with open(output_path, "a", encoding="utf-8") as handle:
        handle.write(f"changed={'true' if changed else 'false'}\n")
        handle.write(f"alert_count={alert_count}\n")
        handle.write(f"updated={'true' if updated else 'false'}\n")
        handle.write(f"status={status}\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, default=SNAPSHOT_PATH)
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--update", action="store_true")
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    checked_at = now_iso()
    try:
        previous = json.loads(args.snapshot.read_text(encoding="utf-8")) if args.snapshot.exists() else {}
    except json.JSONDecodeError as exc:
        print(f"Invalid snapshot: {exc}", file=sys.stderr)
        return 1

    previous_sources = {
        source.get("id"): source
        for source in previous.get("sources") or []
        if isinstance(source, dict) and source.get("id")
    }
    states = []
    alerts = list(previous.get("alerts") or [])
    changes = []
    errors = []
    baseline_updates = 0
    status_updates = 0
    successful_sources = 0

    for source in WATCH_SOURCES:
        old = previous_sources.get(source["id"])
        try:
            entries = read_source(source)
            state = build_source_state(source, entries, checked_at)
        except Exception as exc:  # Keep the last valid baseline when an official endpoint is unavailable.
            errors.append(f"{source['name']}: {exc}")
            if old:
                states.append(old)
            else:
                states.append(
                    {
                        "id": source["id"],
                        "name": source["name"],
                        "url": source["url"],
                        "kind": source["kind"],
                        "categories": source["categories"],
                        "checkedAt": None,
                        "monitorStatus": "pending",
                        "fingerprint": "",
                        "entryCount": 0,
                        "entries": [],
                    }
                )
            continue

        successful_sources += 1
        if not old or not old.get("fingerprint"):
            baseline_updates += 1
        elif old.get("fingerprint") != state["fingerprint"]:
            old_entries = set(old.get("entries") or [])
            added = sorted(set(entries) - old_entries, key=normalize)
            removed = sorted(old_entries - set(entries), key=normalize)
            if source.get("ignoreRemovals") and not added:
                baseline_updates += 1
            else:
                categories = classify(added or removed, source["categories"])
                alert_seed = f"{source['id']}|{state['fingerprint']}"
                alert_id = hashlib.sha256(alert_seed.encode("utf-8")).hexdigest()[:12]
                alert = {
                    "id": alert_id,
                    "detectedAt": checked_at,
                    "sourceId": source["id"],
                    "sourceName": source["name"],
                    "sourceUrl": source["url"],
                    "categories": categories,
                    "status": "review-required",
                    "title": f"Cambio oficial detectado: {', '.join(categories)}",
                    "added": added[:8],
                    "removedCount": len(removed),
                }
                alerts = [item for item in alerts if item.get("id") != alert_id]
                alerts.insert(0, alert)
                changes.append(alert)
        elif old.get("monitorStatus") != "active":
            status_updates += 1
        states.append(state)

    if errors:
        print("Official monitor warnings:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
    if not successful_sources and not args.initialize:
        print("No official source could be checked.", file=sys.stderr)
        return 1

    if successful_sources == len(WATCH_SOURCES):
        monitor_status = "monitoring"
    elif successful_sources:
        monitor_status = "partial"
    else:
        monitor_status = "initializing"
    has_updates = bool(changes) or baseline_updates > 0 or status_updates > 0
    snapshot = {
        "version": 1,
        "initializedAt": previous.get("initializedAt") or checked_at,
        "updatedAt": checked_at if has_updates or args.initialize else previous.get("updatedAt", checked_at),
        "schedule": "daily",
        "status": monitor_status,
        "alerts": alerts[:20],
        "sources": states,
    }
    report = {
        "checkedAt": checked_at,
        "changed": bool(changes),
        "alertCount": len(changes),
        "baselineUpdates": baseline_updates,
        "status": monitor_status,
        "errors": errors,
        "changes": changes,
        "sources": [{"id": state["id"], "entries": state["entryCount"]} for state in states],
    }
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    should_write = args.initialize or (args.update and has_updates)
    if should_write:
        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        args.snapshot.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    write_github_output(bool(changes), len(changes), should_write, monitor_status)
    print(
        f"Official monitor: {successful_sources}/{len(states)} sources checked, "
        f"{len(changes)} changes, {baseline_updates} baselines, {len(alerts)} open alerts"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
