import { describe, expect, it } from 'vitest';
import { parseSse } from '../lib/sse';

describe('parseSse', () => {
  it('reads complete events and keeps the unfinished tail for the next chunk', () => {
    const first = parseSse('event: ready\ndata: {}\n\nevent: notification\ndata: {"tit');
    expect(first.events).toEqual([{ event: 'ready', data: '{}' }]);

    const second = parseSse(first.rest + 'le":"New record"}\n\n');
    expect(second.events).toEqual([{ event: 'notification', data: '{"title":"New record"}' }]);
    expect(second.rest).toBe('');
  });

  it('skips heartbeat comments and handles Windows line endings', () => {
    const { events } = parseSse(': ping\n\nevent: session-ended\r\ndata: {}\r\n\r\n');
    expect(events).toEqual([{ event: 'session-ended', data: '{}' }]);
  });
});
