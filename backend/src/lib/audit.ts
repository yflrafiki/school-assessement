import type { Db, Prisma } from './db.js';

export interface AuditInput {
  schoolId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Never include passwords, tokens or unnecessary personal data. */
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
}

/** Append-only. Call inside the same transaction as the change it describes. */
export function audit(db: Db, input: AuditInput) {
  return db.auditLog.create({
    data: {
      schoolId: input.schoolId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
      requestId: input.requestId ?? null,
    },
  });
}
