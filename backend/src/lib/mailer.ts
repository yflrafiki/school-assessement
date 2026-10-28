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

export class EmailJsProvider implements EmailProvider {
  readonly name = 'emailjs';

  async send(message: EmailMessage): Promise<void> {
    const templateId =
      message.template === 'INVITATION'
        ? env.EMAILJS_TEMPLATE_INVITATION
        : env.EMAILJS_TEMPLATE_RESET;
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
