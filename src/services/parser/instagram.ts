import { PlatformAdapter, ProfileParseResult, ProfilePost } from "../../types/parser";
import { normalizeProfileUrl } from "../../utils/url";
import {
  extractCaption,
  extractJsonBlock,
  fetchText,
  readFirstString,
  readNumber,
  safeJsonParse,
  toIsoDate,
  truncatePosts,
} from "./helpers";

type InstagramApiResponse = {
  data?: {
    user?: {
      biography?: string;
      edge_followed_by?: { count?: number };
      edge_follow?: { count?: number };
      edge_owner_to_timeline_media?: {
        count?: number;
        edges?: Array<{
          node?: {
            id?: string;
            shortcode?: string;
            taken_at_timestamp?: number;
            edge_media_to_caption?: {
              edges?: Array<{
                node?: { text?: string };
              }>;
            };
          };
        }>;
      };
      full_name?: string;
      hd_profile_pic_url_info?: { url?: string };
      is_private?: boolean;
      is_verified?: boolean;
      profile_pic_url_hd?: string;
      username?: string;
    };
  };
};

type InstagramEmbeddedData = {
  props?: {
    pageProps?: {
      userInfo?: {
        user?: Record<string, unknown>;
      };
    };
  };
};

function mapInstagramPosts(user: Record<string, unknown> | undefined): ProfilePost[] {
  const media = (user?.edge_owner_to_timeline_media ?? user?.timeline_media) as
    | {
        edges?: Array<{
          node?: Record<string, unknown>;
        }>;
      }
    | undefined;

  const edges = Array.isArray(media?.edges) ? media.edges : [];

  const posts: ProfilePost[] = [];

  for (const edge of edges) {
    const node = edge?.node;
    const captionEdges = node?.edge_media_to_caption as
      | { edges?: Array<{ node?: { text?: string } }> }
      | undefined;
    const firstCaption = captionEdges?.edges?.[0]?.node?.text;
    const shortcode = readFirstString(node?.shortcode);
    const id = readFirstString(node?.id, shortcode);

    if (!id) {
      continue;
    }

    posts.push({
      id,
      url: shortcode ? `https://www.instagram.com/p/${shortcode}/` : undefined,
      caption: extractCaption(firstCaption),
      publishedAt: toIsoDate(readNumber(node?.taken_at_timestamp)),
    });
  }

  return truncatePosts(posts);
}

function mapInstagramUser(user: Record<string, unknown>, normalizedUrl: string, username: string): ProfileParseResult {
  return {
    platform: "instagram",
    profileUrl: normalizedUrl,
    username: readFirstString(user.username) ?? username,
    fullName: readFirstString(user.full_name),
    bio: readFirstString(user.biography, user.bio),
    avatarUrl: readFirstString(user.profile_pic_url_hd, user.profile_pic_url),
    isPrivate: Boolean(user.is_private),
    isVerified: Boolean(user.is_verified),
    followersCount: readNumber((user.edge_followed_by as { count?: number } | undefined)?.count),
    followingCount: readNumber((user.edge_follow as { count?: number } | undefined)?.count),
    postsCount: readNumber((user.edge_owner_to_timeline_media as { count?: number } | undefined)?.count),
    recentPosts: mapInstagramPosts(user),
  };
}

async function parseViaApi(normalizedUrl: string, username: string) {
  const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const responseText = await fetchText(apiUrl, {
    headers: {
      "X-IG-App-ID": "936619743392459",
      Referer: normalizedUrl,
    },
  });
  const parsed = safeJsonParse<InstagramApiResponse>(responseText);
  const user = parsed?.data?.user;

  if (!user) {
    return null;
  }

  return mapInstagramUser(user as unknown as Record<string, unknown>, normalizedUrl, username);
}

async function parseViaHtml(normalizedUrl: string, username: string) {
  const page = await fetchText(normalizedUrl);
  const block = extractJsonBlock(page, [
    /<script type="application\/json" data-sjs[^>]*>([\s\S]*?)<\/script>/i,
    /"userInfo":(\{[\s\S]*?\}),"logging_page_id"/i,
  ]);

  if (!block) {
    return null;
  }

  const embedded = safeJsonParse<InstagramEmbeddedData>(block);
  const user =
    embedded?.props?.pageProps?.userInfo?.user ??
    (safeJsonParse<{ userInfo?: { user?: Record<string, unknown> } }>(`{"userInfo":${block}}`)?.userInfo?.user ??
      null);

  if (!user) {
    return null;
  }

  return mapInstagramUser(user, normalizedUrl, username);
}

export const instagramAdapter: PlatformAdapter = {
  canHandle(url) {
    return /instagram\.com/i.test(url);
  },
  async parseProfile(url) {
    const { normalizedUrl, username } = normalizeProfileUrl(url);

    const attempts = [() => parseViaApi(normalizedUrl, username), () => parseViaHtml(normalizedUrl, username)];

    for (const attempt of attempts) {
      try {
        const parsed = await attempt();

        if (parsed) {
          return parsed;
        }
      } catch {
        continue;
      }
    }

    throw new Error(
      "Instagram не отдал публичные данные. Для этой платформы без бэкенда и авторизованного API парсинг может быть нестабильным.",
    );
  },
};
