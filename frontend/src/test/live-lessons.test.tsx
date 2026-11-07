import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../app/AppShell';
import { api } from '../lib/api';
import { makeMe, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

/** How often the teacher's lessons were loaded. */
let loads = 0;

/** A page that shows how often the teacher's lessons were loaded. */
function TodayLessons() {
  const q = useQuery({
    queryKey: ['lessons', 'today'],
    queryFn: async () => {
      await api.get<{ data: unknown[] }>('/lessons/today');
      loads += 1;
      return loads;
    },
  });
  return <p>{q.isSuccess ? `loaded ${q.data}` : 'loading'}</p>;
}

describe('a teacher’s open page', () => {
  it('reloads the lessons when told they changed, and pops up lesson reminders', async () => {
    const encoder = new TextEncoder();
    let push: (text: string) => void = () => {};
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '');
      if (path === '/notifications/stream') {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (text) => controller.enqueue(encoder.encode(text));
            push('event: ready\ndata: {}\n\n');
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      const json = path === '/notifications/unread-count' ? { data: { count: 0 } } : { data: [] };
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    loads = 0;
    renderAt(
      '/t',
      <Route path="/t" element={<AppShell area="teacher" />}>
        <Route index element={<TodayLessons />} />
      </Route>,
      makeMe('TEACHER'),
    );
    expect(await screen.findByText('loaded 1')).toBeInTheDocument();

    // The headmaster added a slot: the list reloads by itself.
    push('event: lessons-changed\ndata: {}\n\n');
    expect(await screen.findByText('loaded 2')).toBeInTheDocument();

    // Ten minutes before a lesson: a pop-up that opens the lesson.
    push(
      `event: notification\ndata: ${JSON.stringify({
        title: 'Mathematics, FORM 1 at 08:00',
        body: 'Starts in 10 minutes. Record it once the lesson has started.',
        recordId: null,
        lessonId: 'l1',
      })}\n\n`,
    );
    expect(await screen.findByText('Mathematics, FORM 1 at 08:00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the lesson' })).toHaveAttribute(
      'href',
      '/t/lessons/l1/record',
    );
  });
});
