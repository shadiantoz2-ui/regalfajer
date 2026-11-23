export const LOGIN_DOMAIN = "rijal-alfajr.app";

/** "ahmad" -> "ahmad@rijal-alfajr.app"; emails pass through unchanged. */
export function loginToEmail(login: string): string {
  const v = login.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${LOGIN_DOMAIN}`;
}
