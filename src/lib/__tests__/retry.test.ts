import { vi } from "vitest";
import { withRetry } from "../retry";

const TINY = { baseDelayMs: 1, maxDelayMs: 2 };

describe("withRetry", () => {
  it("returns result on first successful call", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { shouldRetry: () => true, ...TINY });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds on second attempt", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return "ok";
    });

    const result = await withRetry(fn, { shouldRetry: () => true, ...TINY });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts all attempts and throws the last error", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new Error("persistent");
    });

    await expect(
      withRetry(fn, { shouldRetry: () => true, maxAttempts: 3, ...TINY }),
    ).rejects.toThrow("persistent");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when shouldRetry returns false", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new Error("permanent");
    });

    await expect(
      withRetry(fn, { shouldRetry: () => false, ...TINY }),
    ).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects maxAttempts override", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new Error("fail");
    });

    await expect(
      withRetry(fn, { shouldRetry: () => true, maxAttempts: 5, ...TINY }),
    ).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("delays increase with each retry (exponential backoff)", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new Error("fail");
    });

    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      cb: (...args: unknown[]) => void,
      delay?: number,
    ) => {
      if (delay && delay > 0) delays.push(delay);
      return originalSetTimeout(cb, 0);
    }) as typeof setTimeout);

    await expect(
      withRetry(fn, {
        shouldRetry: () => true,
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 10_000,
      }),
    ).rejects.toThrow("fail");

    // Should have 2 delays (between attempt 1→2 and 2→3)
    expect(delays).toHaveLength(2);
    // Second delay should be larger than first (exponential backoff)
    expect(delays[1]).toBeGreaterThan(delays[0]);

    setTimeoutSpy.mockRestore();
  });

  it("clamps delay to maxDelayMs", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new Error("fail");
    });

    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      cb: (...args: unknown[]) => void,
      delay?: number,
    ) => {
      if (delay && delay > 0) delays.push(delay);
      return originalSetTimeout(cb, 0);
    }) as typeof setTimeout);

    await expect(
      withRetry(fn, {
        shouldRetry: () => true,
        maxAttempts: 4,
        baseDelayMs: 5000,
        maxDelayMs: 8000,
      }),
    ).rejects.toThrow("fail");

    // All delays should be at most maxDelayMs * 1.25 (with jitter up to +25%)
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(8000 * 1.25);
    }

    setTimeoutSpy.mockRestore();
  });

  it("throws if maxAttempts is less than 1", async () => {
    const fn = vi.fn();
    await expect(
      withRetry(fn, { shouldRetry: () => true, maxAttempts: 0, ...TINY }),
    ).rejects.toThrow("maxAttempts must be >= 1");
    expect(fn).not.toHaveBeenCalled();
  });
});
