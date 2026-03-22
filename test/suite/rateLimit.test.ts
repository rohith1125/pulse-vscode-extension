import * as assert from 'assert';
import { RateLimiter } from '../../src/utils/rateLimit';

suite('RateLimiter', () => {
  test('allows consumption when tokens available', () => {
    const limiter = new RateLimiter(10);
    assert.strictEqual(limiter.tryConsume(), true);
    assert.strictEqual(limiter.remaining(), 9);
  });

  test('denies consumption when tokens exhausted', () => {
    const limiter = new RateLimiter(2);
    limiter.tryConsume();
    limiter.tryConsume();
    assert.strictEqual(limiter.tryConsume(), false);
  });

  test('remaining() returns full capacity initially', () => {
    const limiter = new RateLimiter(100);
    assert.strictEqual(limiter.remaining(), 100);
  });

  test('multiple consume calls reduce token count', () => {
    const limiter = new RateLimiter(50);
    for (let i = 0; i < 10; i++) {
      limiter.tryConsume();
    }
    assert.strictEqual(limiter.remaining(), 40);
  });

  test('tokens refill after interval elapses', () => {
    const limiter = new RateLimiter(5);
    // Exhaust all tokens
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(limiter.tryConsume(), true);
    }
    assert.strictEqual(limiter.tryConsume(), false);
    assert.strictEqual(limiter.remaining(), 0);

    // Simulate time passing beyond the 1-hour refill interval
    // Access private lastRefill via bracket notation to force refill
    (limiter as any).lastRefill = Date.now() - 3600 * 1000 - 1;

    // After refill interval, tokens should be restored
    assert.strictEqual(limiter.remaining(), 5);
    assert.strictEqual(limiter.tryConsume(), true);
    assert.strictEqual(limiter.remaining(), 4);
  });

  test('tokens do not refill when elapsed time yields less than 1 token', () => {
    const limiter = new RateLimiter(3);
    // Exhaust all tokens
    limiter.tryConsume();
    limiter.tryConsume();
    limiter.tryConsume();
    assert.strictEqual(limiter.remaining(), 0);

    // Set lastRefill to a very short time ago — not enough for even 1 token
    // With 3 tokens/hour, need > 1200s (20 min) for 1 token. Use 10s elapsed.
    (limiter as any).lastRefill = Date.now() - 10_000;

    assert.strictEqual(limiter.remaining(), 0);
    assert.strictEqual(limiter.tryConsume(), false);
  });
});
