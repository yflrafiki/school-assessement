import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, forgotPasswordBody, loginBody, newPassword } from '@school/shared';
import { api, setSessionToken, type One } from '../../lib/api';
import { applyServerErrors, errorMessage } from '../../lib/forms';
import { FormField } from '../../components/FormField';
import { SubmitButton } from '../../components/SubmitButton';
import { PasswordInput } from '../../components/PasswordInput';
import { Alert, LoadingState } from '../../components/States';
import { PublicLayout } from '../../app/AppShell';
import { fetchMe, meKey, useMe } from './useMe';
import { homeFor } from '../../app/guards';
import { safeReturnTo } from '../../lib/safeRedirect';

/** Tokens arrive in the URL fragment (#token=...) so they never reach server logs. */
function useFragmentToken(): string {
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  useEffect(() => {
    // Remove the token from the address bar and history once read.
    if (window.location.hash)
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);
  return token;
}

/**
 * Shown under a submit button while its request runs. If it takes longer than a few seconds
 * (the hosted database can take a moment to wake up), it says so instead of looking frozen.
 */
function PendingNotice({ message }: { message: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <p role="status" aria-live="polite" className="text-center text-sm text-muted">
      {slow ? 'Still working. The server can take a few seconds to wake up, please wait…' : message}
    </p>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof loginBody>>({ resolver: zodResolver(loginBody) });

  // Already signed in: go straight to the right home page.
  useEffect(() => {
    if (me.data)
      navigate(safeReturnTo(params.get('returnTo')) ?? homeFor(me.data.role), { replace: true });
  }, [me.data, navigate, params]);

  const login = useMutation({
    mutationFn: (values: z.input<typeof loginBody>) =>
      api.post<One<{ token: string }>>('/auth/login', values),
    onSuccess: async (res) => {
      setSessionToken(res.data.token);
      // Drop everything cached for the previous user before showing the new one's pages.
      qc.clear();
      const user = await fetchMe();
      qc.setQueryData(meKey, user);
      if (user)
        navigate(safeReturnTo(params.get('returnTo')) ?? homeFor(user.role), { replace: true });
    },
    onError: (err) => setFormError(applyServerErrors(err, form.setError, ['email', 'password'])),
  });

  return (
    <PublicLayout>
      <h1 className="mb-4 text-base font-semibold">Sign in</h1>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          login.mutate(v);
        })}
      >
        {/* Locked while signing in, so the details cannot change mid-request. */}
        <fieldset disabled={login.isPending} className="space-y-4">
          <FormField label="Email" error={form.formState.errors.email?.message}>
            <input
              className="input"
              type="email"
              autoComplete="username"
              {...form.register('email')}
            />
          </FormField>
          <FormField label="Password" error={form.formState.errors.password?.message}>
            <PasswordInput autoComplete="current-password" {...form.register('password')} />
          </FormField>
        </fieldset>
        {formError && <Alert>{formError}</Alert>}
        <SubmitButton
          pending={login.isPending}
          pendingLabel="Signing in…"
          className="btn-primary w-full"
        >
          Sign in
        </SubmitButton>
        {login.isPending && <PendingNotice message="Checking your details…" />}
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="link">
            Forgot your password?
          </Link>
        </p>
      </form>
    </PublicLayout>
  );
}

const activateForm = z
  .object({
    staffId: z.string().trim().min(1, 'Enter your staff ID'),
    password: newPassword,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'The passwords do not match',
    path: ['confirm'],
  });

