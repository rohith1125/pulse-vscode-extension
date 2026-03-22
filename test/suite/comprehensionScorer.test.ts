import * as assert from 'assert';
import { computeRecencyBoost } from '../../src/core/comprehensionScorer';
import { formatTimeAgo } from '../../src/core/decayCalculator';
import { computeDecay } from '../../src/core/decayCalculator';

suite('ComprehensionScorer', () => {
  const HALF_LIFE = 6; // months

  test('recencyBoost returns 1.0 for very recent engagement', () => {
    const now = Math.floor(Date.now() / 1000);
    const boost = computeRecencyBoost(now - 60, now, HALF_LIFE);
    assert.ok(boost > 0.99, `Expected > 0.99, got ${boost}`);
  });

  test('recencyBoost returns ~0.5 after half-life period', () => {
    const now = Math.floor(Date.now() / 1000);
    const halfLifeSeconds = HALF_LIFE * 30.44 * 24 * 3600;
    const boost = computeRecencyBoost(now - halfLifeSeconds, now, HALF_LIFE);
    assert.ok(boost > 0.45 && boost < 0.55, `Expected ~0.5, got ${boost}`);
  });

  test('recencyBoost returns small value for null engagement', () => {
    const now = Math.floor(Date.now() / 1000);
    const boost = computeRecencyBoost(null, now, HALF_LIFE);
    assert.strictEqual(boost, 0.1);
  });

  test('recencyBoost approaches 0 after many half-lives', () => {
    const now = Math.floor(Date.now() / 1000);
    const twoYearsAgo = now - 2 * 365 * 24 * 3600;
    const boost = computeRecencyBoost(twoYearsAgo, now, HALF_LIFE);
    assert.ok(boost < 0.1, `Expected < 0.1, got ${boost}`);
  });
});

suite('DecayCalculator', () => {
  test('formatTimeAgo returns "never" for null', () => {
    assert.strictEqual(formatTimeAgo(null), 'never');
  });

  test('formatTimeAgo returns "just now" for very recent', () => {
    const result = formatTimeAgo(Math.floor(Date.now() / 1000) - 30);
    assert.strictEqual(result, 'just now');
  });

  test('formatTimeAgo returns days for recent engagement', () => {
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 24 * 3600;
    const result = formatTimeAgo(threeDaysAgo);
    assert.ok(result.includes('days'), `Expected 'days', got '${result}'`);
  });

  test('computeDecay isDecayed = true after half-life', () => {
    const now = Math.floor(Date.now() / 1000);
    const sevenMonthsAgo = now - 7 * 30 * 24 * 3600;
    const result = computeDecay(sevenMonthsAgo, 6, 1, 1);
    assert.strictEqual(result.isDecayed, true);
  });

  test('computeDecay isDecayed = false for recent engagement', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = computeDecay(now - 60, 6, 1, 1);
    assert.strictEqual(result.isDecayed, false);
  });
});
