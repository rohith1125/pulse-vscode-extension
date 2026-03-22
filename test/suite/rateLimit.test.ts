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
});
