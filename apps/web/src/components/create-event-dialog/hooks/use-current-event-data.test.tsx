// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type CreateEventDto,
  EVENT_TYPE,
  SPORT_TYPE,
} from '@openathlete/shared';

import type { EventFormInput } from '../utils/event-form-schemas';
import { useCurrentEventData } from './use-current-event-data';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ onData }: { onData: (data: CreateEventDto) => void }) {
  const watch = () =>
    ({
      type: EVENT_TYPE.TRAINING,
      name: '',
      description: '',
      startDate: new Date('2026-11-17T12:00:00Z'),
      endDate: new Date('2026-11-17T13:00:00Z'),
      sport: undefined,
    }) as unknown as EventFormInput;
  const { currentEventData } = useCurrentEventData(
    { type: EVENT_TYPE.TRAINING },
    watch as never,
    [],
    1,
  );

  useEffect(() => onData(currentEventData), [currentEventData, onData]);
  return null;
}

describe('useCurrentEventData', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uses cycling while the current form has no sport yet', () => {
    let current: CreateEventDto | undefined;

    act(() =>
      root.render(
        <Harness
          onData={(data) => {
            current = data;
          }}
        />,
      ),
    );

    expect(current).toMatchObject({
      type: EVENT_TYPE.TRAINING,
      sport: SPORT_TYPE.CYCLING,
    });
  });
});