export function ActivatePage() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof activateForm>>({ resolver: zodResolver(activateForm) });

  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      api.post<One<{ fullName: string; schoolName: string; email: string }>>(
        '/auth/invitations/validate',
        { token },
      ),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });

  const accept = useMutation({
    mutationFn: (v: z.input<typeof activateForm>) =>
      api.post<One<{ token: string }>>('/auth/invitations/accept', {
        token,
        staffId: v.staffId,
        password: v.password,
      }),
    onSuccess: async (res) => {
      setSessionToken(res.data.token);
      qc.clear();
      qc.setQueryData(meKey, await fetchMe());
      navigate('/t', { replace: true });
    },
    onError: (err) => setFormError(applyServerErrors(err, form.setError, ['staffId', 'password'])),
  });

  if (!token || invitation.isError) {
    return (
      <PublicLayout>
        <h1 className="mb-2 text-base font-semibold">Invitation link not valid</h1>
        <p className="text-sm text-muted">
          {invitation.isError
            ? errorMessage(invitation.error)
            : 'This page needs the link from your invitation email.'}
        </p>
        <p className="mt-4 text-sm">
          <Link to="/login" className="link">
            Go to sign in
          </Link>
        </p>
      </PublicLayout>
    );
  }
  if (invitation.isPending)
    return (
      <PublicLayout>
        <LoadingState label="Checking your invitation" />
      </PublicLayout>
    );

  const inv = invitation.data.data;
  return (
    <PublicLayout>
      <h1 className="text-base font-semibold">Activate your account</h1>
      <p className="mb-4 mt-1 text-sm text-muted">
        Welcome, {inv.fullName}. You were invited to {inv.schoolName} as {inv.email}.
      </p>
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(null);
          accept.mutate(v);
        })}
      >
        <FormField
          label="Staff ID"
          hint="As given by your headmaster"
          error={form.formState.errors.staffId?.message}
        >
          <input className="input" autoComplete="off" {...form.register('staffId')} />
        </FormField>
        <FormField
          label="New password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`}
          error={form.formState.errors.password?.message}
        >
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <FormField label="Confirm password" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </FormField>
        {formError && <Alert>{formError}</Alert>}
        <SubmitButton
          pending={accept.isPending}
          pendingLabel="Activating…"
          className="btn-primary w-full"
        >
          Activate account
        </SubmitButton>
      </form>
    </PublicLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordBody>>({
    resolver: zodResolver(forgotPasswordBody),
  });
  const forgot = useMutation({
    mutationFn: (v: z.input<typeof forgotPasswordBody>) =>
      api.post<One<{ message: string }>>('/auth/password/forgot', v),
    onSuccess: (res) => setSent(res.data.message),
    onError: (err) => setFormError(applyServerErrors(err, form.setError, ['email'])),
  });
  return (
    <PublicLayout>
      <h1 className="mb-1 text-base font-semibold">Reset your password</h1>
      {sent ? (
        <>
          <Alert tone="ok">{sent}</Alert>
          <p className="mt-4 text-sm">
            <Link to="/login" className="link">
              Back to sign in
            </Link>
          </p>
        </>
      ) : (
        <form
          noValidate
          className="mt-3 space-y-4"
          onSubmit={form.handleSubmit((v) => {
            setFormError(null);
            forgot.mutate(v);
          })}
        >
          <p className="text-sm text-muted">
            Enter your email and we will send a link to choose a new password.
          </p>
          <FormField label="Email" error={form.formState.errors.email?.message}>
            <input
              className="input"
              type="email"
              autoComplete="username"
              {...form.register('email')}
            />
          </FormField>
          {formError && <Alert>{formError}</Alert>}
          <SubmitButton
            pending={forgot.isPending}
            pendingLabel="Sending…"
            className="btn-primary w-full"
          >
            Send reset link
          </SubmitButton>
          <p className="text-center text-sm">
            <Link to="/login" className="link">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </PublicLayout>
  );
}

const resetForm = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'The passwords do not match',
    path: ['confirm'],
  });

export function ResetPasswordPage() {
  const token = useFragmentToken();
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof resetForm>>({ resolver: zodResolver(resetForm) });
  const reset = useMutation({
    mutationFn: (v: z.input<typeof resetForm>) =>
      api.post<One<{ message: string }>>('/auth/password/reset', { token, password: v.password }),
    onSuccess: (res) => setDone(res.data.message),
    onError: (err) => setFormError(applyServerErrors(err, form.setError, ['password'])),
  });
  return (
    <PublicLayout>
      <h1 className="mb-3 text-base font-semibold">Choose a new password</h1>
      {!token ? (
        <p className="text-sm text-muted">
          This page needs the link from your reset email.{' '}
          <Link to="/forgot-password" className="link">
            Request a new link
          </Link>
          .
        </p>
      ) : done ? (
        <>
          <Alert tone="ok">{done}</Alert>
          <p className="mt-4 text-sm">
            <Link to="/login" className="link">
              Sign in
            </Link>
          </p>
        </>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => {
            setFormError(null);
            reset.mutate(v);
          })}
        >
          <FormField
            label="New password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
            error={form.formState.errors.password?.message}
          >
            <PasswordInput autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <FormField label="Confirm password" error={form.formState.errors.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
          </FormField>
          {formError && (
            <Alert>
              {formError}{' '}
              <Link to="/forgot-password" className="underline">
                Request a new link
              </Link>
            </Alert>
          )}
          <SubmitButton
            pending={reset.isPending}
            pendingLabel="Saving…"
            className="btn-primary w-full"
          >
            Save new password
          </SubmitButton>
        </form>
      )}
    </PublicLayout>
  );
}
