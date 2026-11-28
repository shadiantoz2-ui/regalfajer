let inMemoryBearerToken: string | null = null;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function setSessionBearerToken(token: string | null): void {
  inMemoryBearerToken = token && token.trim() ? token.trim() : null;
}

export function getSessionBearerToken(): string | null {
  return inMemoryBearerToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timer =
    typeof window !== "undefined"
      ? window.setTimeout(() => controller.abort(new DOMException("Request timeout", "TimeoutError")), timeoutMs)
      : setTimeout(() => controller.abort(new DOMException("Request timeout", "TimeoutError")), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: "include",
    });
  } finally {
    if (typeof window !== "undefined") window.clearTimeout(timer);
    else clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "rijal-client");
  if (inMemoryBearerToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${inMemoryBearerToken}`);
  }
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = (init.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" || method === "HEAD" ? 2 : 1;

  let res: Response | undefined;
  let lastNetErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      res = await fetchWithTimeout(url, { ...init, headers }, DEFAULT_REQUEST_TIMEOUT_MS);
      if (attempt + 1 < maxAttempts && (res.status === 502 || res.status === 503 || res.status === 504)) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      break;
    } catch (err) {
      lastNetErr = err;
      if (attempt + 1 < maxAttempts && !init.signal?.aborted) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
    }
  }

  if (!res) {
    const timedOut = lastNetErr instanceof DOMException && lastNetErr.name === "TimeoutError";
    throw new ApiError(
      timedOut ? "استغرق الاتصال بالخادم وقتاً طويلاً، حاول مجدداً" : "تعذّر الاتصال بالخادم، تحقق من الاتصال وحاول مجدداً",
      0,
    );
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    if (res.status === 401) {
      inMemoryBearerToken = null;
    }
    const errMsg =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
        ? String((payload as { error: { message: string } }).error.message)
        : "تعذّر إتمام العملية، حاول مرة أخرى";
    throw new ApiError(errMsg, res.status);
  }

  return payload as T;
}
