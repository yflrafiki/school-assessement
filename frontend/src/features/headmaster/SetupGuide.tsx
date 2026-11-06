import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FiCheckCircle, FiCircle } from 'react-icons/fi';
import { api, type One } from '../../lib/api';
import { Section } from '../../components/PageHeader';

type StepId =
  | 'term'
  | 'weeks'
  | 'classes'
  | 'scheme'
  | 'teachers'
  | 'subjects'
  | 'timetable'
  | 'publish'
  | 'start';

interface SetupStatus {
  steps: { id: StepId; done: boolean; detail: string }[];
  complete: boolean;
}

/** What each step is for, in plain words, and where to do it. */
const STEPS: Record<StepId, { title: string; why: string; to: string; action: string }> = {
  term: {
    title: 'Set the term dates',
    why: 'Create the academic year and the term, with its first and last day.',
    to: '/h/settings?tab=terms',
    action: 'Open Years and terms',
  },
  weeks: {
    title: 'Set the week dates',
    why: 'Tell the system which days are week 1, week 2 and so on. One button fills them in.',
    to: '/h/settings?tab=weeks',
    action: 'Open Term weeks',
  },
  classes: {
    title: 'Add your classes',
    why: 'For example FORM 1, FORM 2 and FORM 3 (Basic 7 to 9).',
    to: '/h/settings?tab=classes',
    action: 'Open Classes',
  },
  scheme: {
    title: 'Upload the scheme of learning',
    why: "The term's PDF. Its topics are what teachers tick when they record a lesson.",
    to: '/h/curriculum',
    action: 'Open Curriculum',
  },
  teachers: {
    title: 'Add your teachers',
    why: 'Each teacher gets an email to set a password and sign in.',
    to: '/h/teachers',
    action: 'Open Teachers',
  },
  subjects: {
    title: 'Give each teacher their subjects',
    why: 'Say who teaches which subject in which class. "All classes" fills Form 1 to 3 at once.',
    to: '/h/assignments',
    action: 'Open Subjects and classes',
  },
  timetable: {
    title: 'Put in the timetable',
    why: 'Upload the timetable PDF or Excel file, or add the lessons one at a time.',
    to: '/h/timetable',
    action: 'Open Timetable',
  },
  publish: {
    title: 'Publish the timetable',
    why: 'Press "Preview and publish" on the Timetable page. This creates every lesson of the term.',
    to: '/h/timetable',
    action: 'Open Timetable',
  },
  start: {
    title: 'Choose when recording starts',
    why: 'Only if the term began before you started using the system: earlier lessons then need no record.',
    to: '/h/timetable',
    action: 'Open Timetable',
  },
};

/** The headmaster's step-by-step setup list, shown on the overview until everything is done. */
export function SetupGuide() {
  const query = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<One<SetupStatus>>('/setup-status').then((r) => r.data),
    // Steps are done on other pages; coming back here should always show the latest.
    refetchOnMount: 'always',
  });
  const status = query.data;
  if (!status || status.complete) return null;
  const next = status.steps.find((s) => !s.done);
  const doneCount = status.steps.filter((s) => s.done).length;

  return (
    <Section
      title="Getting the school ready"
      className="mb-5"
      actions={
        <span className="text-sm text-muted">
          {doneCount} of {status.steps.length} done
        </span>
      }
    >
      <p className="px-4 pt-3 text-sm text-muted">
        Teachers can record lessons once these steps are done. Work from the top; each step ticks
        itself off when it is complete.{' '}
        <Link to="/h/help" className="link">
          How the system works
        </Link>
      </p>
      <ol className="divide-y divide-line">
        {status.steps.map((s, i) => {
          const info = STEPS[s.id];
          const isNext = s.id === next?.id;
          return (
            <li
              key={s.id}
              className={`flex flex-wrap items-start gap-3 px-4 py-3 ${isNext ? 'bg-accent-soft' : ''}`}
            >
              {s.done ? (
                <FiCheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-label="Done" />
              ) : (
                <FiCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-label="Not done" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p className={`font-medium ${s.done ? 'text-muted' : 'text-ink'}`}>
                  {i + 1}. {info.title}
                </p>
                {!s.done && <p className="text-muted">{info.why}</p>}
                <p className="text-xs text-muted">{s.detail}</p>
              </div>
              {isNext ? (
                <Link to={info.to} className="btn-primary h-8 shrink-0 text-xs">
                  Do this next: {info.action.replace(/^Open /, '')}
                </Link>
              ) : !s.done ? (
                <Link to={info.to} className="btn-secondary h-8 shrink-0 text-xs">
                  {info.action}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
