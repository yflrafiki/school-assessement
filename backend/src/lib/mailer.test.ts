import { describe, expect, it } from 'vitest';
import { emailWording } from './mailer.js';

describe('emailWording', () => {
  const params = {
    school_name: 'Accra JHS',
    expires_in: '72 hours',
    link: 'https://x/activate#token=t',
  };

  it('words an invitation', () => {
    const w = emailWording('INVITATION', params);
    expect(w.subject).toBe("You're invited to Accra JHS's Teaching Monitor");
    expect(w.action_label).toBe('Activate my account');
    expect(w.intro).toContain('staff ID');
    expect(w.closing_note).toContain('72 hours');
  });

  it('words a password reset differently, so one template serves both', () => {
    const w = emailWording('PASSWORD_RESET', { ...params, expires_in: '60 minutes' });
    expect(w.subject).toBe('Reset your Teaching Monitor password');
    expect(w.action_label).toBe('Choose a new password');
    expect(w.closing_note).toContain('60 minutes');
    expect(w.intro).not.toContain('staff ID');
  });
});
