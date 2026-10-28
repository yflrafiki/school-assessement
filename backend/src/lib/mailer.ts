import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export type EmailTemplateName = 'INVITATION' | 'PASSWORD_RESET';

export interface EmailMessage {
  to: string;
  template: EmailTemplateName;
  params: Record<string, string>;
}

/** The only thing the rest of the system knows about email. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Local development: prints the message (including the link) to the API log. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    logger.info(
      { to: message.to, template: message.template, link: message.params.link },
      'Email (console provider). Open the link to continue.',
    );
  }
}

/**
 * Wording for each kind of email. It travels with the message, so one EmailJS template
 * ({{subject}}, {{heading}}, {{intro}}, {{action_label}}, {{link}}, {{closing_note}}) can show
 * either email. The free EmailJS plan may allow only one template.
 */
export function emailWording(template: EmailTemplateName, p: Record<string, string>) {
  const school = p.school_name ?? 'your school';
  if (template === 'INVITATION') {
    return {
      subject: `You're invited to ${school}'s Teaching Monitor`,
      heading: 'Activate your account',
      intro: `${school} has created a Teaching Monitor account for you. Activate it to start recording your lessons. You will be asked for your staff ID and to choose a password.`,
      action_label: 'Activate my account',
      closing_note: `This link expires in ${p.expires_in ?? '72 hours'} and can only be used once. If you were not expecting this email, you can ignore it.`,
    };
  }
  return {
    subject: 'Reset your Teaching Monitor password',
    heading: 'Choose a new password',
    intro: `We received a request to reset your password for ${school}'s Teaching Monitor.`,
    action_label: 'Choose a new password',
    closing_note: `This link expires in ${p.expires_in ?? '60 minutes'} and can only be used once. If you did not ask for this, ignore this email and your password stays the same.`,
  };
}

export class EmailJsProvider implements EmailProvider {
  readonly name = 'emailjs';

  async send(message: EmailMessage): Promise<void> {
    // A separate reset template is optional; without one, both emails share the invitation template.
    const templateId =
      message.template === 'PASSWORD_RESET' && env.EMAILJS_TEMPLATE_RESET
        ? env.EMAILJS_TEMPLATE_RESET
        : env.EMAILJS_TEMPLATE_INVITATION;
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: env.EMAILJS_SERVICE_ID,
        template_id: templateId,
        user_id: env.EMAILJS_PUBLIC_KEY,
        accessToken: env.EMAILJS_PRIVATE_KEY,
        template_params: {
          ...message.params,
          ...emailWording(message.template, message.params),
          to_email: message.to,
          from_name: env.EMAIL_FROM_NAME,
          reply_to: env.EMAIL_REPLY_TO,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new Error(`EmailJS responded ${response.status}: ${text}`);
    }
  }
}

let provider: EmailProvider =
  env.EMAIL_PROVIDER === 'emailjs' ? new EmailJsProvider() : new ConsoleEmailProvider();

export function emailProvider(): EmailProvider {
  return provider;
}

/** Tests swap in a capturing provider. */
export function setEmailProvider(next: EmailProvider) {
  provider = next;
}
