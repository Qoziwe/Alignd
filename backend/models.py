from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


SupportedPlatform = Literal["instagram", "tiktok"]


class ProfilePost(BaseModel):
    id: str
    url: str | None = None
    caption: str
    publishedAt: str | None = None


class ProfileParseResult(BaseModel):
    platform: SupportedPlatform
    profileUrl: str
    username: str
    fullName: str | None = None
    bio: str | None = None
    avatarUrl: str | None = None
    isPrivate: bool | None = None
    isVerified: bool | None = None
    followersCount: int | None = None
    followingCount: int | None = None
    postsCount: int | None = None
    extra: dict[str, str | int | bool | None] | None = None
    recentPosts: list[ProfilePost]
