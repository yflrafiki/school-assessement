import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, newPassword } from '@school/shared';
import { api } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { PageHeader, Section } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Alert } from '../../components/States';
import { useCurrentUser } from './useMe';

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
              <dd>{me.fullName}</dd>
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
            To change your name or email, ask your headmaster.
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
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
            </FormField>
            <FormField
              label="New password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
              error={e.newPassword?.message}
            >
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                {...form.register('newPassword')}
              />
            </FormField>
            <FormField label="Confirm new password" error={e.confirm?.message}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                {...form.register('confirm')}
              />
            </FormField>
            {formError && <Alert>{formError}</Alert>}
            {done && (
              <Alert tone="ok">Password changed. Your other devices have been signed out.</Alert>
            )}
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={change.isPending}>
                {change.isPending ? 'Saving…' : 'Change password'}
              </button>
            </div>
          </form>
        </Section>
      </div>
    </>
  );
}
