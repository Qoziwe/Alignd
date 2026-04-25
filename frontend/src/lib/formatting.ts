export function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '—';
  }

  return new Intl.NumberFormat('ru-RU', {
    notation: 'compact',
    maximumFractionDigits: value > 9999 ? 1 : 0,
  }).format(value);
}

export function extractUsername(inputUrl: string) {
  try {
    const parsedUrl = new URL(inputUrl);
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    return (parts[0] || 'username').replace(/^@/, '');
  } catch {
    const cleaned = inputUrl.replace('@', '').trim();
    return cleaned || 'username';
  }
}

export function getInitials(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return 'A';
  }

  return normalized.slice(0, 2).toUpperCase();
}

export function formatAnalysisDate(value: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}
