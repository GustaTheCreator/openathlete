// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { FormProvider, useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT_TYPE, SPORT_TYPE } from '@openathlete/shared';

import { SportChips } from './training-fields';

vi.mock('@/paraglide/messages', () => ({
  m: new Proxy({}, { get: (_target, key) => () => String(key) }),
}));

vi.mock('@/components/sport-icon/sport-icon', () => ({
  SportIcon: () => null,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ sport }: { sport: SPORT_TYPE }) {
  const form = useForm({
    defaultValues: { type: EVENT_TYPE.TRAINING, sport },
  });

  return (
    <FormProvider {...form}>
      <SportChips />
    </FormProvider>
  );
}

describe('SportChips', () => {
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

  const render = (sport = SPORT_TYPE.CYCLING) =>
    act(() => root.render(<Harness sport={sport} />));

  it('offers only the six selected sports, in the requested order', () => {
    render();

    expect(
      [...container.querySelectorAll('[data-sport-chip]')].map((button) =>
        button.getAttribute('data-sport-chip'),
      ),
    ).toEqual([
      SPORT_TYPE.CYCLING,
      SPORT_TYPE.RUNNING,
      SPORT_TYPE.STRENGTH,
      SPORT_TYPE.WALK,
      SPORT_TYPE.SWIMMING,
      SPORT_TYPE.MOBILITY,
    ]);
    expect(
      container.querySelector('[aria-label="composer_other_sport"]'),
    ).toBeNull();
  });

  it('keeps a legacy sport visible and selected when editing', () => {
    render(SPORT_TYPE.GRAVEL_RIDE);

    const selected = container.querySelector(
      `[data-sport-chip="${SPORT_TYPE.GRAVEL_RIDE}"]`,
    );
    expect(selected).not.toBeNull();
    expect(selected?.getAttribute('aria-checked')).toBe('true');
  });
});
