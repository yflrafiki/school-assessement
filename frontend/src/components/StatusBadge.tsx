type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'accent';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok border-ok/20',
  warn: 'bg-warn-soft text-warn border-warn/25',
  bad: 'bg-bad-soft text-bad border-bad/20',
  neutral: 'bg-canvas text-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent/20',
};

const STATUS_TONES: Record<string, { tone: Tone; label: string }> = {
  COMPLETED: { tone: 'ok', label: 'Completed' },
  WAIVED: { tone: 'accent', label: 'Waived' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  RESCHEDULED: { tone: 'neutral', label: 'Rescheduled' },
  UPCOMING: { tone: 'neutral', label: 'Upcoming' },
  DUE: { tone: 'warn', label: 'Due' },
  OVERDUE: { tone: 'bad', label: 'Overdue' },
  ACTIVE: { tone: 'ok', label: 'Active' },
  PENDING_ACTIVATION: { tone: 'warn', label: 'Pending activation' },
  DEACTIVATED: { tone: 'neutral', label: 'Deactivated' },
  PENDING: { tone: 'warn', label: 'Invitation sent' },
  EXPIRED: { tone: 'bad', label: 'Invitation expired' },
  ACCEPTED: { tone: 'ok', label: 'Activated' },
  NONE: { tone: 'neutral', label: 'Not invited' },
  SUBMITTED: { tone: 'ok', label: 'Submitted' },
  DRAFT: { tone: 'neutral', label: 'Draft' },
  UP_TO_DATE: { tone: 'ok', label: 'Up to date' },
  BEHIND: { tone: 'bad', label: 'Behind' },
  LATE: { tone: 'warn', label: 'Late' },
  ON_TIME: { tone: 'ok', label: 'On time' },
  PUBLISHED: { tone: 'ok', label: 'Published' },
  ARCHIVED: { tone: 'neutral', label: 'Archived' },
  STAGED: { tone: 'warn', label: 'Awaiting review' },
  IMPORTED: { tone: 'ok', label: 'Imported' },
  APPROVED: { tone: 'ok', label: 'Approved' },
  CORRECTED: { tone: 'accent', label: 'Corrected' },
  REJECTED: { tone: 'bad', label: 'Rejected' },
  TEACHING: { tone: 'neutral', label: 'Teaching' },
  REVISION: { tone: 'accent', label: 'Revision' },
  MOCK: { tone: 'warn', label: 'Mock exam' },
  EXAMINATION: { tone: 'warn', label: 'Examination' },
  LOCKED: { tone: 'neutral', label: 'Locked' },
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_TONES[status] ?? { tone: 'neutral' as Tone, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
