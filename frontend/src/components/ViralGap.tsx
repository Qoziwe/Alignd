import {useEffect, useState} from 'react';
import {Clock3, Globe2, MapPin, Rocket, Target} from 'lucide-react';
import {API_BASE_URL, fetchJson} from '../lib/api';
import {platformLabels, type ApiTrendPlatform} from '../lib/trends';
import RemixModal from './RemixModal';

type GapTrend = {
  id: string;
  title: string;
  platform: ApiTrendPlatform;
  countryOrigin: string;
  viralScore: number;
  saturationSng: number;
  lifecycleStage: 'emerging' | 'breakout';
  opportunityScore: number;
  predictedBreakout: string;
};

type GapResponse = {
  items: GapTrend[];
  total: number;
};

const clampStyle2 = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
} as const;

function scoreClassName(score: number) {
  if (score > 60) {
    return 'bg-gradient-to-r from-[#e840a8] to-[#a855f7] bg-clip-text text-transparent';
  }

  if (score >= 40) {
    return 'text-[#a855f7]';
  }

  return 'text-[var(--color-text-muted)]';
}

function GapSkeletonCard() {
  return (
    <article
      className="min-h-[286px] rounded-[20px] border border-[var(--color-border-default)] bg-[var(--color-background-surface)] p-5"
      style={{animation: 'viral-gap-pulse 1.4s ease-in-out infinite'}}
    >
      <div className="h-12 w-24 rounded-xl bg-[rgba(168,85,247,0.16)]" />
      <div className="mt-5 h-4 w-4/5 rounded-full bg-[rgba(168,85,247,0.14)]" />
      <div className="mt-2 h-4 w-3/5 rounded-full bg-[rgba(168,85,247,0.1)]" />
      <div className="mt-7 grid grid-cols-2 gap-3">
        <div className="h-10 rounded-[12px] bg-[rgba(168,85,247,0.1)]" />
        <div className="h-10 rounded-[12px] bg-[rgba(168,85,247,0.1)]" />
      </div>
      <div className="mt-6 h-[6px] rounded-full bg-[rgba(168,85,247,0.12)]" />
      <div className="mt-7 flex items-center justify-between">
        <div className="h-8 w-28 rounded-full bg-[rgba(168,85,247,0.12)]" />
        <div className="h-9 w-28 rounded-[12px] bg-[rgba(232,64,168,0.12)]" />
      </div>
    </article>
  );
}

