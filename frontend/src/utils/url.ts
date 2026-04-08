import { SupportedPlatform } from "../types/parser";

export type NormalizedProfileUrl = {
  originalUrl: string;
  normalizedUrl: string;
  username: string;
  platform: SupportedPlatform;
};

const platformDomains: Record<SupportedPlatform, RegExp> = {
  instagram: /(^|\.)instagram\.com$/i,
  tiktok: /(^|\.)tiktok\.com$/i,
};

export function normalizeProfileUrl(rawUrl: string): NormalizedProfileUrl {
  const input = rawUrl.trim();

  if (!input) {
    throw new Error("Вставь ссылку на профиль Instagram или TikTok.");
  }

  const candidate = input.startsWith("http") ? input : `https://${input}`;
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Ссылка выглядит некорректной.");
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();

  const platform = (Object.keys(platformDomains) as SupportedPlatform[]).find((key) =>
    platformDomains[key].test(host),
  );

  if (!platform) {
    throw new Error("Сейчас поддерживаются только ссылки на Instagram и TikTok профили.");
  }

  const segments = url.pathname.split("/").filter(Boolean);

  if (platform === "instagram") {
    const username = segments[0];

    if (!username) {
      throw new Error("Не получилось определить username Instagram.");
    }

    return {
      originalUrl: rawUrl,
      normalizedUrl: `https://www.instagram.com/${username}/`,
      username,
      platform,
    };
  }

  const atUsername = segments.find((segment) => segment.startsWith("@"));

  if (!atUsername) {
    throw new Error("Ожидалась ссылка на профиль TikTok в формате /@username.");
  }

  return {
    originalUrl: rawUrl,
    normalizedUrl: `https://www.tiktok.com/${atUsername}`,
    username: atUsername.replace(/^@/, ""),
    platform,
  };
}
