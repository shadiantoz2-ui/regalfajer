import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceNamePicker } from "@/components/VoiceNamePicker";
import type { Student } from "@/lib/types";

const mockStudents: Student[] = [
  { id: "1", full_name: "محمد أحمد العتيبي", created_at: "2026-01-01T00:00:00Z" },
  { id: "2", full_name: "خالد سعد القحطاني", created_at: "2026-01-01T00:00:00Z" },
];

const transcribeMocks = vi.hoisted(() => ({
  isServerTranscriptionConfigured: vi.fn<() => Promise<boolean>>(),
  transcribeAudio: vi.fn<(file: File) => Promise<string>>(),
}));

const recordMocks = vi.hoisted(() => ({
  recordWav: vi.fn(),
}));

vi.mock("@/lib/transcribe-client", () => transcribeMocks);
vi.mock("@/lib/record-wav", () => recordMocks);

type FakeSpeechEvent = {
  results: Array<Array<{ transcript: string }> & { isFinal: boolean }>;
};

class FakeSpeechRecognition {
  static lastInstance: FakeSpeechRecognition | null = null;
  lang = "ar-SA";
  interimResults = true;
  continuous = true;
  maxAlternatives = 5;
  onresult: ((event: FakeSpeechEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;

  constructor() {
    FakeSpeechRecognition.lastInstance = this;
  }

  start() {
    this.started = true;
  }

  stop() {
    this.onend?.();
  }

  abort() {
    this.onend?.();
  }
}

describe("VoiceNamePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeSpeechRecognition.lastInstance = null;
    transcribeMocks.isServerTranscriptionConfigured.mockResolvedValue(false);
    (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition =
      undefined;
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeSpeechRecognition;
  });

  it("recognizes spoken student name via SpeechRecognition and selects best alternative", async () => {
    const onConfirm = vi.fn().mockResolvedValue("recorded");
    const onRegister = vi.fn();

    render(<VoiceNamePicker students={mockStudents} onConfirm={onConfirm} onRegister={onRegister} />);
    await waitFor(() => expect(transcribeMocks.isServerTranscriptionConfigured).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "ابدأ التسجيل" }));
    const rec = FakeSpeechRecognition.lastInstance;
    expect(rec?.started).toBe(true);
    expect(rec?.continuous).toBe(true);

    const r1 = Object.assign([{ transcript: "خالد" }, { transcript: "خالد القحطاني" }], { isFinal: true });
    const r2 = Object.assign([{ transcript: "خالد" }], { isFinal: false });
    rec?.onresult?.({ results: [r1, r2] });

    fireEvent.click(screen.getByRole("button", { name: "إيقاف التسجيل" }));

    await waitFor(() => {
      expect(screen.getByText("خالد سعد القحطاني")).toBeInTheDocument();
    });
  });

  it("recovers cleanly to typing when SpeechRecognition errors", async () => {
    render(<VoiceNamePicker students={mockStudents} onConfirm={vi.fn()} onRegister={vi.fn()} />);
    await waitFor(() => expect(transcribeMocks.isServerTranscriptionConfigured).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "ابدأ التسجيل" }));
    const rec = FakeSpeechRecognition.lastInstance;
    rec?.onerror?.({ error: "network" });
    rec?.onend?.();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "كتابة الاسم" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "كتابة الاسم" }));
    expect(screen.getByPlaceholderText("الاسم والكنية")).toBeInTheDocument();
  });

  it("uses WAV recording + /api/transcribe and allows retrying the same clip on transient error", async () => {
    transcribeMocks.isServerTranscriptionConfigured.mockResolvedValue(true);
    const stopMock = vi.fn().mockResolvedValue(new File([new Uint8Array(2048)], "name.wav", { type: "audio/wav" }));
    recordMocks.recordWav.mockResolvedValue({
      stop: stopMock,
      cancel: vi.fn(),
      level: () => 0.2,
    });
    transcribeMocks.transcribeAudio
      .mockRejectedValueOnce(new Error("تعذّر الاتصال بخدمة التعرف على الصوت"))
      .mockResolvedValueOnce("احمد ادم ال علي");

    render(<VoiceNamePicker students={mockStudents} onConfirm={vi.fn()} onRegister={vi.fn()} />);
    await waitFor(() => expect(transcribeMocks.isServerTranscriptionConfigured).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "ابدأ التسجيل" }));
    await waitFor(() => expect(recordMocks.recordWav).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "إيقاف التسجيل" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /إعادة المحاولة بنفس التسجيل/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /إعادة المحاولة بنفس التسجيل/ }));
    await waitFor(() => {
      expect(screen.getByText("«أحمد آدم آل علي»")).toBeInTheDocument();
    });
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(transcribeMocks.transcribeAudio).toHaveBeenCalledTimes(2);
  });

  it("offers add and edit options for heard name even when a fuzzy match is found", async () => {
    const fuzzyStudents: Student[] = [{ id: "9", full_name: "عدي علاوي", created_at: "2026-01-01T00:00:00Z" }];
    const onConfirm = vi.fn().mockResolvedValue("recorded");
    const onRegister = vi.fn().mockResolvedValue({
      status: "created",
      student: { id: "10", full_name: "عدي علوى", created_at: "2026-01-01T00:00:00Z" },
    });

    render(<VoiceNamePicker students={fuzzyStudents} onConfirm={onConfirm} onRegister={onRegister} />);
    await waitFor(() => expect(transcribeMocks.isServerTranscriptionConfigured).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /اكتب الاسم/ }));
    fireEvent.change(screen.getByPlaceholderText("الاسم والكنية"), { target: { value: "عدي علوى" } });
    fireEvent.click(screen.getByRole("button", { name: "بحث" }));

    expect(screen.getByText("عدي علاوي")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تعديل" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إضافة" }));

    await waitFor(() => {
      expect(onRegister).toHaveBeenCalledWith("عدي علوى");
    });
    expect(onConfirm).toHaveBeenCalled();
  });

  it("deduplicates cumulative SpeechRecognition segments for a new student name", async () => {
    render(<VoiceNamePicker students={mockStudents} onConfirm={vi.fn()} onRegister={vi.fn()} />);
    await waitFor(() => expect(transcribeMocks.isServerTranscriptionConfigured).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "ابدأ التسجيل" }));
    const rec = FakeSpeechRecognition.lastInstance;

    const r1 = Object.assign([{ transcript: "سالم" }], { isFinal: true });
    const r2 = Object.assign([{ transcript: "سالم يوسف" }], { isFinal: true });
    const r3 = Object.assign([{ transcript: "سالم يوسف الدوسري" }], { isFinal: true });
    const r4 = Object.assign([{ transcript: "سالم يوسف الدوسري سالم يوسف الدوسري" }], { isFinal: false });
    rec?.onresult?.({ results: [r1, r2, r3, r4] });

    fireEvent.click(screen.getByRole("button", { name: "إيقاف التسجيل" }));

    await waitFor(() => {
      expect(screen.getByText("«سالم يوسف الدوسري»")).toBeInTheDocument();
    });
  });

  it("restores hamzas and maddas for spoken student names", async () => {
    render(<VoiceNamePicker students={mockStudents} onConfirm={vi.fn()} onRegister={vi.fn()} />);
    await waitFor(() => expect(transcribeMocks.isServerTranscriptionConfigured).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "ابدأ التسجيل" }));
    const rec = FakeSpeechRecognition.lastInstance;
    const r1 = Object.assign([{ transcript: "احمد ادم فواد الاحمد" }], { isFinal: true });
    rec?.onresult?.({ results: [r1] });

    fireEvent.click(screen.getByRole("button", { name: "إيقاف التسجيل" }));

    await waitFor(() => {
      expect(screen.getByText("«أحمد آدم فؤاد الأحمد»")).toBeInTheDocument();
    });
  });
});
