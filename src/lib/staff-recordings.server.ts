import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type StaffProfile = {
  id: string;
  login: string;
  name: string;
  role: "admin" | "teacher";
  created_at: string;
};

export type StaffRecordingEntry = {
  id: string;
  teacherId: string;
  teacherLogin: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  attendedOn: string;
  recordedAt: string;
};

type StoreData = {
  profiles: Record<string, StaffProfile>;
  recordings: StaffRecordingEntry[];
};

const STORE_DIR = path.resolve(process.cwd(), ".data");
const STORE_PATH = path.resolve(STORE_DIR, "staff-recordings.json");

let writeQueue: Promise<unknown> = Promise.resolve();

function emptyStore(): StoreData {
  return { profiles: {}, recordings: [] };
}

async function readStore(): Promise<StoreData> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return {
      profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
      recordings: Array.isArray(parsed.recordings) ? parsed.recordings : [],
    };
  } catch {
    return emptyStore();
  }
}

async function saveStore(data: StoreData): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  const tmpPath = path.resolve(STORE_DIR, `staff-recordings.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, STORE_PATH);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function upsertStaffProfile(profile: StaffProfile): Promise<void> {
  return enqueue(async () => {
    const store = await readStore();
    const existing = store.profiles[profile.id];
    store.profiles[profile.id] = {
      id: profile.id,
      login: profile.login || existing?.login || "",
      name: profile.name || existing?.name || profile.login || "",
      role: profile.role,
      created_at: existing?.created_at || profile.created_at || new Date().toISOString(),
    };
    await saveStore(store);
  });
}

export function addStaffRecording(entry: Omit<StaffRecordingEntry, "id" | "recordedAt"> & { recordedAt?: string }): Promise<void> {
  return enqueue(async () => {
    const store = await readStore();
    const id = `${entry.teacherId}:${entry.attendedOn}:${entry.studentId}`;
    const existingIdx = store.recordings.findIndex((r) => r.id === id);
    const nextRow: StaffRecordingEntry = {
      id,
      teacherId: entry.teacherId,
      teacherLogin: entry.teacherLogin,
      teacherName: entry.teacherName,
      studentId: entry.studentId,
      studentName: entry.studentName,
      attendedOn: entry.attendedOn,
      recordedAt: entry.recordedAt || new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      store.recordings[existingIdx] = nextRow;
    } else {
      store.recordings.unshift(nextRow);
    }
    await saveStore(store);
  });
}

export async function listStaffProfilesByRole(role: "admin" | "teacher"): Promise<StaffProfile[]> {
  const store = await readStore();
  return Object.values(store.profiles)
    .filter((p) => p.role === role)
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export async function listRecordingsForTeacherByDate(teacherId: string, date: string): Promise<StaffRecordingEntry[]> {
  const store = await readStore();
  return store.recordings
    .filter((r) => r.teacherId === teacherId && r.attendedOn === date)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}
