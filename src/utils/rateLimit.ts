/**
 * Token bucket rate limiter.
 * Allows up to `maxTokens` operations per `intervalMs`.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;

  constructor(maxTokensPerHour: number) {
    this.maxTokens = maxTokensPerHour;
    this.tokens = maxTokensPerHour;
    this.lastRefill = Date.now();
    this.refillIntervalMs = 3600 * 1000; // 1 hour
  }

  /** Returns true if a token is available and consumes it. Returns false if rate limited. */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  /** Waits until a token is available, then consumes it. */
  async consume(): Promise<void> {
    while (!this.tryConsume()) {
      await delay(1000);
    }
  }

  /** Returns how many tokens remain. */
  remaining(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.refillIntervalMs) {
      this.tokens = this.maxTokens;
      this.lastRefill = now;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Wraps a function with exponential backoff on 429/rate-limit errors */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status !== 429 && status !== 403) { throw err; }
      if (attempt >= maxRetries) { throw err; }
      const waitMs = Math.min(1000 * Math.pow(2, attempt), 60000);
      await delay(waitMs);
      attempt++;
    }
  }
}
