from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_HEADERS = {
    "Accept": "text/html,application/json",
    "User-Agent": (
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    ),
}


def fetch_text(url: str, headers: dict[str, str] | None = None) -> str:
    request = Request(url, headers={**DEFAULT_HEADERS, **(headers or {})})

    try:
        with urlopen(request, timeout=20) as response:
            encoding = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(encoding, errors="replace")
    except HTTPError as error:
        raise RuntimeError(f"Upstream service returned {error.code}.") from error
    except URLError as error:
        raise RuntimeError("Failed to reach the upstream service.") from error


def safe_json_parse(value: str) -> Any | None:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def extract_json_block(page: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, page, re.IGNORECASE | re.DOTALL)
        if match and match.group(1):
            return match.group(1)
    return None


def truncate_posts(items: list[Any], max_items: int = 20) -> list[Any]:
    return items[:max_items]


def to_iso_date(unix_seconds: int | None) -> str | None:
    if not unix_seconds:
        return None
    return datetime.fromtimestamp(unix_seconds, tz=timezone.utc).isoformat()


def extract_caption(candidate: Any) -> str:
    return candidate.strip() if isinstance(candidate, str) else ""


def read_first_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value
    return None


def read_number(candidate: Any) -> int | None:
    if isinstance(candidate, bool):
        return None
    if isinstance(candidate, int):
        return candidate
    if isinstance(candidate, float) and candidate.is_integer():
        return int(candidate)
    return None
