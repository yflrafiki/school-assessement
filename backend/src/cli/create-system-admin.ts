// Operator command: creates the system admin, who sees every school read-only.
// Usage: pnpm --filter @school/api create-system-admin -- --name "Full Name" --email a@b.c
// The password is read from the SYSTEM_ADMIN_PASSWORD environment variable, or prompted for.
// There is deliberately no way to create this account from the app.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { prisma } from '../lib/db.js';
import { hashPassword, passwordProblem } from '../lib/password.js';
import { audit } from '../lib/audit.js';

async function readPassword(): Promise<string> {
  if (process.env.SYSTEM_ADMIN_PASSWORD) return process.env.SYSTEM_ADMIN_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const value = await rl.question('Password for the system admin (input is visible): ');
  rl.close();
  return value;
}

async function main() {
  const { values } = parseArgs({
    // pnpm passes its "--" separator through; it is not an argument.
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: { name: { type: 'string' }, email: { type: 'string' } },
  });
  const email = values.email?.trim().toLowerCase();
  if (!values.name || !email) {
    console.error('Required: --name "Full Name" --email address');
    process.exit(1);
  }
  const password = await readPassword();
  const problem = passwordProblem(password, [
    email.split('@')[0] ?? '',
    ...values.name.split(/\s+/),
  ]);
  if (problem) {
    console.error(`Password rejected: ${problem}`);
    process.exit(1);
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    console.error('An account with this email already exists. Use a different email.');
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        schoolId: null,
        email,
        fullName: values.name as string,
        role: 'SYSTEM_ADMIN',
        status: 'ACTIVE',
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });
    await audit(tx, {
      schoolId: null,
      actorId: null,
      action: 'system_admin.created_by_operator',
      entityType: 'User',
      entityId: created.id,
    });
    return created;
  });
  console.log(`Created system admin ${user.email}. Sign in at the usual address.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
