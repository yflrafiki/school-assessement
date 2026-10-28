import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/lib/db.js';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '../src/middleware/session.js';
import { MAX_STREAMS_PER_USER } from '../src/modules/notifications/notifications.routes.js';
import { app, createSchoolWithHeadmaster, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('security headers', () => {
  it('forbids caching of API data and framing of the site, with a strict CSP', async () => {
    const { client } = await createSchoolWithHeadmaster();
    const res = await client.get('/auth/me');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // No third-party origins anywhere in the policy.
    expect(csp).not.toMatch(/https?:|\*/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('also sets no-store on error responses', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('session lifetime', () => {
  it('uses short idle and absolute limits', () => {
    expect(SESSION_IDLE_MS).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
    expect(SESSION_ABSOLUTE_MS).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
  });

  it('ends a session at the absolute limit even while it is in use', async () => {
    const { client, user } = await createSchoolWithHeadmaster();
    expect((await client.get('/auth/me')).status).toBe(200);
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await client.get('/auth/me')).status).toBe(401);
  });
});

describe('live notification connections', () => {
  it(`allows at most ${MAX_STREAMS_PER_USER} at once per person, and frees slots when they close`, async () => {
    const { client } = await createSchoolWithHeadmaster();
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/api/v1/notifications/stream`;
    const controllers: AbortController[] = [];
    const open = async () => {
      const c = new AbortController();
      controllers.push(c);
      return fetch(url, { headers: { Authorization: `Bearer ${client.token}` }, signal: c.signal });
    };
    try {
      for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) expect((await open()).status).toBe(200);
      expect((await open()).status).toBe(429);

      controllers[0]!.abort();
      await new Promise((r) => setTimeout(r, 200));
      expect((await open()).status).toBe(200);
    } finally {
      for (const c of controllers) c.abort();
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('slow database', () => {
  // Prisma's default 5-second transaction limit failed curriculum imports on a remote,
  // waking-up database with a 500. Transactions now have a minute.
  it(
    'lets a transaction run longer than Prisma’s 5-second default',
    { timeout: 20_000 },
    async () => {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_sleep(6)::text AS slept`;
        return 'committed';
      });
      expect(result).toBe('committed');
    },
  );
});

describe('production configuration', () => {
  const start = (env: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions=source',
        '-e',
        "await import('./src/config/env.ts'); console.log('started');",
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
          ...env,
        },
        timeout: 60_000,
      },
    );

  it('refuses http links, CORS origins and console email in production', () => {
    const res = start({
      NODE_ENV: 'production',
      APP_BASE_URL: 'http://school.example',
      CORS_ORIGINS: 'https://evil.example',
      EMAIL_PROVIDER: 'console',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('APP_BASE_URL');
    expect(res.stderr).toContain('CORS_ORIGINS');
    expect(res.stderr).toContain('EMAIL_PROVIDER');
  });

  it('starts with secure production settings', () => {
    const res = start({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://school.example',
      // Set explicitly: otherwise the developer .env (loaded by dotenv) supplies its dev origin.
      CORS_ORIGINS: '',
      EMAIL_PROVIDER: 'emailjs',
      EMAILJS_SERVICE_ID: 's',
      EMAILJS_PUBLIC_KEY: 'p',
      EMAILJS_PRIVATE_KEY: 'k',
      EMAILJS_TEMPLATE_INVITATION: 't',
    });
    expect(res.stdout, res.stderr).toContain('started');
  });
});
