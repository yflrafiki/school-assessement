import { z } from 'zod';
import type { Role, UserStatus } from './enums.js';

export const PASSWORD_MIN_LENGTH = 10;

export const email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((v) => v.toLowerCase());

export const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200);

export const loginBody = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginBody = z.infer<typeof loginBody>;

export const invitationValidateBody = z.object({
  token: z.string().min(20).max(200),
});

export const invitationAcceptBody = z.object({
  token: z.string().min(20).max(200),
  staffId: z.string().trim().min(1, 'Enter your staff ID').max(50),
  password: newPassword,
});
export type InvitationAcceptBody = z.infer<typeof invitationAcceptBody>;

export const forgotPasswordBody = z.object({ email });

export const resetPasswordBody = z.object({
  token: z.string().min(20).max(200),
  password: newPassword,
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword,
});

export const PERMISSIONS = [
  'records.own',
  'lessons.own',
  'teachers.manage',
  'school.setup',
  'timetable.manage',
  'lessons.manage',
  'curriculum.import',
  'records.view_all',
  'reports.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  TEACHER: ['records.own', 'lessons.own'],
  HEADMASTER: [
    'teachers.manage',
    'school.setup',
    'timetable.manage',
    'lessons.manage',
    'curriculum.import',
    'records.view_all',
    'reports.view',
  ],
  SCHOOL_ADMIN: ['teachers.manage', 'curriculum.import'],
};

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  school: { id: string; name: string; timezone: string };
  teacherProfileId: string | null;
  permissions: Permission[];
}
