export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const error =
    typeof (payload as {error?: unknown}).error === 'string'
      ? (payload as {error: string}).error
      : fallback;

  return error;
}

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
    });
  } catch (error) {
    throw new ApiRequestError(error instanceof Error ? error.message : 'Network request failed.', 0);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiRequestError(extractErrorMessage(payload, 'Request failed.'), response.status);
  }

  return payload as T;
}
