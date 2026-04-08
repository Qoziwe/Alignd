from models import ProfileParseResult
from parsers import parse_profile as parse_profile_with_parsers


def parse_profile(profile_url: str) -> ProfileParseResult:
    return parse_profile_with_parsers(profile_url)
