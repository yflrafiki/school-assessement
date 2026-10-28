import { Badge } from '../../components/StatusBadge';
import type { CurriculumEntry } from '../../types/api';

/** Strand, sub-strand, standard and indicator, with truncated source text marked plainly. */
export function TopicText({
  entry,
  compact = false,
}: {
  entry: CurriculumEntry;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0 text-sm">
      <p className="text-xs text-muted">
        {entry.strand}
        {entry.subStrand ? ` › ${entry.subStrand}` : ''}
      </p>
      {!compact && entry.contentStandard && (
        <p className="mt-0.5 text-muted">{entry.contentStandard}</p>
      )}
      <p className="mt-0.5 text-ink">
        {entry.indicator}
        {entry.isTruncated && (
          <span className="ml-1.5 align-middle">
            <Badge tone="warn">Cut off in source</Badge>
          </span>
        )}
      </p>
    </div>
  );
}
