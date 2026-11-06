import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Section } from '../../components/PageHeader';

/** One question with its answer, folded so the page can be scanned. */
function Topic({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="group border-b border-line last:border-b-0" open={open}>
      <summary className="cursor-pointer list-none px-4 py-3 font-medium text-ink hover:bg-canvas">
        <span className="mr-2 inline-block text-muted transition-transform group-open:rotate-90">
          ›
        </span>
        {title}
      </summary>
      <div className="space-y-2 px-4 pb-4 pl-9 text-sm text-ink">{children}</div>
    </details>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;
}

const GLOSSARY: [string, string][] = [
  [
    'Scheme of learning',
    "The term's plan from the curriculum office: for each class level, subject and week, the topics (strands, content standards and indicators) to teach.",
  ],
  [
    'Topic',
    'One line of the scheme of learning, usually an indicator such as "B7.1.1.1.1 Model number quantities". Teachers tick the topics they taught.',
  ],
  [
    'Week (curriculum week)',
    "The scheme's week number. Each lesson belongs to one, in order: a class's first lessons of the term cover week 1, the next ones week 2, and so on.",
  ],
  [
    'Lesson',
    'One period on the timetable on one day, for example Mathematics, FORM 1, Monday 8:00. The system creates every lesson of the term when the timetable is published.',
  ],
  [
    'Record (lesson record)',
    'What the teacher writes after a lesson: the topics taught and a short summary. Once submitted, the headmaster sees it at once.',
  ],
  ['Due', 'The lesson has started today and can be recorded now.'],
  ['Overdue', 'The lesson was on an earlier school day and still has no submitted record.'],
  [
    'Locked week',
    'A week cannot be recorded until every lesson of the weeks before it is recorded, so the scheme is covered in order.',
  ],
  [
    'Waived lesson',
    'A lesson the headmaster has excused: it needs no record but still counts as done, for example a lesson lost to a school event.',
  ],
  [
    'Cancelled lesson',
    'A lesson that did not happen and does not count, for example on a holiday. The next lessons take over its topics.',
  ],
  [
    'Publish',
    'Make something live for teachers. Publishing the timetable creates the lessons; it can be done again after changes.',
  ],
  [
    'Deactivate',
    'Switch off without deleting, so the history stays: a deactivated teacher cannot sign in, a deactivated class leaves the lists.',
  ],
];

function Glossary() {
  return (
    <Section title="Words used in the system">
      <dl className="divide-y divide-line">
        {GLOSSARY.map(([term, meaning]) => (
          <div key={term} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="font-medium text-ink">{term}</dt>
            <dd className="text-muted">{meaning}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function TeacherHelp() {
  return (
    <>
      <Section title="Recording your lessons" className="mb-5">
        <Topic title="How do I record a lesson?" open>
          <Steps>
            <li>
              Open{' '}
              <Link to="/t" className="link">
                Overview
              </Link>
              . Today&apos;s lessons are listed at the top.
            </li>
            <li>
              When the lesson has started, press <strong>Record lesson</strong> next to it.
            </li>
            <li>
              Tick the topics you taught. Only this week&apos;s topics for that class are shown.
            </li>
            <li>
              Write what you taught in a sentence or two. Learning outcomes, challenges and remarks
              are optional.
            </li>
            <li>
              Press <strong>Submit record</strong>. The headmaster sees it straight away.
            </li>
          </Steps>
          <p className="text-muted">
            Not finished? Press <strong>Save draft</strong> and come back later. A draft does not
            count until you submit it.
          </p>
        </Topic>
        <Topic title="When can I record, and what is overdue?">
          <p>
            You can record a lesson from the moment it starts. If you have not submitted it by the
            next school day, it shows as <strong>overdue</strong>. You can still record it, but it
            is marked late.
          </p>
        </Topic>
        <Topic title='Why does it say a week is "locked"?'>
          <p>
            The scheme is taught in order. A week opens once every lesson of the weeks before it is
            recorded. The message tells you which lessons are still missing; record those first.
          </p>
          <p>
            If a lesson really did not take place, ask the headmaster: they can cancel or waive it.
          </p>
        </Topic>
        <Topic title="I made a mistake in a record I submitted">
          <p>
            Open it under{' '}
            <Link to="/t/records" className="link">
              Teaching records
            </Link>{' '}
            and press <strong>Edit text</strong>. You can correct the text for 48 hours after
            submitting. The topics and the lesson cannot change. The headmaster is told that you
            edited it.
          </p>
        </Topic>
        <Topic title="Where do I see this week's topics?">
          <p>
            <Link to="/t/scheme" className="link">
              Weekly scheme of work
            </Link>{' '}
            shows, for each of your classes, the week&apos;s lessons and the topics to cover. Use
            the arrows to look at other weeks.
          </p>
        </Topic>
        <Topic title="My classes or lessons are missing">
          <p>
            The headmaster assigns your subjects and classes and publishes the timetable. Until then
            nothing appears. Ask them to check <em>Subjects and classes</em> and <em>Timetable</em>.
          </p>
        </Topic>
        <Topic title="Signing in on a phone or a shared computer">
          <p>
            Each browser tab has its own sign-in, so two people can use two tabs on one computer.
            Press <strong>Sign out</strong> when you finish on a shared computer. If you forget your
            password, use <em>Forgot password</em> on the sign-in page.
          </p>
        </Topic>
      </Section>
      <Glossary />
    </>
  );
}

function HeadmasterHelp() {
  return (
    <>
      <Section title="Setting up the school (once per term)" className="mb-5">
        <Topic title="The order to do things in" open>
          <p>
            The checklist on the{' '}
            <Link to="/h" className="link">
              Overview
            </Link>{' '}
            shows where you are and what to do next. In short:
          </p>
          <Steps>
            <li>
              <strong>Term dates</strong>: Settings → Years and terms. Create the academic year,
              then the term with its first and last day.
            </li>
            <li>
              <strong>Week dates</strong>: Settings → Term weeks →{' '}
              <em>Fill weekly from term start</em> → <em>Save weeks</em>.
            </li>
            <li>
              <strong>Classes</strong>: Settings → Classes, for example FORM 1, FORM 2, FORM 3.
            </li>
            <li>
              <strong>Scheme of learning</strong>: Curriculum → upload the term&apos;s PDF. Its
              topics go live at once; correct any topic later with <em>Edit</em>.
            </li>
            <li>
              <strong>Teachers</strong>: Teachers → <em>Add teacher</em>. Add their subjects in the
              same form; <em>All classes</em> fills Form 1 to 3 at once. Each teacher gets an email
              to set a password.
            </li>
            <li>
              <strong>Timetable</strong>: Timetable → upload the timetable PDF or Excel file, press{' '}
              <em>Check</em>, then <em>Save timetable</em>.
            </li>
            <li>
              <strong>Publish</strong>: Timetable → <em>Preview and publish</em>. This creates every
              lesson of the term.
            </li>
            <li>
              <strong>Started mid-term?</strong> On the Timetable page, choose the day recording
              starts so earlier lessons need no record.
            </li>
          </Steps>
        </Topic>
        <Topic title="Uploading the timetable">
          <p>
            A PDF with one page per class (like &quot;Form 1 Timetable&quot;), an Excel file or a
            CSV all work: the days down the side, the period times across the top, the subject in
            each box. Breaks and club meetings are skipped.
          </p>
          <p>
            Every lesson is shown before saving and you can change any day or time. A row that says{' '}
            <em>No teacher is assigned</em> means that subject has no teacher for that class yet:
            add one, then upload the file again.
          </p>
        </Topic>
        <Topic title="The scheme of learning has a mistake">
          <p>
            Curriculum → Topics: choose the level, subject and week, then <strong>Edit</strong> to
            correct the wording or move it to another week, or <strong>Delete</strong> a topic that
            should not be there. A topic that teachers have already recorded can be corrected but
            not deleted.
          </p>
        </Topic>
      </Section>

      <Section title="Every day and every week" className="mb-5">
        <Topic title="Seeing who has recorded">
          <p>
            <Link to="/h" className="link">
              Overview
            </Link>{' '}
            shows today&apos;s lessons and the teachers who are behind.{' '}
            <Link to="/h/daily" className="link">
              Daily lessons
            </Link>{' '}
            lists every lesson of a day;{' '}
            <Link to="/h/progress" className="link">
              Weekly progress
            </Link>{' '}
            shows each class and subject week by week. New records pop up at the bottom of the
            screen as soon as a teacher submits or edits one.
          </p>
        </Topic>
        <Topic title="A lesson did not take place">
          <p>
            In{' '}
            <Link to="/h/daily" className="link">
              Daily lessons
            </Link>
            , find the lesson and choose:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Cancel</strong>: it did not happen and does not count. The next lessons take
              over its topics.
            </li>
            <li>
              <strong>Waive</strong>: it is excused and counts as done without a record.
            </li>
            <li>
              <strong>Reschedule</strong>: it moves to another day and time.
            </li>
          </ul>
        </Topic>
        <Topic title="Holidays, closures and special weeks">
          <p>
            Settings → Holidays and closures: lessons on those days are cancelled automatically.
            Settings → Special weeks marks revision, mock or examination weeks, when no lesson
            records are needed.
          </p>
        </Topic>
        <Topic title="A teacher is away">
          <p>
            Open the teacher under Teachers and press <strong>Approve absence</strong>. Their
            lessons on those days are cancelled, so they do not show as overdue.
          </p>
        </Topic>
        <Topic title="A teacher leaves or changes subjects">
          <p>
            Subjects and classes → <strong>Reassign</strong> gives the subject to another teacher;
            records already written stay with the teacher who wrote them. To stop someone signing
            in, open them under Teachers and press <strong>Deactivate</strong>.
          </p>
        </Topic>
        <Topic title="Why can't I delete something?">
          <p>
            Lesson records are the school&apos;s evidence, so anything they depend on cannot be
            deleted: a teacher who has signed in, a class or subject with records, or a scheme with
            recorded topics. The message says what to do instead, usually{' '}
            <strong>Deactivate</strong>.
          </p>
        </Topic>
      </Section>
      <Glossary />
    </>
  );
}

export function HelpPage({ area }: { area: 'teacher' | 'headmaster' }) {
  return (
    <>
      <PageHeader
        title="Help"
        description={
          area === 'teacher'
            ? 'How to record your lessons, and what the words in the system mean.'
            : 'How to set up the school, follow teaching every day, and what the words in the system mean.'
        }
      />
      {area === 'teacher' ? <TeacherHelp /> : <HeadmasterHelp />}
    </>
  );
}
