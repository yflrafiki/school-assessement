import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, newPassword, type Me } from '@school/shared';
import { api, type One } from '../../lib/api';
import { applyServerErrors, fullErrorMessage } from '../../lib/forms';
import { PageHeader, Section } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { SubmitButton } from '../../components/SubmitButton';
import { PasswordInput } from '../../components/PasswordInput';
import { Alert } from '../../components/States';
import { meKey, useCurrentUser } from './useMe';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'The passwords do not match',
    path: ['confirm'],
  });

export function ProfilePage() {
  const me = useCurrentUser();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema) });
  const change = useMutation({
    mutationFn: (v: z.input<typeof schema>) =>
      api.post('/auth/password/change', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      }),
    onSuccess: () => {
      setDone(true);
      form.reset();
    },
    onError: (err) =>
      setFormError(applyServerErrors(err, form.setError, ['currentPassword', 'newPassword'])),
  });
  const e = form.formState.errors;

  return (
    <>
      <PageHeader title="Profile" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Your details">
          <dl className="space-y-3 px-4 py-4 text-sm">
            <div>
              <dt className="text-muted">Name</dt>
              <dd>{me.role === 'TEACHER' ? me.fullName : <EditOwnName current={me.fullName} />}</dd>
            </div>
            <div>
              <dt className="text-muted">Email</dt>
              <dd>{me.email}</dd>
            </div>
            <div>
              <dt className="text-muted">School</dt>
              <dd>{me.school.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Role</dt>
              <dd>
                {me.role === 'SCHOOL_ADMIN'
                  ? 'School admin'
                  : me.role === 'HEADMASTER'
                    ? 'Headmaster'
                    : 'Teacher'}
              </dd>
            </div>
          </dl>
          <p className="border-t border-line px-4 py-3 text-xs text-muted">
            {me.role === 'TEACHER'
              ? 'To change your name or email, ask your headmaster.'
              : 'Your email is your sign-in, so it can only be changed by the system operator. The school name is changed under Settings.'}
          </p>
        </Section>
        <Section title="Change password">
          <form
            className="space-y-4 px-4 py-4"
            noValidate
            onSubmit={form.handleSubmit((v) => {
              setFormError(null);
              setDone(false);
              change.mutate(v);
            })}
          >
            <FormField label="Current password" error={e.currentPassword?.message}>
              <PasswordInput
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
            </FormField>
            <FormField
              label="New password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
              error={e.newPassword?.message}
            >
              <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
            </FormField>
            <FormField label="Confirm new password" error={e.confirm?.message}>
              <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
            </FormField>
            {formError && <Alert>{formError}</Alert>}
            {done && (
              <Alert tone="ok">Password changed. Your other devices have been signed out.</Alert>
            )}
            <div className="flex justify-end">
              <SubmitButton
                pending={change.isPending}
                pendingLabel="Saving…"
                className="btn-primary"
              >
                Change password
              </SubmitButton>
            </div>
          </form>
        </Section>
      </div>
    </>
  );
}

/** Inline name editor for headmasters and school admins. */
function EditOwnName({ current }: { current: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (fullName: string) => api.patch<One<Me>>('/auth/me', { fullName }),
    onSuccess: (res) => {
      qc.setQueryData(meKey, res.data);
      setEditing(false);
    },
    onError: (err) => setError(fullErrorMessage(err)),
  });

  if (!editing) {
    return (
      <span className="flex items-center gap-2">
        {current}
        <button
          type="button"
          className="btn-ghost h-7 px-2 text-xs"
          onClick={() => {
            setName(current);
            setError(null);
            setEditing(true);
          }}
        >
          Edit
        </button>
      </span>
    );
  }
  return (
    <form
      className="mt-1 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate(name);
      }}
    >
      <label className="sr-only" htmlFor="own-name">
        Full name
      </label>
      <input
        id="own-name"
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
      />
      {error && <Alert>{error}</Alert>}
      <span className="flex gap-2">
        <SubmitButton pending={save.isPending} pendingLabel="Saving…" className="btn-primary h-8">
          Save
        </SubmitButton>
        <button
          type="button"
          className="btn-secondary h-8"
          onClick={() => setEditing(false)}
          disabled={save.isPending}
        >
          Cancel
        </button>
      </span>
    </form>
  );
}
