import type { FieldValues, Path, UseFormRegister } from 'react-hook-form';
import { ASSESSMENT_KINDS, ASSESSMENT_LABELS, type AssessmentKind } from '@school/shared';
import { FormField } from '../../components/FormField';

/** The form values this part of a record form needs. */
export interface AssessmentValues {
  assessments: AssessmentKind[];
  assessmentNote: string;
}

/**
 * "Did you give the class any work?": class exercise, assignment or class test, ticked in any
 * combination (none ticked means none given), with an optional note on what it was.
 */
export function AssessmentFields<T extends FieldValues & AssessmentValues>({
  register,
  noteError,
}: {
  register: UseFormRegister<T>;
  noteError?: string | undefined;
}) {
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="label">Work given to the class</legend>
        <p className="mb-2 text-xs text-muted">Tick all that apply. Leave empty if none.</p>
        <div className="flex flex-wrap gap-2">
          {ASSESSMENT_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-canvas has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
            >
              <input
                type="checkbox"
                value={kind}
                className="h-4 w-4 accent-[#0f766e]"
                {...register('assessments' as Path<T>)}
              />
              {ASSESSMENT_LABELS[kind]}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField
        label="What was given"
        hint='For example "Exercise 3.2, questions 1 to 10" or "Test on fractions, 20 marks"'
        error={noteError}
      >
        <input className="input" maxLength={300} {...register('assessmentNote' as Path<T>)} />
      </FormField>
    </div>
  );
}

/** "Assignment / homework, Class test", or "None" when nothing was given. */
export function assessmentText(kinds: readonly AssessmentKind[]) {
  return kinds.length ? kinds.map((k) => ASSESSMENT_LABELS[k]).join(', ') : 'None';
}