function GapCard({trend, onUse}: {trend: GapTrend; onUse: (trend: GapTrend) => void}) {
  const saturation = Math.max(0, Math.min(100, trend.saturationSng));
  const freeWidth = Math.max(0, 100 - saturation);
  const isBreakout = trend.lifecycleStage === 'breakout';
  const BreakoutIcon = isBreakout ? Rocket : Clock3;

  return (
    <article className="flex min-h-[286px] flex-col rounded-[20px] border border-[var(--color-border-default)] bg-[var(--color-background-surface)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.16)] transition-all duration-300 ease-in-out hover:border-[var(--color-accent-secondary)] hover:shadow-[0_0_20px_rgba(232,64,168,0.12)]">
      <div className="flex items-end gap-3">
        <div className={`text-[46px] font-extrabold leading-none ${scoreClassName(trend.opportunityScore)}`}>
          {trend.opportunityScore}
        </div>
        <div className="pb-2 text-[11px] font-semibold uppercase leading-tight text-[var(--color-text-muted)]">
          opportunity score
        </div>
      </div>

      <h3
        className="mt-5 min-h-[42px] overflow-hidden text-[15px] font-semibold leading-[1.38] text-[var(--color-text-heading)]"
        style={clampStyle2}
      >
        {trend.title}
      </h3>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-[12px] border border-[var(--color-border-default)] bg-[rgba(168,85,247,0.06)] px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <Globe2 size={14} className="shrink-0 text-[var(--color-accent-secondary)]" />
            Запад
          </div>
          <div className="mt-1 text-[15px] font-bold text-[var(--color-text-heading)]">{trend.viralScore}%</div>
        </div>
        <div className="rounded-[12px] border border-[var(--color-border-default)] bg-[rgba(168,85,247,0.06)] px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <MapPin size={14} className="shrink-0 text-[var(--color-accent-primary)]" />
            СНГ
          </div>
          <div className="mt-1 text-[15px] font-bold text-[var(--color-text-heading)]">{trend.saturationSng}%</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
          <span>занято</span>
          <span>свободно</span>
        </div>
        <div className="flex h-[6px] overflow-hidden rounded-full bg-[rgba(168,85,247,0.08)]">
          <div
            className="h-full rounded-full bg-[rgba(232,64,168,0.6)]"
            style={{width: `${saturation}%`}}
          />
          <div
            className="h-full min-w-0 flex-1 border border-dashed border-[rgba(168,85,247,0.3)] bg-[rgba(168,85,247,0.08)]"
            style={{width: `${freeWidth}%`}}
          />
        </div>
      </div>

      <div className="mt-5">
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold ${
            isBreakout
              ? 'border-[rgba(52,211,153,0.32)] bg-[rgba(52,211,153,0.12)] text-[#86efac]'
              : 'border-[rgba(168,85,247,0.3)] bg-[rgba(168,85,247,0.15)] text-[#d8c5ff]'
          }`}
        >
          <BreakoutIcon size={14} />
          {trend.predictedBreakout}
        </span>
      </div>

      <div className="mt-auto flex items-center justify-between gap-4 pt-6">
        <div className="min-w-0 text-[13px] font-semibold text-[var(--color-text-muted)]">
          <span className="text-[var(--color-text-heading)]">{platformLabels[trend.platform]}</span>
          <span className="mx-2 text-[var(--color-border-default)]">/</span>
          <span>{trend.countryOrigin}</span>
        </div>
        <button
          type="button"
          onClick={() => onUse(trend)}
          className="shrink-0 rounded-[12px] border border-[var(--color-accent-primary)] px-[14px] py-[6px] text-[13px] font-semibold text-[var(--color-accent-primary)] transition-colors hover:bg-[rgba(232,64,168,0.1)]"
        >
          Использовать -&gt;
        </button>
      </div>
    </article>
  );
}

export default function ViralGap() {
  const [items, setItems] = useState<GapTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [selectedTrend, setSelectedTrend] = useState<GapTrend | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let didCancel = false;

    setLoading(true);
    setHasError(false);

    fetchJson<GapResponse>(`${API_BASE_URL}/trends/gap-opportunities`, {
      signal: controller.signal,
    })
      .then((payload) => {
        if (didCancel) {
          return;
        }
        setItems(payload.items);
      })
      .catch(() => {
        if (didCancel) {
          return;
        }
        setHasError(true);
        setItems([]);
      })
      .finally(() => {
        if (!didCancel) {
          setLoading(false);
        }
      });

    return () => {
      didCancel = true;
      controller.abort();
    };
  }, []);

  if (!loading && (hasError || items.length === 0)) {
    return null;
  }

  return (
    <section className="mt-10 sm:mt-12 lg:mt-14">
      <style>
        {`@keyframes viral-gap-pulse{0%,100%{opacity:.4}50%{opacity:.8}}`}
      </style>

      <div className="mb-5 sm:mb-6">
        <h2 className="flex items-center gap-3 text-[24px] font-extrabold leading-tight text-[var(--color-text-heading)] sm:text-[28px]">
          <Target size={26} aria-hidden="true" className="shrink-0 text-[var(--color-accent-primary)]" />
          СНГ Viral Gap
        </h2>
        <p className="mt-2 text-[15px] leading-[1.45] text-[var(--color-text-muted)] sm:text-[16px]">
          Западные тренды, которые ещё не добрались до СНГ
        </p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div className="grid auto-cols-[minmax(280px,82vw)] grid-flow-col gap-4 md:auto-cols-auto md:grid-flow-row md:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({length: 3}).map((_, index) => <GapSkeletonCard key={index} />)
            : items.map((trend) => <GapCard key={trend.id} trend={trend} onUse={setSelectedTrend} />)}
        </div>
      </div>

      {selectedTrend && (
        <RemixModal
          trendId={selectedTrend.id}
          trendTitle={selectedTrend.title}
          onClose={() => setSelectedTrend(null)}
        />
      )}
    </section>
  );
}
