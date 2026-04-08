from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(slots=True)
class NormalizedProfileUrl:
    original_url: str
    normalized_url: str
    username: str
    platform: str


def normalize_profile_url(raw_url: str) -> NormalizedProfileUrl:
    value = raw_url.strip()
    if not value:
        raise ValueError("Enter an Instagram or TikTok profile link.")

    candidate = value if value.startswith("http") else f"https://{value}"

    try:
        parsed = urlparse(candidate)
    except Exception as error:
        raise ValueError("The provided link is not valid.") from error

    if not parsed.scheme or not parsed.netloc:
        raise ValueError("The provided link is not valid.")

    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]

    segments = [segment for segment in parsed.path.split("/") if segment]

    if host.endswith("instagram.com"):
        if not segments:
            raise ValueError("Could not detect the Instagram username.")
        username = segments[0]
        return NormalizedProfileUrl(
            original_url=raw_url,
            normalized_url=f"https://www.instagram.com/{username}/",
            username=username,
            platform="instagram",
        )

    if host.endswith("tiktok.com"):
        at_username = next((segment for segment in segments if segment.startswith("@")), None)
        if not at_username:
            raise ValueError("Expected a TikTok profile link in the /@username format.")
        return NormalizedProfileUrl(
            original_url=raw_url,
            normalized_url=f"https://www.tiktok.com/{at_username}",
            username=at_username.removeprefix("@"),
            platform="tiktok",
        )

    raise ValueError("Only Instagram and TikTok profile links are supported.")
