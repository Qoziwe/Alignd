import { ProfileParseResult } from "../../types/parser";
import { normalizeProfileUrl } from "../../utils/url";
import { instagramAdapter } from "./instagram";
import { tiktokAdapter } from "./tiktok";

const adapters = [instagramAdapter, tiktokAdapter];

export async function parseProfile(profileUrl: string): Promise<ProfileParseResult> {
  const normalized = normalizeProfileUrl(profileUrl);
  const adapter = adapters.find((item) => item.canHandle(normalized.normalizedUrl));

  if (!adapter) {
    throw new Error("Для этой платформы адаптер пока не подключен.");
  }

  return adapter.parseProfile(normalized.normalizedUrl);
}
