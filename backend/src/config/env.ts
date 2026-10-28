import 'dotenv/config';
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),
    APP_BASE_URL: z.string().url(),
    CORS_ORIGINS: z.string().default(''),
    /** Production: folder of the built web app (frontend/dist) to serve from the API's origin. */
    WEB_DIST_DIR: z.string().optional(),
    EMAIL_PROVIDER: z.enum(['console', 'emailjs']).default('console'),
    EMAILJS_SERVICE_ID: z.string().default(''),
    EMAILJS_PUBLIC_KEY: z.string().default(''),
    EMAILJS_PRIVATE_KEY: z.string().default(''),
    EMAILJS_TEMPLATE_INVITATION: z.string().default(''),
    EMAILJS_TEMPLATE_RESET: z.string().default(''),
    EMAILJS_MONTHLY_QUOTA: z.coerce.number().int().default(200),
    EMAIL_FROM_NAME: z.string().default('School Teaching Monitor'),
    EMAIL_REPLY_TO: z.string().default(''),
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_PROVIDER === 'emailjs') {
      for (const key of [
        'EMAILJS_SERVICE_ID',
        'EMAILJS_PUBLIC_KEY',
        'EMAILJS_PRIVATE_KEY',
        'EMAILJS_TEMPLATE_INVITATION',
        'EMAILJS_TEMPLATE_RESET',
      ] as const) {
        if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required for EmailJS' });
      }
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues)
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  // Tests run against their own database so they can truncate tables freely.
  DATABASE_URL:
    raw.NODE_ENV === 'test' && raw.TEST_DATABASE_URL ? raw.TEST_DATABASE_URL : raw.DATABASE_URL,
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
