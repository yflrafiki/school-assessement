// Seeds the national subject catalogue (shared by every school). Safe to run repeatedly.
import { prisma } from '../src/lib/db.js';

export const NATIONAL_SUBJECTS = [
  { code: 'ENG', name: 'English Language' },
  { code: 'COMP', name: 'Computing' },
  { code: 'SOC', name: 'Social Studies' },
  { code: 'SCI', name: 'Science' },
  { code: 'RME', name: 'Religious and Moral Education' },
  { code: 'MATH', name: 'Mathematics' },
  { code: 'CAD', name: 'Creative Arts and Design' },
  { code: 'CT', name: 'Career Technology' },
  { code: 'FRE', name: 'French' },
  // Generic framework: schools add one subject per language that points here.
  { code: 'GHL', name: 'Ghanaian Language', isFramework: true },
] as const;

export async function seedSubjects() {
  for (const [i, s] of NATIONAL_SUBJECTS.entries()) {
    const existing = await prisma.subject.findFirst({ where: { schoolId: null, code: s.code } });
    const data = {
      name: s.name,
      sortOrder: i + 1,
      isFramework: 'isFramework' in s && s.isFramework,
    };
    if (existing) await prisma.subject.update({ where: { id: existing.id }, data });
    else await prisma.subject.create({ data: { ...data, code: s.code, schoolId: null } });
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/seed.ts');
if (isDirectRun) {
  seedSubjects()
    .then(() => console.log(`Seeded ${NATIONAL_SUBJECTS.length} national subjects.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
