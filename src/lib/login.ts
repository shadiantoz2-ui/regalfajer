export const LOGIN_DOMAIN = "rijal-alfajr.app";

/** "ahmad" -> "ahmad@rijal-alfajr.app"; emails pass through unchanged. */
export function loginToEmail(login: string): string {
  const v = login.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${LOGIN_DOMAIN}`;
}

/** "ahmad@rijal-alfajr.app" -> "ahmad"; external emails pass through unchanged. */
export function emailToLogin(email: string): string {
  const v = email.trim().toLowerCase();
  const suffix = `@${LOGIN_DOMAIN}`;
  return v.endsWith(suffix) ? v.slice(0, -suffix.length) : v;
}
