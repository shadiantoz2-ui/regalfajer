import firebaseConfig from "../../../firebase-applet-config.json";
import { normalizeEmail, type StaffRole } from "./domain";

export type VerifiedTokenUser = {
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
};

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

type FirestoreDoc = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
};

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token.split(".").length === 3 ? token : null;
}

/** Verifies a Firebase ID token using Firebase Auth Identity Toolkit (no IAM required). */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedTokenUser | null> {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean; disabled?: boolean }>;
    };
    const u = data.users?.[0];
    if (!u?.localId || !u.email || u.disabled === true) return null;
    return {
      uid: u.localId,
      email: normalizeEmail(u.email),
      emailVerified: Boolean(u.emailVerified),
      idToken,
    };
  } catch {
    return null;
  }
}

function firestoreDocBaseUrl(): string {
  const dbId = encodeURIComponent(firebaseConfig.firestoreDatabaseId || "(default)");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/${dbId}/documents`;
}

function decodeFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val) return undefined;
  if ("stringValue" in val) return val.stringValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return val.doubleValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("arrayValue" in val) return (val.arrayValue.values ?? []).map((v) => decodeFirestoreValue(v));
  if ("mapValue" in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields ?? {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function decodeFirestoreDoc(doc: FirestoreDoc): Record<string, unknown> & { id: string } {
  const nameParts = (doc.name ?? "").split("/");
  const id = nameParts[nameParts.length - 1] ?? "";
  const out: Record<string, unknown> & { id: string } = { id };
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

function encodeFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((v) =>
          Array.isArray(v)
            ? { mapValue: { fields: { items: encodeFirestoreValue(v) } } }
            : encodeFirestoreValue(v),
        ),
      },
    };
  }
  if (typeof val === "object") {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) fields[k] = encodeFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export async function getFirestoreDocRest(
  idToken: string,
  path: string,
): Promise<(Record<string, unknown> & { id: string }) | null> {
  const res = await fetch(`${firestoreDocBaseUrl()}/${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`Firestore REST GET ${path} failed (${res.status}):`, detail);
    throw new Error(`Firestore REST GET ${path} failed: ${res.status}`);
  }
  const doc = (await res.json()) as FirestoreDoc;
  return decodeFirestoreDoc(doc);
}

export async function listFirestoreCollectionRest(
  idToken: string,
  collectionPath: string,
): Promise<(Record<string, unknown> & { id: string })[]> {
  const all: (Record<string, unknown> & { id: string })[] = [];
  let pageToken = "";
  for (;;) {
    const url = new URL(`${firestoreDocBaseUrl()}/${collectionPath}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Firestore REST LIST ${collectionPath} failed (${res.status}):`, detail);
      throw new Error(`Firestore REST LIST ${collectionPath} failed: ${res.status}`);
    }
    const data = (await res.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
    for (const d of data.documents ?? []) all.push(decodeFirestoreDoc(d));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return all;
}

export async function upsertAssistantChatRest(
  idToken: string,
  userId: string,
  messages: unknown[],
): Promise<void> {
  const dbRoot = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId || "(default)"}`;
  const docName = `${dbRoot}/documents/assistant_chats/${userId}`;
  const sanitizedMessages = JSON.parse(JSON.stringify(messages.slice(-100))) as unknown[];
  const res = await fetch(`https://firestore.googleapis.com/v1/${dbRoot}/documents:commit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docName,
            fields: {
              user_id: { stringValue: userId },
              messages: encodeFirestoreValue(sanitizedMessages),
            },
          },
          updateTransforms: [
            {
              fieldPath: "updatedAt",
              setToServerValue: "REQUEST_TIME",
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`Firestore REST commit assistant_chats failed (${res.status}):`, detail);
    throw new Error(`Firestore REST commit assistant_chats failed: ${res.status}`);
  }
}

export async function resolveVerifiedStaffRole(request: Request): Promise<{
  user: VerifiedTokenUser;
  role: StaffRole;
} | null> {
  const token = extractBearerToken(request);
  if (!token) return null;
  const user = await verifyFirebaseIdToken(token);
  if (!user) return null;
  try {
    const profile = await getFirestoreDocRest(token, `staff_profiles/${encodeURIComponent(user.uid)}`);
    if (!profile) return null;
    if (profile["role"] === "admin" || profile["role"] === "teacher") {
      return { user, role: profile["role"] };
    }
    return null;
  } catch {
    return null;
  }
}
