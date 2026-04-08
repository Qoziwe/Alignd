export function formatCount(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return new Intl.NumberFormat("ru-RU", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(value?: string) {
  if (!value) {
    return "Дата не найдена";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
  }).format(parsed);
}
