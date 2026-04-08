import { ProfileParseResult } from "../types/parser";
import { normalizeProfileUrl } from "../utils/url";

type ParseSuccessResponse = {
  ok: true;
  data: ProfileParseResult;
};

type ParseErrorResponse = {
  ok: false;
  error: string;
};

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_URL;

function normalizeApiBaseUrl(value: string) {
  const candidate = value.trim();

  if (!candidate) {
    throw new Error("Missing EXPO_PUBLIC_API_URL in frontend/.env.");
  }

  return candidate.replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  return normalizeApiBaseUrl(configuredApiBaseUrl ?? "");
}

export async function parseProfile(profileUrl: string): Promise<ProfileParseResult> {
  normalizeProfileUrl(profileUrl);

  const response = await fetch(`${getApiBaseUrl()}/api/parse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: profileUrl }),
  });

  const payload = (await response.json().catch(() => null)) as ParseSuccessResponse | ParseErrorResponse | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload && "error" in payload ? payload.error : `Backend returned ${response.status}.`);
  }

  return payload.data;
}
