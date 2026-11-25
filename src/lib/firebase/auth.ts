import { getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import firebaseConfig from "../../../firebase-applet-config.json";
import { emailToLogin, loginToEmail } from "@/lib/login";
import { auth, db, handleFirestoreError, OperationType } from "./client";
import {
  emailDocKey,
  normalizeEmail,
  resolveRoleForAccount,
  STAFF_LIMITS,
  validateStaffAccountInput,
  type StaffRole,
} from "./domain";

export type ResolvedStaffSession =
  | {
      status: "authorized";
      uid: string;
      email: string;
      userName: string;
      role: StaffRole;
    }
  | {
      status: "unauthorized";
      reason: "unauthenticated" | "not_staff";
      email?: string;
    };

function getSecondaryCreatorAuth() {
  const creatorApp =
    getApps().find((a) => a.name === "staff-creator") ?? initializeApp(firebaseConfig, "staff-creator");
  return getAuth(creatorApp);
}

export function waitForFirebaseUser(): Promise<User | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export async function getFirebaseIdToken(): Promise<string | undefined> {
  const user = auth.currentUser ?? (await waitForFirebaseUser());
  if (!user) return undefined;
  return user.getIdToken();
}

async function readBootstrapDocViaRest(): Promise<{ initialized: boolean; adminUid: string | null } | null> {
  const dbId = encodeURIComponent(firebaseConfig.firestoreDatabaseId || "(default)");
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/${dbId}/documents/app_settings/bootstrap`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Bootstrap check failed: ${res.status}`);
  const payload = (await res.json()) as {
    fields?: {
      initialized?: { booleanValue?: boolean };
      adminUid?: { stringValue?: string };
    };
  };
  return {
    initialized: Boolean(payload.fields?.initialized?.booleanValue),
    adminUid: payload.fields?.adminUid?.stringValue ?? null,
  };
}

export async function isBootstrapInitialized(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, "app_settings", "bootstrap"));
    if (!snap.exists()) return false;
    return Boolean(snap.data()["initialized"]);
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (msg.includes("offline") || msg.includes("unavailable")) {
      const rest = await readBootstrapDocViaRest();
      return Boolean(rest?.initialized);
    }
    throw err;
  }
}

export async function fetchBootstrapAdminUid(): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, "app_settings", "bootstrap"));
    if (!snap.exists()) return null;
    const uid = snap.data()["adminUid"];
    return typeof uid === "string" && uid ? uid : null;
  } catch {
    return null;
  }
}

export async function registerInitialAdmin(input: {
  name: string;
  username: string;
  password: string;
}): Promise<ResolvedStaffSession> {
  const validated = validateStaffAccountInput({
    name: input.name,
    username: input.username,
    password: input.password,
    role: "admin",
    requirePassword: true,
  });
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const alreadyInitialized = await isBootstrapInitialized();
  if (alreadyInitialized) {
    throw new Error("تم إعداد حساب المدير مسبقاً، سجّل الدخول باسم المستخدم وكلمة المرور");
  }

  const cred = await createUserWithEmailAndPassword(auth, validated.email, input.password);
  try {
    await updateProfile(cred.user, { displayName: validated.name });

    const accountKey = emailDocKey(validated.email);
    const batch = writeBatch(db);
    batch.set(doc(db, "app_settings", "bootstrap"), {
      initialized: true,
      adminUid: cred.user.uid,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, "staff_accounts", accountKey), {
      name: validated.name,
      email: validated.email,
      role: "admin",
      uid: cred.user.uid,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: cred.user.uid,
    });
    batch.set(doc(db, "staff_profiles", cred.user.uid), {
      uid: cred.user.uid,
      email: validated.email,
      name: validated.name,
      role: "admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    await cred.user.delete().catch(() => {});
    await firebaseSignOut(auth).catch(() => {});
    throw err;
  }

  try {
    const settingsSnap = await getDoc(doc(db, "app_settings", "global"));
    if (!settingsSnap.exists()) {
      await setDoc(doc(db, "app_settings", "global"), {
        results_public: false,
        updatedAt: serverTimestamp(),
        updatedByUid: cred.user.uid,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, "app_settings/global");
  }

  return {
    status: "authorized",
    uid: cred.user.uid,
    email: validated.email,
    userName: validated.name,
    role: "admin",
  };
}

export async function signInStaffWithCredentials(username: string, password: string): Promise<User> {
  const email = loginToEmail(username);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function createManagedStaffAuthUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<string> {
  const creatorAuth = getSecondaryCreatorAuth();
  try {
    const cred = await createUserWithEmailAndPassword(creatorAuth, input.email, input.password);
    await updateProfile(cred.user, { displayName: input.name }).catch(() => {});
    return cred.user.uid;
  } finally {
    await firebaseSignOut(creatorAuth).catch(() => {});
  }
}

export async function signOutFirebase(): Promise<void> {
  await firebaseSignOut(auth);
}

export async function resolveAndSyncStaffSession(user: User | null): Promise<ResolvedStaffSession> {
  if (!user) {
    return { status: "unauthorized", reason: "unauthenticated" };
  }
  const email = user.email ? normalizeEmail(user.email) : "";
  if (!email) {
    return { status: "unauthorized", reason: "not_staff" };
  }

  const profilePath = `staff_profiles/${user.uid}`;
  let profileData: { uid?: unknown; name?: unknown; email?: unknown; role?: unknown } | null = null;
  try {
    const profileSnap = await getDoc(doc(db, "staff_profiles", user.uid));
    if (profileSnap.exists()) {
      profileData = profileSnap.data();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, profilePath);
  }

  const role = resolveRoleForAccount(user.uid, email, profileData);
  if (!role) {
    return { status: "unauthorized", reason: "not_staff", email };
  }

  const rawDisplayName =
    (typeof profileData?.name === "string" && profileData.name.trim()) ||
    user.displayName?.trim() ||
    emailToLogin(email) ||
    "موظف";
  const displayName = rawDisplayName.slice(0, STAFF_LIMITS.NAME_MAX);

  // Ensure global settings doc exists when admin enters
  if (role === "admin") {
    const settingsPath = "app_settings/global";
    try {
      const settingsSnap = await getDoc(doc(db, "app_settings", "global"));
      if (!settingsSnap.exists()) {
        await setDoc(doc(db, "app_settings", "global"), {
          results_public: false,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, settingsPath);
    }
  }

  return {
    status: "authorized",
    uid: user.uid,
    email,
    userName: displayName,
    role,
  };
}
