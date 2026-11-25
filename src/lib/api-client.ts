let inMemoryBearerToken: string | null = null;

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

export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "rijal-client");
  if (inMemoryBearerToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${inMemoryBearerToken}`);
  }
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError("تعذّر الاتصال بالخادم، تحقق من الاتصال وحاول مجدداً", 0);
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
