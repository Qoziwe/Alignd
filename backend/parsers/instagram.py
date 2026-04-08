from __future__ import annotations

from typing import Any
from urllib.parse import quote

from models import ProfileParseResult, ProfilePost
from parser_helpers import (
    extract_caption,
    extract_json_block,
    fetch_text,
    read_first_string,
    read_number,
    safe_json_parse,
    to_iso_date,
    truncate_posts,
)


def map_instagram_posts(user: dict[str, Any] | None) -> list[ProfilePost]:
    media = user.get("edge_owner_to_timeline_media") if user else None
    if not media:
        media = user.get("timeline_media") if user else None

    edges = media.get("edges", []) if isinstance(media, dict) else []
    posts: list[ProfilePost] = []

    for edge in edges:
        node = edge.get("node", {}) if isinstance(edge, dict) else {}
        caption_edges = node.get("edge_media_to_caption", {})
        caption_items = caption_edges.get("edges", []) if isinstance(caption_edges, dict) else []
        first_caption = None
        if caption_items and isinstance(caption_items[0], dict):
            first_caption = (caption_items[0].get("node") or {}).get("text")

        shortcode = read_first_string(node.get("shortcode"))
        post_id = read_first_string(node.get("id"), shortcode)
        if not post_id:
            continue

        posts.append(
            ProfilePost(
                id=post_id,
                url=f"https://www.instagram.com/p/{shortcode}/" if shortcode else None,
                caption=extract_caption(first_caption),
                publishedAt=to_iso_date(read_number(node.get("taken_at_timestamp"))),
            )
        )

    return truncate_posts(posts)


def map_instagram_user(user: dict[str, Any], normalized_url: str, username: str) -> ProfileParseResult:
    edge_followed_by = user.get("edge_followed_by") if isinstance(user.get("edge_followed_by"), dict) else {}
    edge_follow = user.get("edge_follow") if isinstance(user.get("edge_follow"), dict) else {}
    timeline = user.get("edge_owner_to_timeline_media") if isinstance(user.get("edge_owner_to_timeline_media"), dict) else {}

    return ProfileParseResult(
        platform="instagram",
        profileUrl=normalized_url,
        username=read_first_string(user.get("username"), username) or username,
        fullName=read_first_string(user.get("full_name")),
        bio=read_first_string(user.get("biography"), user.get("bio")),
        avatarUrl=read_first_string(user.get("profile_pic_url_hd"), user.get("profile_pic_url")),
        isPrivate=bool(user.get("is_private")),
        isVerified=bool(user.get("is_verified")),
        followersCount=read_number(edge_followed_by.get("count")),
        followingCount=read_number(edge_follow.get("count")),
        postsCount=read_number(timeline.get("count")),
        recentPosts=map_instagram_posts(user),
    )


def parse_via_api(normalized_url: str, username: str) -> ProfileParseResult | None:
    api_url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={quote(username)}"
    response_text = fetch_text(
        api_url,
        headers={
            "X-IG-App-ID": "936619743392459",
            "Referer": normalized_url,
        },
    )
    parsed = safe_json_parse(response_text)
    user = ((parsed or {}).get("data") or {}).get("user") if isinstance(parsed, dict) else None

    if not isinstance(user, dict):
        return None

    return map_instagram_user(user, normalized_url, username)


def parse_via_html(normalized_url: str, username: str) -> ProfileParseResult | None:
    page = fetch_text(normalized_url)
    block = extract_json_block(
        page,
        [
            r'<script type="application/json" data-sjs[^>]*>([\s\S]*?)</script>',
            r'"userInfo":(\{[\s\S]*?\}),"logging_page_id"',
        ],
    )

    if not block:
        return None

    embedded = safe_json_parse(block)
    user = None
    if isinstance(embedded, dict):
        user = (
            ((embedded.get("props") or {}).get("pageProps") or {}).get("userInfo") or {}
        ).get("user")

    if not isinstance(user, dict):
        wrapped = safe_json_parse(f'{{"userInfo":{block}}}')
        if isinstance(wrapped, dict):
            user = ((wrapped.get("userInfo") or {}).get("user"))

    if not isinstance(user, dict):
        return None

    return map_instagram_user(user, normalized_url, username)


def parse_instagram_profile(normalized_url: str, username: str) -> ProfileParseResult:
    attempts = [parse_via_api, parse_via_html]

    for attempt in attempts:
        try:
            parsed = attempt(normalized_url, username)
            if parsed:
                return parsed
        except Exception:
            continue

    raise RuntimeError("Instagram did not return public profile data. Public scraping can still be unstable.")
