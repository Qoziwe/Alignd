import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apiTrendToCardData,
  parseTrendFilterValue,
  trendFilterParam,
} from '../src/lib/trends';

test('parseTrendFilterValue accepts supported platforms', () => {
  assert.equal(parseTrendFilterValue('tiktok'), 'tiktok');
  assert.equal(parseTrendFilterValue('youtube_shorts'), 'youtube_shorts');
});

test('parseTrendFilterValue falls back to all for unknown values', () => {
  assert.equal(parseTrendFilterValue('threads'), 'all');
  assert.equal(parseTrendFilterValue(null), 'all');
});

test('apiTrendToCardData maps API trend shape to card trend shape', () => {
  const card = apiTrendToCardData({
    id: 'trend-1',
    title: 'Trend title',
    description: 'Trend description',
    platform: 'reels',
    countryOrigin: 'US',
    viralScore: 82,
    saturationSng: 18,
    lifecycleStage: 'emerging',
  });

  assert.equal(card.platform, 'Reels');
  assert.equal(card.viral_score, 82);
  assert.equal(card.saturation_sng, 18);
});

test('trendFilterParam is stable for shareable radar filters', () => {
  assert.equal(trendFilterParam, 'trend_platform');
});
