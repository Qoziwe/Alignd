import {useEffect, useState} from 'react';
import {Radio} from 'lucide-react';
import ooppssieMaskot from '../../assets/ooppssieMaskot.png';
import {API_BASE_URL} from '../lib/api';
import TrendCard, {type TrendCardData, type TrendPlatform} from './TrendCard';

type ApiTrendPlatform = 'tiktok' | 'instagram' | 'reels' | 'shorts' | 'youtube_shorts';
type TrendFilter = {
  label: string;
  value: 'all' | ApiTrendPlatform;
};

type ApiTrend = {
  id: string;
  title: string;
  description: string;
  platform: ApiTrendPlatform;
  countryOrigin: string;
  viralScore: number;
  saturationSng: number;
  lifecycleStage: TrendCardData['lifecycle'];
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

const platformLabels: Record<ApiTrendPlatform, TrendPlatform> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  reels: 'Reels',
  shorts: 'Shorts',
  youtube_shorts: 'Shorts',
};

type UpseeProps = {
  mood: 'sleeping';
};

function Upsee({mood}: UpseeProps) {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center" aria-label={`Upsee ${mood}`}>
      <img src={ooppssieMaskot} alt="" className="h-full w-full object-contain opacity-80" />
      <span className="absolute right-1 top-1 text-[22px]" aria-hidden="true">
        zzz
      </span>
    </div>
  );
}

type ViralRadarProps = {
  isAuthenticated?: boolean;
};

export default function ViralRadar({isAuthenticated = true}: ViralRadarProps) {
  const [activeFilter, setActiveFilter] = useState<TrendFilter>(filters[0]);
  const [trends, setTrends] = useState<TrendCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({per_page: '12'});

    if (activeFilter.value !== 'all') {
      params.set('platform', activeFilter.value);
    }

    setLoading(true);
    setErrorMessage('');

    fetch(`${API_BASE_URL}/trends/feed?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            payload && typeof payload === 'object' && typeof (payload as {error?: unknown}).error === 'string'
              ? (payload as {error: string}).error
              : 'Не удалось загрузить тренды.',
          );
        }
        return payload as FeedResponse;
      })
      .then((payload) => {
        setTrends(
          payload.items.map((trend) => ({
            id: trend.id,
            lifecycle: trend.lifecycleStage,
            platform: platformLabels[trend.platform],
            viral_score: trend.viralScore,
            title: trend.title,
            description: trend.description,
            saturation_sng: trend.saturationSng,
            country_origin: trend.countryOrigin,
          })),
        );
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
  }, [activeFilter]);

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
          <Upsee mood="sleeping" />
          <p className="mt-4 max-w-[360px] text-[15px] leading-[1.5] text-[var(--color-text-muted)]">
            Скаутеры уже в работе. Тренды скоро появятся здесь
          </p>
        </div>
      )}
    </section>
  );
}
