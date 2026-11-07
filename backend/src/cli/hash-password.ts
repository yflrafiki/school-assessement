// Operator command: prints the stored form (Argon2id hash) of a password, for adding an
// account by hand in SQL (for example the system admin in Neon's SQL Editor). The password
// itself is never stored or printed.
// Usage: pnpm --filter @school/api hash-password
import { createInterface } from 'node:readline/promises';
import { hashPassword, passwordProblem } from '../lib/password.js';

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password =
    process.env.NEW_PASSWORD ?? (await rl.question('Password to hash (input is visible): '));
  rl.close();
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`Password rejected: ${problem}`);
    process.exit(1);
  }
  console.log(await hashPassword(password));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
