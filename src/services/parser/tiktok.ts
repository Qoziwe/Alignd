import { PlatformAdapter, ProfileParseResult, ProfilePost } from "../../types/parser";
import { normalizeProfileUrl } from "../../utils/url";
import {
  extractCaption,
  extractJsonBlock,
  fetchText,
  readFirstString,
  readNumber,
  safeJsonParse,
  truncatePosts,
} from "./helpers";

type TikTokModule = {
  UserModule?: {
    users?: Record<
      string,
      {
        avatarLarger?: string;
        bioLink?: { link?: string };
        uniqueId?: string;
        nickname?: string;
        signature?: string;
        verified?: boolean;
      }
    >;
    stats?: Record<
      string,
      {
        followerCount?: number;
        followingCount?: number;
        heartCount?: number;
        videoCount?: number;
      }
    >;
  };
  ItemModule?: Record<
    string,
    {
      createTime?: number;
      desc?: string;
      id?: string;
    }
  >;
};

type TikTokUniversal = {
  __DEFAULT_SCOPE__?: {
    "webapp.user-detail"?: {
      userInfo?: {
        user?: {
          avatarLarger?: string;
          nickname?: string;
          signature?: string;
          uniqueId?: string;
          verified?: boolean;
        };
        stats?: {
          followerCount?: number;
          followingCount?: number;
          heartCount?: number;
          videoCount?: number;
        };
      };
      itemList?: Array<{
        createTime?: number;
        desc?: string;
        id?: string;
      }>;
    };
  };
};

function toTikTokPosts(items: Array<{ id?: string; desc?: string; createTime?: number }>, username: string): ProfilePost[] {
  const posts: ProfilePost[] = [];

  for (const item of items) {
    if (!item.id) {
      continue;
    }

    posts.push({
      id: item.id,
      caption: extractCaption(item.desc),
      url: `https://www.tiktok.com/@${username}/video/${item.id}`,
      publishedAt: item.createTime ? new Date(item.createTime * 1000).toISOString() : undefined,
    });
  }

  return truncatePosts(posts);
}

function parseSigiState(page: string, normalizedUrl: string, fallbackUsername: string): ProfileParseResult | null {
  const block = extractJsonBlock(page, [/<script id="SIGI_STATE" type="application\/json">([\s\S]*?)<\/script>/i]);

  if (!block) {
    return null;
  }

  const parsed = safeJsonParse<TikTokModule>(block);
  const userEntries = parsed?.UserModule?.users ?? {};
  const statEntries = parsed?.UserModule?.stats ?? {};
  const firstUser = Object.values(userEntries)[0];
  const firstStats = Object.values(statEntries)[0];
  const posts = Object.values(parsed?.ItemModule ?? {});

  if (!firstUser) {
    return null;
  }

  const username = firstUser.uniqueId ?? fallbackUsername;

  return {
    platform: "tiktok",
    profileUrl: normalizedUrl,
    username,
    fullName: readFirstString(firstUser.nickname),
    bio: readFirstString(firstUser.signature),
    avatarUrl: readFirstString(firstUser.avatarLarger),
    isVerified: Boolean(firstUser.verified),
    followersCount: readNumber(firstStats?.followerCount),
    followingCount: readNumber(firstStats?.followingCount),
    postsCount: readNumber(firstStats?.videoCount),
    extra: {
      likesCount: readNumber(firstStats?.heartCount),
      externalLink: readFirstString(firstUser.bioLink?.link),
    },
    recentPosts: toTikTokPosts(posts, username),
  };
}

function parseUniversalData(page: string, normalizedUrl: string, fallbackUsername: string): ProfileParseResult | null {
  const block = extractJsonBlock(page, [
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/i,
  ]);

  if (!block) {
    return null;
  }

  const parsed = safeJsonParse<TikTokUniversal>(block);
  const detail = parsed?.__DEFAULT_SCOPE__?.["webapp.user-detail"];
  const user = detail?.userInfo?.user;
  const stats = detail?.userInfo?.stats;
  const username = user?.uniqueId ?? fallbackUsername;

  if (!user) {
    return null;
  }

  return {
    platform: "tiktok",
    profileUrl: normalizedUrl,
    username,
    fullName: readFirstString(user.nickname),
    bio: readFirstString(user.signature),
    avatarUrl: readFirstString(user.avatarLarger),
    isVerified: Boolean(user.verified),
    followersCount: readNumber(stats?.followerCount),
    followingCount: readNumber(stats?.followingCount),
    postsCount: readNumber(stats?.videoCount),
    extra: {
      likesCount: readNumber(stats?.heartCount),
    },
    recentPosts: toTikTokPosts(detail?.itemList ?? [], username),
  };
}

export const tiktokAdapter: PlatformAdapter = {
  canHandle(url) {
    return /tiktok\.com/i.test(url);
  },
  async parseProfile(url) {
    const { normalizedUrl, username } = normalizeProfileUrl(url);
    const page = await fetchText(normalizedUrl);

    const parsed = parseSigiState(page, normalizedUrl, username) ?? parseUniversalData(page, normalizedUrl, username);

    if (!parsed) {
      throw new Error("TikTok не отдал ожидаемые публичные данные профиля.");
    }

    return parsed;
  },
};
