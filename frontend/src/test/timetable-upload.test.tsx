import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimetablePage } from '../features/headmaster/TimetablePage';
import {
  cellText,
  parseCsv,
  parseRange,
  parseTime,
  rowsFromSheets,
  templateCsv,
} from '../features/headmaster/timetableFile';
import { makeMe, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

describe('reading a timetable file', () => {
  it('reads times the way schools write them, with 1 to 5 o’clock in the afternoon', () => {
    expect(parseTime('8:00')).toBe('08:00');
    expect(parseTime('8.40')).toBe('08:40');
    expect(parseTime('1:30')).toBe('13:30');
    expect(parseTime('1:30 pm')).toBe('13:30');
    expect(parseTime('12:30')).toBe('12:30');
    expect(parseTime('13:10')).toBe('13:10');
    expect(parseTime('soon')).toBeNull();
    expect(parseRange('8:00 - 8:40')).toEqual(['08:00', '08:40']);
    expect(parseRange('12:30–1:10')).toEqual(['12:30', '13:10']);
    expect(parseRange('Monday')).toBeNull();
    // Excel time cells.
    expect(cellText(8.5 / 24)).toBe('08:30');
    expect(cellText(new Date(Date.UTC(1899, 11, 30, 9, 20)))).toBe('09:20');
  });

  it('reads the grid layout: merged day cells carry forward and breaks are skipped', () => {
    const csv = [
      'Class,Day,8:00-8:40,8:40-9:20,9:20-10:00,1:30-2:10',
      'B7A,Monday,Maths,Break,English (Mrs Mensah),Science',
      'B7B,,Science,,Maths,',
      'B7A,Tue,RME,Worship,French,',
    ].join('\n');
    const { rows, notes } = rowsFromSheets([{ name: 'Sheet1', rows: parseCsv(csv) }]);
    expect(notes).toEqual([]);
    expect(rows).toEqual([
      { className: 'B7A', subject: 'Maths', weekday: 1, startTime: '08:00', endTime: '08:40' },
      { className: 'B7A', subject: 'English', weekday: 1, startTime: '09:20', endTime: '10:00' },
      { className: 'B7A', subject: 'Science', weekday: 1, startTime: '13:30', endTime: '14:10' },
      { className: 'B7B', subject: 'Science', weekday: 1, startTime: '08:00', endTime: '08:40' },
      { className: 'B7B', subject: 'Maths', weekday: 1, startTime: '09:20', endTime: '10:00' },
      { className: 'B7A', subject: 'RME', weekday: 2, startTime: '08:00', endTime: '08:40' },
      { className: 'B7A', subject: 'French', weekday: 2, startTime: '09:20', endTime: '10:00' },
    ]);
  });

  it('reads the list layout, and takes the class from the sheet name when there is no column', () => {
    const list = parseCsv(
      'Day;Subject;Start;End\nWednesday;"Creative Arts; Design";10:30;11:10\nFriday;Maths;8:00;8:40',
    );
    expect(rowsFromSheets([{ name: 'B8A', rows: list }]).rows).toEqual([
      {
        className: 'B8A',
        subject: 'Creative Arts; Design',
        weekday: 3,
        startTime: '10:30',
        endTime: '11:10',
      },
      { className: 'B8A', subject: 'Maths', weekday: 5, startTime: '08:00', endTime: '08:40' },
    ]);
  });

  it('explains a sheet it cannot read', () => {
    const { rows, notes } = rowsFromSheets([{ name: 'Notes', rows: [['Hello'], ['World']] }]);
    expect(rows).toEqual([]);
    expect(notes[0]).toMatch(/no "Day" column/);
  });

  it('builds a template that reads back as an empty timetable', () => {
    const grid = parseCsv(templateCsv(['B7A', 'B7B']));
    expect(grid[0]!.slice(0, 3)).toEqual(['Class', 'Day', '8:00-8:40']);
    expect(grid).toHaveLength(11);
    expect(rowsFromSheets([{ name: 't', rows: grid }]).rows).toEqual([]);
  });
});

const term = {
  id: 't1',
  academicYearId: 'y1',
  academicYearName: '2026/2027',
  number: 1,
  name: 'First Term',
  startDate: '2099-09-07',
  endDate: '2099-12-11',
  isCurrent: true,
  weekCount: 14,
};

describe('uploading the timetable', () => {
  it('shows every slot, lets a time be changed, and saves after the server checks it', async () => {
    const calls = mockApi((method, path, body) => {
      if (path === '/terms') return { status: 200, body: { data: [term] } };
      if (path === '/classes')
        return {
          status: 200,
          body: { data: [{ id: 'c1', level: 'BASIC_7', name: 'B7A', isActive: true }] },
        };
      if (path.startsWith('/timetable-entries')) return { status: 200, body: { data: [] } };
      if (path.startsWith('/assignments')) return { status: 200, body: { data: [] } };
      if (method === 'POST' && path === '/timetable/import') {
        const b = body as { dryRun: boolean; rows: { className: string }[] };
        return {
          status: 200,
          body: {
            data: {
              rows: b.rows.map((r, i) => ({
                ...r,
                row: i + 1,
                matchedSubject: 'Mathematics',
                teacher: 'Kofi Boateng',
              })),
              created: b.dryRun ? 0 : b.rows.length,
              replaced: 0,
              saved: !b.dryRun,
            },
          },
        };
      }
      return undefined;
    });
    renderAt(
      '/h/timetable',
      <Route path="/h/timetable" element={<TimetablePage />} />,
      makeMe('HEADMASTER'),
    );
    await screen.findByRole('button', { name: /Choose the timetable file/ });
    const file = new File(['Class,Day,8:00-8:40\nB7A,Monday,Maths\n'], 'timetable.csv', {
      type: 'text/csv',
    });
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

    const start = await screen.findByLabelText('Start time, row 1');
    expect(start).toHaveValue('08:00');
    await userEvent.clear(start);
    await userEvent.type(start, '07:30');

    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Mathematics · Kofi Boateng/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save timetable' }));
    expect(await screen.findByText(/1 weekly lessons saved/)).toBeInTheDocument();
    const saved = calls.find(
      (c) => c.path === '/timetable/import' && !(c.body as { dryRun: boolean }).dryRun,
    );
    expect(saved?.body).toMatchObject({
      termId: 't1',
      rows: [
        { className: 'B7A', subject: 'Maths', weekday: 1, startTime: '07:30', endTime: '08:40' },
      ],
    });
    expect(within(document.body).queryByLabelText('Start time, row 1')).toBeNull();
  });
});

describe('editing a saved slot', () => {
  it('changes the day and times of a slot', async () => {
    const entry = {
      id: 'e1',
      weekday: 1,
      startTime: '08:00',
      endTime: '08:40',
      validFrom: '2099-09-07',
      validTo: '2099-12-11',
      assignment: {
        id: 'a1',
        termId: 't1',
        subject: { id: 's1', name: 'Mathematics' },
        schoolClass: { id: 'c1', name: 'B7A', level: 'BASIC_7' },
        teacher: { id: 'p1', fullName: 'Kofi Boateng' },
      },
    };
    const calls = mockApi((method, path) => {
      if (path === '/terms') return { status: 200, body: { data: [term] } };
      if (path === '/classes')
        return {
          status: 200,
          body: { data: [{ id: 'c1', level: 'BASIC_7', name: 'B7A', isActive: true }] },
        };
      if (path.startsWith('/timetable-entries?')) return { status: 200, body: { data: [entry] } };
      if (path.startsWith('/assignments')) return { status: 200, body: { data: [] } };
      if (method === 'PATCH' && path === '/timetable-entries/e1')
        return { status: 200, body: { data: entry } };
      return undefined;
    });
    renderAt(
      '/h/timetable',
      <Route path="/h/timetable" element={<TimetablePage />} />,
      makeMe('HEADMASTER'),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit Mathematics on Monday at 08:00' }),
    );
    const dialog = await screen.findByRole('dialog');
    const end = within(dialog).getByLabelText('End');
    await userEvent.clear(end);
    await userEvent.type(end, '09:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        weekday: 1,
        startTime: '08:00',
        endTime: '09:00',
      }),
    );
  });
});
