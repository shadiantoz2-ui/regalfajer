import { describe, expect, it } from "vitest";
import { createSingleflight, TtlCache } from "@/lib/server/request-cache";
import {
  computeQuotaCooldownMs,
  createConcurrencyLimiter,
  extractApiErrorStatus,
  GEMINI_TRANSCRIBE_MODELS,
  ModelCooldownTracker,
  parseRetryDelaySeconds,
  QueueOverloadedError,
  shouldFallbackToNextModel,
} from "@/lib/server/transcribe-resilience";

describe("Transcription resilience and high-load caching", () => {
  it("extracts 429 quota status and retry delay from Gemini ApiError payloads", () => {
    const err = {
      status: 429,
      message:
        '{"error":{"code":429,"message":"Generate content requests per day limit exceeded on Free Tier. Please retry in 41m43.2s.","details":[{"retryDelay":"2503s"}]}}',
    };
    expect(extractApiErrorStatus(err)).toBe(429);
    expect(parseRetryDelaySeconds(err)).toBe(2503);
    expect(computeQuotaCooldownMs(err)).toBe(2_503_000);
    expect(shouldFallbackToNextModel(429)).toBe(true);
    expect(shouldFallbackToNextModel(403)).toBe(false);
  });

  it("bypasses exhausted models in cooldown tracker and recovers cleanly", () => {
    const tracker = new ModelCooldownTracker(GEMINI_TRANSCRIBE_MODELS);
    const now = 500_000;
    tracker.markQuotaExceeded("gemini-3.5-transcribe", { status: 429, message: "retryDelay: \"60s\"" }, now);
    expect(tracker.getAvailableModels(now + 1000)).toEqual(["gemini-4-hydrogen", "gemini-3.1-flash-lite"]);
    expect(tracker.getAvailableModels(now + 65_000)).toEqual([
      "gemini-3.5-transcribe",
      "gemini-4-hydrogen",
      "gemini-3.1-flash-lite",
    ]);
  });

  it("bounds concurrent upstream calls and sheds excess queue bursts with 429", async () => {
    const limiter = createConcurrencyLimiter(1, 1);
    let release!: () => void;
    const p1 = limiter.run(
      () =>
        new Promise<string>((r) => {
          release = () => r("first");
        }),
    );
    const p2 = limiter.run(async () => "second");
    await expect(limiter.run(async () => "overflow")).rejects.toBeInstanceOf(QueueOverloadedError);
    release();
    expect(await Promise.all([p1, p2])).toEqual(["first", "second"]);
  });

  it("coalesces concurrent identical reads and invalidates TTL cache by prefix", async () => {
    const sf = createSingleflight();
    let count = 0;
    const results = await Promise.all([
      sf.run("students", async () => {
        count += 1;
        return ["a"];
      }),
      sf.run("students", async () => {
        count += 1;
        return ["a"];
      }),
    ]);
    expect(count).toBe(1);
    expect(results).toEqual([["a"], ["a"]]);

    const cache = new TtlCache<boolean>(1000, 10);
    cache.set("k1", true, 100);
    expect(cache.get("k1", 500)).toBe(true);
    expect(cache.get("k1", 1200)).toBeUndefined();
  });
});
