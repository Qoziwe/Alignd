from models import ProfileParseResult
from parsers.instagram import parse_instagram_profile
from parsers.tiktok import parse_tiktok_profile
from url_utils import normalize_profile_url


def parse_profile(profile_url: str) -> ProfileParseResult:
    normalized = normalize_profile_url(profile_url)

    if normalized.platform == "instagram":
        return parse_instagram_profile(normalized.normalized_url, normalized.username)

    if normalized.platform == "tiktok":
        return parse_tiktok_profile(normalized.normalized_url, normalized.username)

    raise ValueError("No parser adapter is connected for this platform yet.")
