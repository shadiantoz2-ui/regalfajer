export const GEMINI_TRANSCRIBE_MODELS = [
  "gemini-3.5-transcribe",
  "gemini-4-hydrogen",
  "gemini-3.1-flash-lite",
] as const;

export type GeminiTranscribeModel = (typeof GEMINI_TRANSCRIBE_MODELS)[number];

const DEFAULT_RPM_COOLDOWN_MS = 45_000;
const MIN_DAILY_COOLDOWN_MS = 120_000;
const MAX_QUOTA_COOLDOWN_MS = 7_200_000; // 2 hours cap to respect full Free Tier retryDelay windows
const TRANSIENT_FAILURE_COOLDOWN_MS = 15_000;

export function extractErrorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "";
  }
}

export function extractApiErrorStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    if ("status" in err && typeof err.status === "number") return err.status;
    if ("statusCode" in err && typeof err.statusCode === "number") return err.statusCode;
    if (
      "error" in err &&
      typeof err.error === "object" &&
      err.error !== null &&
      "code" in err.error &&
      typeof err.error.code === "number"
    ) {
      return err.error.code;
    }
  }
  const msg = extractErrorText(err);
  const jsonCodeMatch = msg.match(/"code"\s*:\s*(\d{3})/);
  if (jsonCodeMatch?.[1]) {
    return Number(jsonCodeMatch[1]);
  }
  return undefined;
}

export function parseRetryDelaySeconds(err: unknown): number | undefined {
  const msg = extractErrorText(err);
  if (!msg) return undefined;

  const jsonRetryMatch = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (jsonRetryMatch?.[1]) {
    const secs = Number(jsonRetryMatch[1]);
    if (Number.isFinite(secs) && secs > 0) return secs;
  }

  const hmsMatch = msg.match(/Please retry in\s+(?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i);
  if (hmsMatch) {
    const hours = Number(hmsMatch[1] ?? 0);
    const mins = Number(hmsMatch[2] ?? 0);
    const secs = Number(hmsMatch[3] ?? 0);
    const total = Math.ceil(hours * 3600 + mins * 60 + secs);
    if (Number.isFinite(total) && total > 0) return total;
  }

  return undefined;
}

export function isDailyQuotaExhausted(err: unknown): boolean {
  const msg = extractErrorText(err);
  return /PerDay|per day|GenerateRequestsPerDay|daily/i.test(msg);
}

export function computeQuotaCooldownMs(err: unknown): number {
  const retrySec = parseRetryDelaySeconds(err);
  if (retrySec !== undefined) {
    const ms = retrySec * 1000;
    if (isDailyQuotaExhausted(err)) {
      return Math.min(MAX_QUOTA_COOLDOWN_MS, Math.max(MIN_DAILY_COOLDOWN_MS, ms));
    }
    return Math.min(MAX_QUOTA_COOLDOWN_MS, Math.max(15_000, ms));
  }
  if (isDailyQuotaExhausted(err)) {
    return MAX_QUOTA_COOLDOWN_MS;
  }
  return DEFAULT_RPM_COOLDOWN_MS;
}

export function shouldFallbackToNextModel(status: number | undefined): boolean {
  if (status === undefined) return true;
  if (status === 400 || status === 401 || status === 403) return false;
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

export class ModelCooldownTracker {
  private readonly cooldownUntil = new Map<string, number>();

  constructor(private readonly models: readonly string[] = GEMINI_TRANSCRIBE_MODELS) {}

  getAvailableModels(nowMs: number = Date.now()): string[] {
    return this.models.filter((model) => {
      const until = this.cooldownUntil.get(model);
      if (until === undefined) return true;
      if (nowMs >= until) {
        this.cooldownUntil.delete(model);
        return true;
      }
      return false;
    });
  }

  markQuotaExceeded(model: string, err: unknown, nowMs: number = Date.now()): number {
    const durationMs = computeQuotaCooldownMs(err);
    this.cooldownUntil.set(model, nowMs + durationMs);
    return Math.ceil(durationMs / 1000);
  }

  markTransientFailure(model: string, nowMs: number = Date.now(), durationMs = TRANSIENT_FAILURE_COOLDOWN_MS): void {
    this.cooldownUntil.set(model, nowMs + durationMs);
  }

  markModelUnsupported(model: string, nowMs: number = Date.now()): void {
    this.cooldownUntil.set(model, nowMs + MAX_QUOTA_COOLDOWN_MS);
  }

  clearModel(model: string): void {
    this.cooldownUntil.delete(model);
  }

  getShortestCooldownRemainingSeconds(nowMs: number = Date.now()): number {
    let minMs = Infinity;
    for (const model of this.models) {
      const until = this.cooldownUntil.get(model);
      if (until === undefined || nowMs >= until) {
        return 0;
      }
      minMs = Math.min(minMs, until - nowMs);
    }
    return minMs === Infinity ? 0 : Math.max(1, Math.ceil(minMs / 1000));
  }

  reset(): void {
    this.cooldownUntil.clear();
  }
}

export class QueueOverloadedError extends Error {
  readonly status = 429;
  constructor(message = "النظام مشغول حالياً بضغط الطلبات، حاول بعد لحظة") {
    super(message);
    this.name = "QueueOverloadedError";
  }
}

export class UpstreamTimeoutError extends Error {
  readonly status = 504;
  constructor(message = "استغرق الخادم وقتاً أطول من المعتاد") {
    super(message);
    this.name = "UpstreamTimeoutError";
  }
}

export function createConcurrencyLimiter(maxConcurrent: number, maxQueued: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  const release = () => {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) {
      active += 1;
      next();
    }
  };

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active < maxConcurrent) {
      active += 1;
    } else {
      if (waiters.length >= maxQueued) {
        throw new QueueOverloadedError();
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }

    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    run,
    stats: () => ({ active, queued: waiters.length }),
  };
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new UpstreamTimeoutError(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
