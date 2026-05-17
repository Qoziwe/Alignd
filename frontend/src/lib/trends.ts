export type ApiTrendPlatform = 'tiktok' | 'instagram' | 'reels' | 'shorts' | 'youtube_shorts';
export type TrendPlatform = 'TikTok' | 'Instagram' | 'Reels' | 'Shorts';
export type TrendLifecycle = 'underground' | 'emerging' | 'breakout';
export type TrendLifecycleStage = TrendLifecycle | 'saturated' | 'dead';

export type ApiTrend = {
  id: string;
  title: string;
  description: string;
  platform: ApiTrendPlatform;
  countryOrigin: string;
  viralScore: number;
  saturationSng: number;
  lifecycleStage: TrendLifecycle;
};

export type TrendCardData = {
  id: string;
  lifecycle: TrendLifecycle;
  platform: TrendPlatform;
  viral_score: number;
  title: string;
  description: string;
  saturation_sng: number;
  country_origin: string;
};

export type TrendFilterValue = 'all' | ApiTrendPlatform;

export const platformLabels: Record<ApiTrendPlatform, TrendPlatform> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  reels: 'Reels',
  shorts: 'Shorts',
  youtube_shorts: 'Shorts',
};

export const trendFilterParam = 'trend_platform';

export function apiTrendToCardData(trend: ApiTrend): TrendCardData {
  return {
    id: trend.id,
    lifecycle: trend.lifecycleStage,
    platform: platformLabels[trend.platform],
    viral_score: trend.viralScore,
    title: trend.title,
    description: trend.description,
    saturation_sng: trend.saturationSng,
    country_origin: trend.countryOrigin,
  };
}

export function parseTrendFilterValue(value: string | null): TrendFilterValue {
  if (
    value === 'tiktok' ||
    value === 'instagram' ||
    value === 'reels' ||
    value === 'shorts' ||
    value === 'youtube_shorts'
  ) {
    return value;
  }

  return 'all';
}
