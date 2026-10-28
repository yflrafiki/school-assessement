// Shapes of API responses as the web app uses them.
import type {
  ImportFlag,
  LessonState,
  LessonStatus,
  Level,
  RecordStatus,
  UserStatus,
  WeekKind,
} from '@school/shared';

export interface Ref {
  id: string;
  name: string;
}
export interface ClassRef extends Ref {
  level: Level;
}
export interface TeacherRef {
  id: string;
  fullName: string;
  staffId?: string;
}

export interface Lesson {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: LessonStatus;
  state: LessonState;
  cancelReason: string | null;
  reason: string | null;
  weekNumber: number | null;
  rescheduledFromId: string | null;
  assignment: { id: string; subject: Ref; schoolClass: ClassRef; teacher: TeacherRef };
  record: { id: string; status: RecordStatus; submittedAt: string | null; isLate: boolean } | null;
}

export interface CurriculumEntry {
  id: string;
  level?: Level;
  subjectId?: string;
  weekNumber: number;
  strand: string;
  subStrand: string;
  contentStandard: string;
  indicator: string;
  isTruncated: boolean;
  sourcePage?: number;
}

export interface TeachingRecord {
  id: string;
  status: RecordStatus;
  weekNumber: number;
  taughtSummary: string;
  topicNote: string | null;
  outcomes: string | null;
  challenges: string | null;
  remarks: string | null;
  isLate: boolean;
  submittedAt: string | null;
  lastEditedAt: string | null;
  editableUntil: string | null;
  lesson: { id: string; date: string; startTime: string; endTime: string };
  subject: Ref;
  schoolClass: ClassRef;
  teacher: TeacherRef;
  topicCount: number;
  topics?: CurriculumEntry[];
}

export interface WeekStatus {
  weekNumber: number;
  kind: WeekKind;
  required: boolean;
  lessonsPaced: number;
  completed: number;
  waived: number;
  outstanding: number;
  overdue: number;
  complete: boolean;
  unlocked: boolean;
  lockedReason: string | null;
}

export interface AssignmentProgress {
  assignmentId: string;
  subject: Ref;
  schoolClass: ClassRef;
  teacher: TeacherRef;
  perWeek: number;
  published: boolean;
  weeks?: WeekStatus[];
  completedWeeks: number;
  requiredWeeks: number;
  currentWeek: number | null;
  overdueLessons: number;
  oldestOverdue: string | null;
  upToDate: boolean;
  lessonsBeyondScheme: number;
}

export interface Assignment {
  id: string;
  termId: string;
  term: { id: string; name: string; isCurrent: boolean };
  isActive: boolean;
  subject: Ref & { parentSubjectId: string | null };
  schoolClass: ClassRef;
  teacher: TeacherRef;
  lessonsPerWeek: number;
  published: boolean;
}

export interface TeacherSummary {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  staffId: string;
  phone: string | null;
  status: UserStatus;
  invitationStatus: 'NONE' | 'PENDING' | 'EXPIRED' | 'ACCEPTED';
  lastLoginAt: string | null;
  createdAt: string;
  assignments: { id: string; subject: Ref; schoolClass: ClassRef }[];
  overdueLessons: number;
  oldestOverdueDate: string | null;
  progress: 'UP_TO_DATE' | 'BEHIND';
}

export interface TeacherDetail extends TeacherSummary {
  allAssignments: Assignment[];
  absences: {
    id: string;
    startDate: string;
    endDate: string;
    reason: string;
    revokedAt: string | null;
  }[];
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  isNational: boolean;
  isFramework: boolean;
  parentSubjectId: string | null;
  isActive: boolean;
  assignable: boolean;
}

export interface SchoolClass {
  id: string;
  level: Level;
  name: string;
  isActive: boolean;
}

export interface Term {
  id: string;
  academicYearId: string;
  academicYearName?: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  weekCount: number;
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  terms: Term[];
}

export interface TimetableEntry {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validTo: string;
  assignment: {
    id: string;
    termId: string;
    subject: Ref;
    schoolClass: ClassRef;
    teacher: TeacherRef;
  };
}

export interface Notification {
  id: string;
  type: 'RECORD_SUBMITTED' | 'EMAIL_QUOTA_WARNING';
  title: string;
  body: string;
  recordId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  checksum: string;
  term: { id: string; name: string };
  status: 'STAGED' | 'IMPORTED' | 'DISCARDED';
  weeks: { level: Level; weekNumber: number; kind: WeekKind; label?: string }[];
  report: {
    notes?: string[];
    warnings?: string[];
    imported?: number;
    rejected?: number;
    duplicates?: number;
    skipped?: number;
    corrected?: number;
    flagged?: number;
  };
  createdAt: string;
  importedAt: string | null;
  scheme: { id: string; status: string; version: number } | null;
  counts: {
    total: number;
    flagged: number;
    flaggedPending: number;
    truncatedOnlyPending: number;
    decisions: Record<string, number>;
  };
}

export interface ImportRow {
  id: string;
  rowIndex: number;
  level: Level;
  subjectName: string;
  weekNumber: number;
  strand: string;
  subStrand: string;
  contentStandard: string;
  indicator: string;
  sourcePage: number;
  flags: ImportFlag[];
  decision: 'PENDING' | 'APPROVED' | 'CORRECTED' | 'REJECTED';
  reviewNote: string | null;
  corrected: Partial<
    Pick<ImportRow, 'strand' | 'subStrand' | 'contentStandard' | 'indicator' | 'weekNumber'>
  > | null;
}
