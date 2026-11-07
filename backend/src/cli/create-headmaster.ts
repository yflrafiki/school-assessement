// Operator command: creates a headmaster for the school. The system serves one school (Ipel):
// the first run creates it, and every later run adds the headmaster to that same school.
// Usage: pnpm --filter @school/api create-headmaster -- --name "Full Name" --email a@b.c
//        (first run only: also --school "IPEL International School")
// The password is read from the HEADMASTER_PASSWORD environment variable, or prompted for.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { prisma } from '../lib/db.js';
import { hashPassword, passwordProblem } from '../lib/password.js';
import { audit } from '../lib/audit.js';

async function readPassword(): Promise<string> {
  if (process.env.HEADMASTER_PASSWORD) return process.env.HEADMASTER_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const value = await rl.question('Password for the headmaster (input is visible): ');
  rl.close();
  return value;
}

async function main() {
  const { values } = parseArgs({
    // pnpm passes its "--" separator through; it is not an argument.
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      school: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      timezone: { type: 'string', default: 'Africa/Accra' },
    },
  });
  const email = values.email?.trim().toLowerCase();
  if (!values.name || !email) {
    console.error('Required: --name "Full Name" --email address');
    process.exit(1);
  }
  const existing = await prisma.school.findMany({ select: { id: true, name: true } });
  if (existing.length && values.school) {
    console.error(
      `This system serves one school, "${existing[0]?.name}". Leave out --school to add the headmaster to it.`,
    );
    process.exit(1);
  }
  if (!existing.length && !values.school) {
    console.error(
      'No school yet. On the first run, also pass --school "IPEL International School".',
    );
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
    console.error('An account with this email already exists.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    const school = existing[0]
      ? await tx.school.findUniqueOrThrow({ where: { id: existing[0].id } })
      : await tx.school.create({
          data: { name: values.school as string, timezone: values.timezone as string },
        });
    const user = await tx.user.create({
      data: {
        schoolId: school.id,
        email,
        fullName: values.name as string,
        role: 'HEADMASTER',
        status: 'ACTIVE',
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });
    await audit(tx, {
      schoolId: school.id,
      actorId: null,
      action: 'headmaster.created_by_operator',
      entityType: 'User',
      entityId: user.id,
    });
    return { school, user };
  });
  console.log(
    `Created headmaster ${result.user.email} for "${result.school.name}" (school id ${result.school.id}).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
