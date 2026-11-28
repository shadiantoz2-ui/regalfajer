import assert from "node:assert/strict";
import test from "node:test";
import { createSingleflight, TtlCache } from "./request-cache";
import {
  computeQuotaCooldownMs,
  createConcurrencyLimiter,
  extractApiErrorStatus,
  GEMINI_TRANSCRIBE_MODELS,
  isDailyQuotaExhausted,
  ModelCooldownTracker,
  parseRetryDelaySeconds,
  QueueOverloadedError,
  shouldFallbackToNextModel,
  UpstreamTimeoutError,
  withTimeout,
} from "./transcribe-resilience";

const SAMPLE_429_ERROR = {
  status: 429,
  message: JSON.stringify({
    error: {
      code: 429,
      message:
        "You exceeded your current quota... Generate content requests per day limit exceeded on Free Tier.\nPlease retry in 41m43.254917774s.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            {
              quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
              quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
              quotaValue: "25",
            },
          ],
        },
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "2503s",
        },
      ],
    },
  }),
};

test("parses Gemini 429 daily quota error status, retryDelay, and cooldown accurately", () => {
  assert.equal(extractApiErrorStatus(SAMPLE_429_ERROR), 429);
  assert.equal(parseRetryDelaySeconds(SAMPLE_429_ERROR), 2503);
  assert.equal(isDailyQuotaExhausted(SAMPLE_429_ERROR), true);
  assert.equal(computeQuotaCooldownMs(SAMPLE_429_ERROR), 2_503_000);
  assert.equal(shouldFallbackToNextModel(429), true);
  assert.equal(shouldFallbackToNextModel(503), true);
  assert.equal(shouldFallbackToNextModel(401), false);
  assert.equal(shouldFallbackToNextModel(403), false);
});

test("ModelCooldownTracker bypasses exhausted models and recovers after cooldown expiry", () => {
  const tracker = new ModelCooldownTracker(GEMINI_TRANSCRIBE_MODELS);
  const t0 = 1_000_000;

  assert.deepEqual(tracker.getAvailableModels(t0), [
    "gemini-3.5-transcribe",
    "gemini-4-hydrogen",
    "gemini-3.1-flash-lite",
  ]);

  tracker.markQuotaExceeded("gemini-3.5-transcribe", SAMPLE_429_ERROR, t0);
  assert.deepEqual(tracker.getAvailableModels(t0 + 5_000), [
    "gemini-4-hydrogen",
    "gemini-3.1-flash-lite",
  ]);

  tracker.markTransientFailure("gemini-4-hydrogen", t0, 15_000);
  assert.deepEqual(tracker.getAvailableModels(t0 + 5_000), ["gemini-3.1-flash-lite"]);

  tracker.markQuotaExceeded("gemini-3.1-flash-lite", { status: 429, message: "retryDelay: \"30s\"" }, t0);
  assert.deepEqual(tracker.getAvailableModels(t0 + 5_000), []);
  assert.ok(tracker.getShortestCooldownRemainingSeconds(t0 + 5_000) > 0);

  // Transient cooldown on gemini-4-hydrogen expires after 15s
  assert.deepEqual(tracker.getAvailableModels(t0 + 16_000), ["gemini-4-hydrogen"]);
});

test("createConcurrencyLimiter caps concurrent calls and rejects excess queue bursts", async () => {
  const limiter = createConcurrencyLimiter(2, 1);
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;

  const p1 = limiter.run(
    () =>
      new Promise<string>((r) => {
        releaseFirst = () => r("one");
      }),
  );
  const p2 = limiter.run(
    () =>
      new Promise<string>((r) => {
        releaseSecond = () => r("two");
      }),
  );
  const p3 = limiter.run(async () => "three");

  assert.deepEqual(limiter.stats(), { active: 2, queued: 1 });
  await assert.rejects(() => limiter.run(async () => "overflow"), QueueOverloadedError);

  releaseFirst();
  releaseSecond();
  assert.deepEqual(await Promise.all([p1, p2, p3]), ["one", "two", "three"]);
  assert.deepEqual(limiter.stats(), { active: 0, queued: 0 });
});

test("withTimeout rejects hung promises cleanly", async () => {
  const hung = new Promise<string>(() => {});
  await assert.rejects(() => withTimeout(hung, 20), UpstreamTimeoutError);
  assert.equal(await withTimeout(Promise.resolve("ok"), 200), "ok");
});

test("createSingleflight coalesces concurrent identical reads and TtlCache expires/invalidates", async () => {
  const sf = createSingleflight();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 15));
    return "shared-result";
  };

  const results = await Promise.all([sf.run("k", loader), sf.run("k", loader), sf.run("k", loader)]);
  assert.deepEqual(results, ["shared-result", "shared-result", "shared-result"]);
  assert.equal(calls, 1);

  const cache = new TtlCache<number>(500, 2);
  cache.set("a", 1, 100);
  cache.set("b", 2, 100);
  assert.equal(cache.get("a", 200), 1);
  assert.equal(cache.get("a", 650), undefined);
  cache.set("p:1", 10, 100);
  cache.set("p:2", 20, 100);
  cache.deleteByPrefix("p:");
  assert.equal(cache.get("p:1", 150), undefined);
});
