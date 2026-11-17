// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT_TYPE, type Event } from '@openathlete/shared';

import { athleteKeys } from '../athlete/athlete.keys';
import { EventAPI } from './event.api';
import { useCreateEventMutation } from './event.hooks';
import { eventKeys } from './event.keys';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const event = (
  eventId: number,
  athleteId: number,
  startDate: Date,
  endDate: Date,
) =>
  ({
    eventId,
    athleteId,
    type: EVENT_TYPE.NOTE,
    name: `Event ${eventId}`,
    description: 'Test event',
    startDate,
    endDate,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }) as Event;

const key = (athleteId: number | undefined, startDate: Date, endDate: Date) =>
  [eventKeys.getMyEvents, true, athleteId, startDate, endDate] as const;

describe('useCreateEventMutation cache scope', () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  let createEvent: ReturnType<typeof useCreateEventMutation>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(EventAPI, 'createEvent');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  const renderMutation = async () => {
    function Probe() {
      createEvent = useCreateEventMutation();
      return null;
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
  };

  it('adds only overlapping events to matching athlete caches and moves corrected server dates', async () => {
    const februaryStart = new Date('2026-02-01T00:00:00.000Z');
    const februaryEnd = new Date('2026-02-28T23:59:59.999Z');
    const marchStart = new Date('2026-03-01T00:00:00.000Z');
    const marchEnd = new Date('2026-03-31T23:59:59.999Z');
    const target = key(1, februaryStart, februaryEnd);
    const wrongAthlete = key(2, februaryStart, februaryEnd);
    const disjoint = key(1, marchStart, marchEnd);
    const correctedTarget = key(2, marchStart, marchEnd);
    const ownCalendar = [
      eventKeys.getMyEvents,
      undefined,
      undefined,
      februaryStart,
      februaryEnd,
    ] as const;
    queryClient.setQueryData([athleteKeys.getMyAthlete], { athleteId: 99 });
    [target, wrongAthlete, disjoint, correctedTarget, ownCalendar].forEach(
      (queryKey) => queryClient.setQueryData<Event[]>(queryKey, []),
    );
    let resolveCreate!: (value: Event) => void;
    vi.mocked(EventAPI.createEvent).mockImplementation(
      () => new Promise((resolve) => (resolveCreate = resolve)),
    );
    await renderMutation();

    let result!: Promise<Event>;
    await act(async () => {
      result = createEvent.mutateAsync({
        type: EVENT_TYPE.NOTE,
        athleteId: 1,
        name: 'Draft',
        description: 'Draft',
        startDate: new Date('2026-01-31T12:00:00.000Z'),
        endDate: new Date('2026-02-02T12:00:00.000Z'),
      });
      await vi.waitFor(() =>
        expect(queryClient.getQueryData<Event[]>(target)).toHaveLength(1),
      );
    });

    expect(queryClient.getQueryData<Event[]>(wrongAthlete)).toEqual([]);
    expect(queryClient.getQueryData<Event[]>(disjoint)).toEqual([]);
    expect(queryClient.getQueryData<Event[]>(ownCalendar)).toEqual([]);

    const corrected = event(
      99,
      2,
      new Date('2026-03-10T10:00:00.000Z'),
      new Date('2026-03-10T11:00:00.000Z'),
    );
    await act(async () => {
      resolveCreate(corrected);
      await result;
    });

    expect(queryClient.getQueryData<Event[]>(target)).toEqual([]);
    expect(queryClient.getQueryData<Event[]>(correctedTarget)).toEqual([
      corrected,
    ]);
    expect(queryClient.getQueryData<Event[]>(ownCalendar)).toEqual([]);
  });

  it('restores every cache unchanged when create fails', async () => {
    const start = new Date('2026-02-01T00:00:00.000Z');
    const end = new Date('2026-02-28T23:59:59.999Z');
    const target = key(1, start, end);
    const existing = event(10, 1, start, end);
    queryClient.setQueryData<Event[]>(target, [existing]);
    vi.mocked(EventAPI.createEvent).mockRejectedValue(new Error('failed'));
    await renderMutation();

    await act(async () => {
      await expect(
        createEvent.mutateAsync({
          type: EVENT_TYPE.NOTE,
          athleteId: 1,
          name: 'Draft',
          description: 'Draft',
          startDate: start,
          endDate: end,
        }),
      ).rejects.toThrow('failed');
    });

    expect(queryClient.getQueryData<Event[]>(target)).toEqual([existing]);
  });
});
