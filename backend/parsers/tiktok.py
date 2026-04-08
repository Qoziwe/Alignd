from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from models import ProfileParseResult, ProfilePost
from parser_helpers import extract_caption, extract_json_block, fetch_text, read_first_string, read_number, safe_json_parse, truncate_posts


def to_tiktok_posts(items: list[dict[str, Any]], username: str) -> list[ProfilePost]:
    posts: list[ProfilePost] = []

    for item in items:
        post_id = item.get("id")
        if not isinstance(post_id, str):
            continue

        created_at = read_number(item.get("createTime"))
        published_at = None
        if created_at:
            published_at = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()

        posts.append(
            ProfilePost(
                id=post_id,
                caption=extract_caption(item.get("desc")),
                url=f"https://www.tiktok.com/@{username}/video/{post_id}",
                publishedAt=published_at,
            )
        )

    return truncate_posts(posts)


def parse_sigi_state(page: str, normalized_url: str, fallback_username: str) -> ProfileParseResult | None:
    block = extract_json_block(page, [r'<script id="SIGI_STATE" type="application/json">([\s\S]*?)</script>'])
    if not block:
        return None

    parsed = safe_json_parse(block)
    if not isinstance(parsed, dict):
        return None

    user_module = parsed.get("UserModule") or {}
    users = user_module.get("users") or {}
    stats = user_module.get("stats") or {}
    item_module = parsed.get("ItemModule") or {}

    first_user = next(iter(users.values()), None) if isinstance(users, dict) else None
    first_stats = next(iter(stats.values()), None) if isinstance(stats, dict) else None
    posts = list(item_module.values()) if isinstance(item_module, dict) else []

    if not isinstance(first_user, dict):
        return None

    username = read_first_string(first_user.get("uniqueId"), fallback_username) or fallback_username

    return ProfileParseResult(
        platform="tiktok",
        profileUrl=normalized_url,
        username=username,
        fullName=read_first_string(first_user.get("nickname")),
        bio=read_first_string(first_user.get("signature")),
        avatarUrl=read_first_string(first_user.get("avatarLarger")),
        isVerified=bool(first_user.get("verified")),
        followersCount=read_number((first_stats or {}).get("followerCount")) if isinstance(first_stats, dict) else None,
        followingCount=read_number((first_stats or {}).get("followingCount")) if isinstance(first_stats, dict) else None,
        postsCount=read_number((first_stats or {}).get("videoCount")) if isinstance(first_stats, dict) else None,
        extra={
            "likesCount": read_number((first_stats or {}).get("heartCount")) if isinstance(first_stats, dict) else None,
            "externalLink": read_first_string(((first_user.get("bioLink") or {}).get("link")) if isinstance(first_user.get("bioLink"), dict) else None),
        },
        recentPosts=to_tiktok_posts([item for item in posts if isinstance(item, dict)], username),
    )


def parse_universal_data(page: str, normalized_url: str, fallback_username: str) -> ProfileParseResult | None:
    block = extract_json_block(
        page,
        [r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">([\s\S]*?)</script>'],
    )
    if not block:
        return None

    parsed = safe_json_parse(block)
    if not isinstance(parsed, dict):
        return None

    detail = (((parsed.get("__DEFAULT_SCOPE__") or {}).get("webapp.user-detail")) or {})
    user_info = detail.get("userInfo") if isinstance(detail, dict) else {}
    user = (user_info or {}).get("user") if isinstance(user_info, dict) else None
    stats = (user_info or {}).get("stats") if isinstance(user_info, dict) else None
    item_list = detail.get("itemList") if isinstance(detail, dict) else []

    if not isinstance(user, dict):
        return None

    username = read_first_string(user.get("uniqueId"), fallback_username) or fallback_username

    return ProfileParseResult(
        platform="tiktok",
        profileUrl=normalized_url,
        username=username,
        fullName=read_first_string(user.get("nickname")),
        bio=read_first_string(user.get("signature")),
        avatarUrl=read_first_string(user.get("avatarLarger")),
        isVerified=bool(user.get("verified")),
        followersCount=read_number((stats or {}).get("followerCount")) if isinstance(stats, dict) else None,
        followingCount=read_number((stats or {}).get("followingCount")) if isinstance(stats, dict) else None,
        postsCount=read_number((stats or {}).get("videoCount")) if isinstance(stats, dict) else None,
        extra={
            "likesCount": read_number((stats or {}).get("heartCount")) if isinstance(stats, dict) else None,
        },
        recentPosts=to_tiktok_posts([item for item in (item_list or []) if isinstance(item, dict)], username),
    )


def parse_tiktok_profile(normalized_url: str, username: str) -> ProfileParseResult:
    page = fetch_text(normalized_url)
    parsed = parse_sigi_state(page, normalized_url, username) or parse_universal_data(page, normalized_url, username)

    if not parsed:
        raise RuntimeError("TikTok did not return the expected public profile data.")

    return parsed
