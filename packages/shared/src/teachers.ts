import { z } from 'zod';
import { email } from './auth.js';
import { LEVELS, USER_STATUSES } from './enums.js';
import { paginationQuery, trimmed, uuid } from './common.js';

export const assignmentPair = z.object({
  subjectId: uuid,
  classId: uuid,
});

export const createTeacherBody = z.object({
  fullName: trimmed(2, 120),
  email,
  staffId: trimmed(1, 50),
  phone: z.string().trim().max(30).optional(),
  termId: uuid.optional(),
  assignments: z.array(assignmentPair).max(40).default([]),
});
export type CreateTeacherBody = z.infer<typeof createTeacherBody>;

export const updateTeacherBody = z.object({
  fullName: trimmed(2, 120).optional(),
  email: email.optional(),
  staffId: trimmed(1, 50).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
});
export type UpdateTeacherBody = z.infer<typeof updateTeacherBody>;

export const INVITATION_STATUSES = ['NONE', 'PENDING', 'EXPIRED', 'ACCEPTED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const PROGRESS_FILTERS = ['UP_TO_DATE', 'BEHIND'] as const;

export const listTeachersQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  subjectId: uuid.optional(),
  classId: uuid.optional(),
  level: z.enum(LEVELS).optional(),
  status: z.enum(USER_STATUSES).optional(),
  invitationStatus: z.enum(INVITATION_STATUSES).optional(),
  progress: z.enum(PROGRESS_FILTERS).optional(),
  sort: z.enum(['name', '-name', 'createdAt', '-createdAt']).default('name'),
});
export type ListTeachersQuery = z.infer<typeof listTeachersQuery>;

export const createAssignmentBody = z.object({
  teacherProfileId: uuid,
  subjectId: uuid,
  classId: uuid,
  termId: uuid,
});

export const updateAssignmentBody = z.object({
  teacherProfileId: uuid.optional(),
  isActive: z.boolean().optional(),
});

export const carryForwardBody = z.object({
  fromTermId: uuid,
  toTermId: uuid,
});
