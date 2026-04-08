export async function fetchText(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "text/html,application/json",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Сервис вернул ошибку ${response.status}.`);
  }

  return response.text();
}

export function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function extractJsonBlock(page: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = page.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export function truncatePosts<T>(items: T[], maxItems = 20) {
  return items.slice(0, maxItems);
}

export function toIsoDate(unixSeconds?: number) {
  if (!unixSeconds) {
    return undefined;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

export function extractCaption(candidate: unknown) {
  if (typeof candidate === "string") {
    return candidate.trim();
  }

  return "";
}

export function readFirstString(...values: unknown[]) {
  return values.find((value) => typeof value === "string" && value.trim()) as string | undefined;
}

export function readNumber(candidate: unknown) {
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}
