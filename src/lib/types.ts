export type Student = { id: string; full_name: string; created_at: string };
export type AttendanceRow = { id: string; student_id: string; attended_on: string; created_at: string };

export type StaffRole = "admin" | "teacher";

export type StaffSessionUser = {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  isPrimaryAdmin: boolean;
};

export type StaffAccountView = {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  isPrimaryAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StaffRecordingItem = {
  id: string;
  teacherId: string;
  teacherUsername: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  attendedOn: string;
  recordedAt: string;
};
