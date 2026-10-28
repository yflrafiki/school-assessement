// Operator command: creates a school (if needed) and its first headmaster.
// Usage: pnpm --filter @school/api create-headmaster -- --school "Name" --name "Full Name" --email a@b.c
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
    options: {
      school: { type: 'string' },
      'school-id': { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      timezone: { type: 'string', default: 'Africa/Accra' },
    },
  });
  const email = values.email?.trim().toLowerCase();
  if (!values.name || !email || (!values.school && !values['school-id'])) {
    console.error(
      'Required: --name, --email and either --school "School name" or --school-id <id>',
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
    const school = values['school-id']
      ? await tx.school.findUniqueOrThrow({ where: { id: values['school-id'] } })
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
