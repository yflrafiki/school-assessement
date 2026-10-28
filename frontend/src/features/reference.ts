// Reference data used by many forms and filters. Cached briefly; invalidated on edits in Settings.
import { useQuery } from '@tanstack/react-query';
import { LEVELS } from '@school/shared';
import { api, type One } from '../lib/api';
import { levelLabel } from '../lib/format';
import type { AcademicYear, SchoolClass, Subject, Term } from '../types/api';
import type { Option } from '../components/Filters';

export const refKeys = {
  subjects: ['ref', 'subjects'] as const,
  classes: ['ref', 'classes'] as const,
  terms: ['ref', 'terms'] as const,
  years: ['ref', 'years'] as const,
};

export function useSubjects() {
  return useQuery({
    queryKey: refKeys.subjects,
    queryFn: () => api.get<One<Subject[]>>('/subjects').then((r) => r.data),
    staleTime: 60_000,
  });
}
export function useClasses() {
  return useQuery({
    queryKey: refKeys.classes,
    queryFn: () => api.get<One<SchoolClass[]>>('/classes').then((r) => r.data),
    staleTime: 60_000,
  });
}
export function useTerms() {
  return useQuery({
    queryKey: refKeys.terms,
    queryFn: () => api.get<One<Term[]>>('/terms').then((r) => r.data),
    staleTime: 60_000,
  });
}
export function useAcademicYears() {
  return useQuery({
    queryKey: refKeys.years,
    queryFn: () => api.get<One<AcademicYear[]>>('/academic-years').then((r) => r.data),
  });
}
export function useCurrentTerm() {
  const terms = useTerms();
  return { ...terms, data: terms.data?.find((t) => t.isCurrent) ?? null };
}

export const levelOptions: Option[] = LEVELS.map((l) => ({ value: l, label: levelLabel(l) }));

export function subjectOptions(
  subjects: Subject[] | undefined,
  opts: { assignableOnly?: boolean } = {},
): Option[] {
  return (subjects ?? [])
    .filter((s) => s.isActive && (!opts.assignableOnly || s.assignable))
    .map((s) => ({ value: s.id, label: s.name }));
}

export function classOptions(classes: SchoolClass[] | undefined): Option[] {
  return (classes ?? [])
    .filter((c) => c.isActive)
    .map((c) => ({ value: c.id, label: `${c.name} (${levelLabel(c.level)})` }));
}

export function weekOptions(count = 14): Option[] {
  return Array.from({ length: count }, (_, i) => ({
    value: String(i + 1),
    label: `Week ${i + 1}`,
  }));
}
