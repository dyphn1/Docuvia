import { isRateLimitError } from "@workspace/integrations-openai-ai-server";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface TokenBucketOptions {
  /** Maximum tokens the bucket can hold (burst size). */
  capacity: number;
  /** Tokens added back per refill interval. */
  refillAmount: number;
  /** Refill interval in milliseconds. */
  refillIntervalMs: number;
}

/**
 * TokenBucket — proactive throttle for LLM API calls (ADR-032).
 *
 * Each call consumes one token; when the bucket is empty, callers wait until
 * the next refill instead of hammering the provider into a 429.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(private readonly options: TokenBucketOptions) {
    if (options.capacity < 1 || options.refillAmount < 1 || options.refillIntervalMs < 1) {
      throw new Error("[TokenBucket] capacity, refillAmount and refillIntervalMs must be >= 1");
    }
    this.tokens = options.capacity;
    this.lastRefillAt = Date.now();
  }

  /** Current token count (after applying any elapsed refills). */
  public get available(): number {
    this.refill();
    return this.tokens;
  }

  /** Consumes a token immediately if one is available. */
  public tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return true;
    }
    return false;
  }

  /** Waits (via refill schedule) until a token can be consumed. */
  public async acquire(): Promise<void> {
    while (!this.tryAcquire()) {
      const elapsed = Date.now() - this.lastRefillAt;
      const waitMs = Math.max(1, this.options.refillIntervalMs - elapsed);
      await sleep(waitMs);
    }
  }

  private refill(): void {
    const now = Date.now();
    const intervals = Math.floor((now - this.lastRefillAt) / this.options.refillIntervalMs);
    if (intervals > 0) {
      this.tokens = Math.min(
        this.options.capacity,
        this.tokens + intervals * this.options.refillAmount
      );
      this.lastRefillAt += intervals * this.options.refillIntervalMs;
    }
  }
}

export interface BackoffOptions {
  /** Maximum retries after the initial attempt. */
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
  factor: number;
}

export interface LlmRateLimiterOptions {
  bucket?: TokenBucketOptions;
  backoff?: BackoffOptions;
}

const DEFAULT_BUCKET: TokenBucketOptions = {
  capacity: 10,
  refillAmount: 1,
  refillIntervalMs: 1_000,
};

const DEFAULT_BACKOFF: BackoffOptions = {
  retries: 5,
  minDelayMs: 1_000,
  maxDelayMs: 30_000,
  factor: 2,
};

/**
 * LlmRateLimiter — Token Bucket + Exponential Backoff wrapper for LLM calls (ADR-032).
 *
 * Every execution first acquires a bucket token (proactive throttling). If the
 * provider still responds with a rate-limit error, the call is retried with
 * exponential backoff; non-rate-limit errors are rethrown immediately.
 */
export class LlmRateLimiter {
  private readonly bucket: TokenBucket;
  private readonly backoff: BackoffOptions;

  constructor(options: LlmRateLimiterOptions = {}) {
    this.bucket = new TokenBucket(options.bucket ?? DEFAULT_BUCKET);
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.backoff.retries; attempt++) {
      await this.bucket.acquire();
      try {
        return await fn();
      } catch (error: unknown) {
        if (!isRateLimitError(error)) {
          throw error;
        }
        lastError = error;
        if (attempt < this.backoff.retries) {
          const delay = Math.min(
            this.backoff.maxDelayMs,
            this.backoff.minDelayMs * Math.pow(this.backoff.factor, attempt)
          );
          await sleep(delay);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
