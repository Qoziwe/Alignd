import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractUsername,
  formatCompactNumber,
  formatAnalysisDate,
  getInitials,
} from '../src/lib/formatting';

test('extractUsername reads username from instagram url', () => {
  assert.equal(extractUsername('https://www.instagram.com/alignd.team/'), 'alignd.team');
});

test('extractUsername supports @username format', () => {
  assert.equal(extractUsername('@alignd.team'), 'alignd.team');
});

test('extractUsername strips TikTok @ path prefix', () => {
  assert.equal(extractUsername('https://www.tiktok.com/@alignd.team'), 'alignd.team');
});

test('formatCompactNumber returns dash for empty values', () => {
  assert.equal(formatCompactNumber(null), '—');
});

test('getInitials returns first two characters', () => {
  assert.equal(getInitials('Alignd'), 'AL');
});

test('formatAnalysisDate returns human readable string', () => {
  const formatted = formatAnalysisDate('2026-04-09T12:30:00+00:00');
  assert.ok(formatted.length > 0);
});
