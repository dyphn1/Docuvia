import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TokenBucket, LlmRateLimiter } from "./llm-rate-limiter.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow bursts up to capacity and then reject", () => {
    // Arrange
    const bucket = new TokenBucket({ capacity: 3, refillAmount: 1, refillIntervalMs: 1000 });

    // Act / Assert
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(false);
  });

  it("should refill tokens after the refill interval elapses", () => {
    // Arrange
    const bucket = new TokenBucket({ capacity: 2, refillAmount: 1, refillIntervalMs: 1000 });
    bucket.tryAcquire();
    bucket.tryAcquire();
    expect(bucket.tryAcquire()).toBe(false);

    // Act
    vi.advanceTimersByTime(1000);

    // Assert
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(false);
  });

  it("should never refill beyond capacity", () => {
    // Arrange
    const bucket = new TokenBucket({ capacity: 2, refillAmount: 5, refillIntervalMs: 100 });

    // Act
    vi.advanceTimersByTime(10_000);

    // Assert
    expect(bucket.available).toBe(2);
  });

  it("should make acquire() wait until a token is refilled", async () => {
    // Arrange
    const bucket = new TokenBucket({ capacity: 1, refillAmount: 1, refillIntervalMs: 1000 });
    expect(bucket.tryAcquire()).toBe(true);

    let acquired = false;
    const pending = bucket.acquire().then(() => {
      acquired = true;
    });

    // Act — not yet refilled
    await vi.advanceTimersByTimeAsync(500);
    expect(acquired).toBe(false);

    // Refill boundary crossed
    await vi.advanceTimersByTimeAsync(600);
    await pending;

    // Assert
    expect(acquired).toBe(true);
  });
});

describe("LlmRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should back off exponentially on rate-limit errors and eventually succeed", async () => {
    // Arrange
    const limiter = new LlmRateLimiter({
      bucket: { capacity: 10, refillAmount: 10, refillIntervalMs: 100 },
      backoff: { retries: 3, minDelayMs: 1000, maxDelayMs: 30_000, factor: 2 },
    });
    const attemptTimes: number[] = [];
    let calls = 0;
    const fn = vi.fn(async () => {
      attemptTimes.push(Date.now());
      calls++;
      if (calls < 3) {
        throw new Error("429 Too Many Requests");
      }
      return "ok";
    });

    // Act
    const promise = limiter.execute(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    // Assert — delays of 1000ms then 2000ms (factor 2)
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(attemptTimes[1] - attemptTimes[0]).toBeGreaterThanOrEqual(1000);
    expect(attemptTimes[2] - attemptTimes[1]).toBeGreaterThanOrEqual(2000);
  });

  it("should rethrow the rate-limit error once retries are exhausted", async () => {
    // Arrange
    const limiter = new LlmRateLimiter({
      bucket: { capacity: 10, refillAmount: 10, refillIntervalMs: 100 },
      backoff: { retries: 2, minDelayMs: 10, maxDelayMs: 100, factor: 2 },
    });
    const fn = vi.fn(async () => {
      throw new Error("rate limit exceeded");
    });

    // Act
    const promise = limiter.execute(fn);
    const assertion = expect(promise).rejects.toThrow("rate limit exceeded");
    await vi.runAllTimersAsync();

    // Assert — initial attempt + 2 retries
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should rethrow non-rate-limit errors immediately without retrying", async () => {
    // Arrange
    const limiter = new LlmRateLimiter({
      bucket: { capacity: 10, refillAmount: 10, refillIntervalMs: 100 },
      backoff: { retries: 5, minDelayMs: 1000, maxDelayMs: 30_000, factor: 2 },
    });
    const fn = vi.fn(async () => {
      throw new Error("invalid request payload");
    });

    // Act / Assert
    await expect(limiter.execute(fn)).rejects.toThrow("invalid request payload");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should throttle calls through the token bucket", async () => {
    // Arrange — 1 token, refills 1 per second
    const limiter = new LlmRateLimiter({
      bucket: { capacity: 1, refillAmount: 1, refillIntervalMs: 1000 },
      backoff: { retries: 0, minDelayMs: 1, maxDelayMs: 1, factor: 1 },
    });
    const completionTimes: number[] = [];
    const call = () =>
      limiter.execute(async () => {
        completionTimes.push(Date.now());
        return "done";
      });

    // Act
    const promise = Promise.all([call(), call()]);
    await vi.runAllTimersAsync();
    await promise;

    // Assert — second call had to wait for a refill
    expect(completionTimes).toHaveLength(2);
    expect(completionTimes[1] - completionTimes[0]).toBeGreaterThanOrEqual(1000);
  });
});
