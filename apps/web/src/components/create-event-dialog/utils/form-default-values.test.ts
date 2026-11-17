import { describe, expect, it } from 'vitest';

import {
  type CreateEventDto,
  EVENT_TYPE,
  type Event,
  SPORT_TYPE,
} from '@openathlete/shared';

import type { EventFormInput } from './event-form-schemas';
import { getFormDefaultValues } from './form-default-values';

function selectedSport(values: EventFormInput | undefined) {
  return values && 'sport' in values ? values.sport : undefined;
}

describe('getFormDefaultValues sports', () => {
  it.each([EVENT_TYPE.TRAINING, EVENT_TYPE.COMPETITION, EVENT_TYPE.ACTIVITY])(
    'defaults a new %s to cycling',
    (type) => {
      const date = new Date('2026-11-17T12:00:00Z');

      expect(selectedSport(getFormDefaultValues({ type, date }, date))).toBe(
        SPORT_TYPE.CYCLING,
      );
    },
  );

  it('preserves a legacy sport when editing an existing event', () => {
    const event = {
      type: EVENT_TYPE.TRAINING,
      sport: SPORT_TYPE.GRAVEL_RIDE,
    } as Event;

    expect(selectedSport(getFormDefaultValues({ event }))).toBe(
      SPORT_TYPE.GRAVEL_RIDE,
    );
  });

  it('preserves a prefilled sport when creating from existing event data', () => {
    const date = new Date('2026-11-17T12:00:00Z');
    const prefilledData: CreateEventDto = {
      type: EVENT_TYPE.TRAINING,
      name: 'Existing training',
      description: '',
      sport: SPORT_TYPE.TRAIL_RUNNING,
      startDate: date,
      endDate: date,
    };

    expect(
      selectedSport(
        getFormDefaultValues(
          { type: EVENT_TYPE.TRAINING, date, prefilledData },
          date,
        ),
      ),
    ).toBe(SPORT_TYPE.TRAIL_RUNNING);
  });
});
