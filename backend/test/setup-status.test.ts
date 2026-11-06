import { beforeEach, describe, expect, it } from 'vitest';
import {
  createActiveTeacher,
  createSchoolWithHeadmaster,
  expectOk,
  publishSampleScheme,
  resetDb,
  setupTerm,
  subjectId,
} from './helpers.js';

beforeEach(resetDb);

type Step = { id: string; done: boolean; detail: string };
const byId = (steps: Step[]) => Object.fromEntries(steps.map((s) => [s.id, s]));

describe('setup checklist', () => {
  it('starts with nothing done and ticks each step off from the school’s own data', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const empty = expectOk(await head.get('/setup-status')).body.data;
    expect(empty.complete).toBe(false);
    expect(empty.steps.map((s: Step) => s.id)).toEqual([
      'term',
      'weeks',
      'classes',
      'scheme',
      'teachers',
      'subjects',
      'timetable',
      'publish',
      'start',
    ]);
    expect(empty.steps.every((s: Step) => !s.done || s.id === 'start')).toBe(true);

    const { termId } = await setupTerm(head, 0);
    const cls = expectOk(await head.post('/classes', { level: 'BASIC_7', name: 'FORM 1' }));
    const empty2 = expectOk(await head.post('/classes', { level: 'BASIC_8', name: 'FORM 2' }));
    await publishSampleScheme(head, termId);
    const { teacher } = await createActiveTeacher(head, {
      fullName: 'Kofi Boateng',
      email: 'kofi@test.example',
      staffId: 'GES-1',
      assignments: [{ subjectId: await subjectId(head, 'Mathematics'), classId: cls.body.data.id }],
    });

    let steps = byId(expectOk(await head.get('/setup-status')).body.data.steps);
    expect(steps.term!.done && steps.weeks!.done && steps.classes!.done).toBe(true);
    expect(steps.scheme!.detail).toBe('12 topics live');
    expect(steps.teachers!.detail).toBe('1 teacher signed in');
    // FORM 2 has no subjects yet, so this step is not done and says why.
    expect(steps.subjects!.done).toBe(false);
    expect(steps.subjects!.detail).toMatch(/nothing yet for FORM 2/);
    expect(steps.timetable!.done).toBe(false);

    expectOk(await head.patch(`/classes/${empty2.body.data.id}`, { isActive: false }));
    const assignmentId = expectOk(await head.get(`/assignments?teacherProfileId=${teacher.id}`))
      .body.data[0].id as string;
    expectOk(
      await head.post('/timetable-entries', {
        assignmentId,
        weekday: 1,
        startTime: '08:00',
        endTime: '09:00',
      }),
    );
    steps = byId(expectOk(await head.get('/setup-status')).body.data.steps);
    expect(steps.timetable!.done).toBe(true);
    expect(steps.publish!.done).toBe(false);

    expectOk(await head.post('/timetable/publish', { termId }));
    const done = expectOk(await head.get('/setup-status')).body.data;
    expect(done.complete).toBe(true);
  });

  it('is for the headmaster only', async () => {
    const { client: head } = await createSchoolWithHeadmaster();
    const { client: teacher } = await createActiveTeacher(head, {
      fullName: 'Ama Owusu',
      email: 'ama@test.example',
      staffId: 'GES-2',
    });
    expect((await teacher.get('/setup-status')).status).toBe(403);
  });
});
