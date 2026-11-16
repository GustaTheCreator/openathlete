// @vitest-environment jsdom
import { waitUntil } from '@/utils/test/wait-until';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingView } from './onboarding-view';

const mocks = vi.hoisted(() => ({
  user: {
    roles: ['ATHLETE'],
    language: 'EN',
    onboardingCompleted: false,
    userId: 1,
  },
  coaches: [] as unknown[],
  complete: vi.fn(),
}));

vi.mock('@/api/user', () => ({
  useCompleteOnboardingMutation: () => ({
    mutate: mocks.complete,
    isPending: false,
    isSuccess: false,
  }),
  useGetMeQuery: () => ({ data: mocks.user, isLoading: false }),
  useRecordSignupAttributionMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/api/athlete', () => ({
  useGetMyCoachesQuery: () => ({ data: mocks.coaches }),
}));
vi.mock('@/components/connectors', () => ({
  ConnectorsList: ({ onSkip }: { onSkip: () => void }) => (
    <button onClick={onSkip}>skip-connectors</button>
  ),
}));
vi.mock('@/components/language-switcher', () => ({
  LanguageSwitcher: () => null,
}));
vi.mock('@/contexts/auth', () => ({
  useAuthContext: () => ({ authenticated: true, initialize: vi.fn() }),
}));
vi.mock('@/paraglide/messages', () => ({
  m: new Proxy({}, { get: (_target, key) => () => String(key) }),
}));
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('posthog-js/react', () => ({ usePostHog: () => undefined }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('OnboardingView role permissions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.user = {
      roles: ['ATHLETE'],
      language: 'EN',
      onboardingCompleted: false,
      userId: 1,
    };
    mocks.coaches = [];
    localStorage.setItem(
      'openathlete_onboarding_data',
      JSON.stringify({
        roles: ['ATHLETE', 'COACH'],
        coachEmail: 'coach@example.test',
        athleteEmails: ['athlete@example.test'],
      }),
    );
    localStorage.setItem('openathlete_onboarding_step', '1');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <OnboardingView />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  const clickButtonContaining = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(text),
    );
    if (!button)
      throw new Error(
        `Button containing "${text}" not found. Rendered: ${container.textContent}`,
      );
    await act(async () => button.click());
  };

  it('only offers server-granted roles and strips stale invitations from completion', async () => {
    expect(container.textContent).toContain('onboarding_role_athlete');
    expect(container.textContent).not.toContain('onboarding_role_coach');

    await clickButtonContaining('onboarding_next');
    await waitUntil(() =>
      container.textContent?.includes('onboarding_athlete_info_title'),
    );
    expect(container.querySelector('#coach-email')).toBeNull();
    expect(container.querySelector('#athlete-emails')).toBeNull();

    await clickButtonContaining('onboarding_next');
    await waitUntil(() =>
      container.textContent?.includes('onboarding_connectors_title'),
    );
    await clickButtonContaining('skip-connectors');
    await waitUntil(() =>
      container.textContent?.includes('onboarding_acquisition_title'),
    );
    await clickButtonContaining('onboarding_next');
    await waitUntil(() =>
      container.textContent?.includes('onboarding_complete_title'),
    );
    await clickButtonContaining('onboarding_complete_continue');

    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: ['ATHLETE'],
        coachEmail: undefined,
        athleteEmails: undefined,
      }),
    );
  });

  it('shows athlete invitations only when the server grants coach access', async () => {
    await act(async () => root.unmount());
    mocks.user = {
      roles: ['COACH'],
      language: 'EN',
      onboardingCompleted: false,
      userId: 1,
    };
    localStorage.setItem(
      'openathlete_onboarding_data',
      JSON.stringify({ roles: ['COACH'], athleteEmails: [] }),
    );
    root = createRoot(container);
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <OnboardingView />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );

    await clickButtonContaining('onboarding_next');
    await waitUntil(() =>
      container.textContent?.includes('onboarding_athlete_invitations_title'),
    );
    expect(container.querySelector('#athlete-emails')).not.toBeNull();
  });
});
