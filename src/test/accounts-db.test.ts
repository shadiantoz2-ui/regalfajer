import { describe, expect, it } from "vitest";
import {
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  hashPassword,
  isHttpsRequest,
  normalizeUsername,
  SESSION_COOKIE_NAME,
  signSessionTokenWithSecret,
  verifyPassword,
  verifySameOriginMutation,
  verifySessionTokenWithSecret,
} from "@/lib/server/auth.server";
import { computePublicLeaderboard, normalizePastAttendanceDates } from "@/lib/firebase/domain";
import { HISTORICAL_NOV2026_SEED } from "@/lib/seed-nov2026";

const TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Cloud SQL Staff Authentication & Session Security", () => {
  it("hashes passwords with random salts and verifies securely", () => {
    const first = hashPassword("StrongPass!123");
    const second = hashPassword("StrongPass!123");

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(verifyPassword("StrongPass!123", first.hash, first.salt)).toBe(true);
    expect(verifyPassword("WrongPass!123", first.hash, first.salt)).toBe(false);
    expect(verifyPassword("", first.hash, first.salt)).toBe(false);
  });

  it("signs and verifies HMAC session tokens and rejects tampered tokens", () => {
    const token = signSessionTokenWithSecret("staff-user-1", TEST_SECRET);
    expect(verifySessionTokenWithSecret(token, TEST_SECRET)).toBe("staff-user-1");

    const parts = token.split(".");
    const tampered = `${parts[0]}.tampered_sig`;
    expect(verifySessionTokenWithSecret(tampered, TEST_SECRET)).toBeNull();
    expect(verifySessionTokenWithSecret(token, "different-secret-key-0000000000000000")).toBeNull();
  });

  it("normalizes usernames consistently", () => {
    expect(normalizeUsername("  Admin_One  ")).toBe("admin_one");
  });

  it("marks proxied HTTPS preview cookies with SameSite=None; Partitioned", () => {
    const token = signSessionTokenWithSecret("admin-1", TEST_SECRET);
    const httpsReq = new Request("http://127.0.0.1:3000/api/auth", {
      method: "POST",
      headers: { Origin: "https://ais-dev-example.europe-west2.run.app" },
    });

    expect(isHttpsRequest(httpsReq)).toBe(true);
    const setCookie = buildSessionCookieHeader(httpsReq, token);
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Partitioned");

    const clearCookie = buildClearSessionCookieHeader(httpsReq);
    expect(clearCookie).toContain("Max-Age=0");
    expect(clearCookie).toContain("SameSite=None");
    expect(clearCookie).toContain("Partitioned");
  });

  it("enforces same-origin, custom header, or Bearer authentication on mutations", () => {
    const bearerReq = new Request("http://127.0.0.1:3000/api/students", {
      method: "POST",
      headers: { Authorization: "Bearer valid.token" },
    });
    expect(verifySameOriginMutation(bearerReq)).toBe(true);

    const headerReq = new Request("http://127.0.0.1:3000/api/auth", {
      method: "POST",
      headers: { "X-Requested-With": "rijal-client" },
    });
    expect(verifySameOriginMutation(headerReq)).toBe(true);

    const crossOriginReq = new Request("http://127.0.0.1:3000/api/staff", {
      method: "POST",
      headers: { Host: "127.0.0.1:3000", Origin: "https://evil.example.com" },
    });
    expect(verifySameOriginMutation(crossOriginReq)).toBe(false);
  });

  it("contains 72 historical students and preserves past attendance filtering", () => {
    expect(HISTORICAL_NOV2026_SEED).toHaveLength(72);

    const { validDates, skippedCount } = normalizePastAttendanceDates(
      ["2026-11-26", "2026-11-27", "2026-11-26", "2026-12-01"],
      "2026-11-27",
      new Set(["2026-11-26"]),
    );
    expect(validDates).toEqual(["2026-11-27"]);
    expect(skippedCount).toBe(2);

    const board = computePublicLeaderboard(
      [
        { id: "s1", full_name: "أحمد محمد" },
        { id: "s2", full_name: "براء العلي" },
      ],
      [
        { student_id: "s1" },
        { student_id: "s1" },
        { student_id: "s2" },
      ],
    );
    expect(board).toEqual([
      { full_name: "أحمد محمد", days: 2 },
      { full_name: "براء العلي", days: 1 },
    ]);
  });
});
