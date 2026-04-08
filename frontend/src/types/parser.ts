export type SupportedPlatform = "instagram" | "tiktok";

export type ProfilePost = {
  id: string;
  url?: string;
  caption: string;
  publishedAt?: string;
};

export type ProfileParseResult = {
  platform: SupportedPlatform;
  profileUrl: string;
  username: string;
  fullName?: string;
  bio?: string;
  avatarUrl?: string;
  isPrivate?: boolean;
  isVerified?: boolean;
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  extra?: Record<string, string | number | boolean | undefined>;
  recentPosts: ProfilePost[];
};

export type PlatformAdapter = {
  canHandle: (url: string) => boolean;
  parseProfile: (url: string) => Promise<ProfileParseResult>;
};
