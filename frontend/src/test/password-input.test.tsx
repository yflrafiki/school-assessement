import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from '../components/PasswordInput';

describe('PasswordInput', () => {
  it('starts hidden and toggles between showing and hiding the password', async () => {
    render(<PasswordInput aria-label="Password" defaultValue="Accra-Sunrise-2026" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('does not submit the surrounding form when the eye is clicked', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="Password" />
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
