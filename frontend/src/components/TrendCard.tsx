import {useState} from 'react';
import RemixModal from './RemixModal';
import type {TrendCardData, TrendLifecycle, TrendPlatform} from '../lib/trends';
export type {TrendCardData, TrendLifecycle, TrendPlatform} from '../lib/trends';

type TrendCardProps = {
  trend: TrendCardData;
  isAuthenticated?: boolean;
};

const lifecycleStyles: Record<TrendLifecycle, {label: string; className: string}> = {
  underground: {
    label: 'underground',
    className: 'border-[#7c6fa0] bg-[rgba(124,111,160,0.2)] text-[#c4b8e0]',
  },
  emerging: {
    label: 'emerging',
    className: 'border-[#a855f7] bg-[rgba(168,85,247,0.2)] text-[#d8c5ff]',
  },
  breakout: {
    label: 'breakout',
    className: 'border-[#e840a8] bg-[rgba(232,64,168,0.2)] text-[#ffb1df]',
  },
};

const platformStyles: Record<TrendPlatform, string> = {
  TikTok: 'text-[#25f4ee]',
  Instagram: 'text-[#e840a8]',
  Reels: 'text-[#a855f7]',
  Shorts: 'text-[#ff4d5d]',
};

const clampStyle2 = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
} as const;

const clampStyle3 = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 3,
} as const;

export default function TrendCard({trend, isAuthenticated = true}: TrendCardProps) {
  const lifecycle = lifecycleStyles[trend.lifecycle];
  const saturation = Math.max(0, Math.min(100, trend.saturation_sng));
  const [isRemixOpen, setIsRemixOpen] = useState(false);
  const [showAuthToast, setShowAuthToast] = useState(false);

  const handleRemixClick = () => {
    if (!isAuthenticated) {
      setShowAuthToast(true);
      window.setTimeout(() => setShowAuthToast(false), 2200);
      return;
    }

    setIsRemixOpen(true);
  };

  return (
    <article className="relative flex min-h-[360px] flex-col rounded-[20px] border border-[var(--color-border-default)] bg-[rgba(14,13,20,0.78)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur-md transition-all duration-300 ease-in-out hover:border-[var(--color-accent-secondary)] hover:shadow-[0_0_20px_rgba(168,85,247,0.15)]">
      {showAuthToast && (
        <div className="fixed bottom-5 left-1/2 z-[600] -translate-x-1/2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-background-elevated)] px-4 py-2 text-[13px] font-semibold text-[var(--color-text-heading)] shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          Войдите, чтобы использовать Remix
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-bold uppercase leading-none ${lifecycle.className}`}
        >
          {lifecycle.label}
        </span>
        <span className={`text-[12px] font-bold leading-none ${platformStyles[trend.platform]}`}>
          {trend.platform}
        </span>
      </div>

      <div className="mt-6 flex items-end gap-3">
        <div className="bg-gradient-to-r from-[#e840a8] to-[#a855f7] bg-clip-text text-[48px] font-extrabold leading-none text-transparent">
          {trend.viral_score}
        </div>
        <div className="pb-2 text-[12px] font-semibold uppercase leading-tight text-[var(--color-text-muted)]">
          viral score
        </div>
      </div>

      <h3
        className="mt-5 overflow-hidden text-[16px] font-semibold leading-[1.32] text-[var(--color-text-heading)]"
        style={clampStyle2}
      >
        {trend.title}
      </h3>

      <p
        className="mt-3 overflow-hidden text-[13px] leading-[1.45] text-[var(--color-text-muted)]"
        style={clampStyle3}
      >
        {trend.description}
      </p>

      <div className="mt-auto pt-6">
        <div className="mb-2 flex items-center justify-between gap-3 text-[12px] text-[var(--color-text-muted)]">
          <span>Насыщенность в СНГ</span>
          <span>{saturation}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[rgba(168,85,247,0.1)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#e840a8] to-[#a855f7]"
            style={{width: `${saturation}%`}}
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="text-[15px] font-semibold text-[var(--color-text-heading)]">
          {trend.country_origin}
        </span>
        <button
          type="button"
          onClick={handleRemixClick}
          className="rounded-[12px] border border-[var(--color-accent-primary)] px-[14px] py-[6px] text-[13px] font-semibold text-[var(--color-accent-primary)] transition-colors hover:bg-[rgba(232,64,168,0.1)]"
        >
          Remix -&gt;
        </button>
      </div>

      {isRemixOpen && (
        <RemixModal
          trendId={trend.id}
          trendTitle={trend.title}
          onClose={() => setIsRemixOpen(false)}
        />
      )}
    </article>
  );
}
