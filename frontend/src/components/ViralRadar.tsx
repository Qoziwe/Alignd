import {useEffect, useMemo, useState} from 'react';
import {Radio} from 'lucide-react';
import {API_BASE_URL, fetchJson} from '../lib/api';
import {
  apiTrendToCardData,
  parseTrendFilterValue,
  trendFilterParam,
  type ApiTrend,
  type ApiTrendPlatform,
  type TrendCardData,
  type TrendFilterValue,
} from '../lib/trends';
import TrendCard from './TrendCard';
import Upsee from './Upsee';

type TrendFilter = {
  label: string;
  value: TrendFilterValue;
};

type FeedResponse = {
  items: ApiTrend[];
};

const filters: TrendFilter[] = [
  {label: 'Все', value: 'all'},
  {label: 'TikTok', value: 'tiktok'},
  {label: 'Instagram', value: 'instagram'},
  {label: 'Reels', value: 'reels'},
  {label: 'Shorts', value: 'youtube_shorts'},
];

function readFilterFromUrl() {
  if (typeof window === 'undefined') {
    return filters[0];
  }

  const value = parseTrendFilterValue(new URLSearchParams(window.location.search).get(trendFilterParam));
  return filters.find((filter) => filter.value === value) || filters[0];
}

function syncFilterToUrl(value: TrendFilterValue) {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  if (value === 'all') {
    url.searchParams.delete(trendFilterParam);
  } else {
    url.searchParams.set(trendFilterParam, value);
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

type ViralRadarProps = {
  isAuthenticated?: boolean;
};

export default function ViralRadar({isAuthenticated = true}: ViralRadarProps) {
  const [activeFilter, setActiveFilter] = useState<TrendFilter>(() => readFilterFromUrl());
  const [trends, setTrends] = useState<TrendCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const activePlatform = useMemo(
    () => (activeFilter.value === 'all' ? null : (activeFilter.value as ApiTrendPlatform)),
    [activeFilter.value],
  );

  useEffect(() => {
    syncFilterToUrl(activeFilter.value);
  }, [activeFilter.value]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({per_page: '12'});

    if (activePlatform) {
      params.set('platform', activePlatform);
    }

    setLoading(true);
    setErrorMessage('');

    fetchJson<FeedResponse>(`${API_BASE_URL}/trends/feed?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((payload) => {
        setTrends(payload.items.map(apiTrendToCardData));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить тренды.');
        setTrends([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [activePlatform]);

  return (
    <section className="mt-12 sm:mt-14 lg:mt-16">
      <div className="mb-6 flex flex-col gap-5 lg:mb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="flex items-center gap-3 text-[28px] font-extrabold leading-tight text-[var(--color-text-heading)] sm:text-[32px]">
            <Radio size={28} aria-hidden="true" className="shrink-0 text-[var(--color-accent-primary)]" />
            Viral Radar
          </h2>
          <p className="mt-2 text-[15px] text-[var(--color-text-muted)] sm:text-[16px]">
            Горячие тренды прямо сейчас
          </p>
        </div>

        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {filters.map((filter) => {
            const isActive = filter.value === activeFilter.value;

            return (
              <button
                type="button"
                key={filter.value}
                onClick={() => setActiveFilter(filter)}
                className={`shrink-0 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors sm:text-[14px] ${
                  isActive
                    ? 'border-transparent bg-gradient-to-r from-[#e840a8] to-[#a855f7] text-white'
                    : 'border-[var(--color-border-default)] bg-[rgba(168,85,247,0.08)] text-[var(--color-text-muted)] hover:text-[var(--color-text-heading)]'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div className="rounded-[20px] border border-[var(--color-border-default)] bg-[rgba(14,13,20,0.68)] p-8 text-center text-[15px] text-[var(--color-text-muted)]">
          Загружаем тренды...
        </div>
      )}

      {!loading && errorMessage && (
        <div className="rounded-[20px] border border-[var(--color-border-default)] bg-[rgba(14,13,20,0.68)] p-8 text-center text-[15px] text-[var(--color-text-muted)]">
          {errorMessage}
        </div>
      )}

      {!loading && !errorMessage && trends.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trends.map((trend) => (
            <TrendCard key={trend.id} trend={trend} isAuthenticated={isAuthenticated} />
          ))}
        </div>
      ) : null}

      {!loading && !errorMessage && trends.length === 0 && (
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[20px] border border-[var(--color-border-default)] bg-[rgba(14,13,20,0.68)] p-8 text-center">
          <Upsee mood="sleeping" size={112} />
          <p className="mt-4 max-w-[360px] text-[15px] leading-[1.5] text-[var(--color-text-muted)]">
            Скаутеры уже в работе. Тренды скоро появятся здесь
          </p>
        </div>
      )}
    </section>
  );
}
