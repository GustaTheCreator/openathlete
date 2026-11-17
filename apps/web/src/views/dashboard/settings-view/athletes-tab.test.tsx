// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AthletesTab } from './athletes-tab';

const state = vi.hoisted(() => ({
  roles: ['ATHLETE', 'COACH'] as string[],
  inviteRoster: vi.fn(),
}));
vi.mock('@/api/athlete', () => ({
  useGetMyCoachedAthletesQuery: () => ({
    data: [
      {
        athleteId: 101,
        user: { firstName: 'Ada', lastName: 'One', email: 'ada@example.test' },
      },
      {
        athleteId: 202,
        user: { firstName: 'Bea', lastName: 'Two', email: 'bea@example.test' },
      },
    ],
    isPending: false,
  }),
  useGetSentAthleteInvitationsQuery: () => ({ data: [], isLoading: false }),
  useRemoveAthleteMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useInviteAthleteMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelAthleteInvitationMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('@/api/coach', () => ({
  useInviteRosterMutation: () => ({
    mutate: state.inviteRoster,
    isPending: false,
  }),
}));
vi.mock('@/contexts/auth', () => ({ useUserRoles: () => state.roles }));
vi.mock('@/hooks/use-feature-access', () => ({
  useAthleteLimit: () => ({ maxAthletes: 100 }),
}));
vi.mock('@/components/activity-alert-settings', () => ({
  ActivityAlertSettings: () => null,
}));
vi.mock('@/components/messages/activity-alert-settings', () => ({
  ActivityAlertSettings: () => null,
}));
vi.mock('@/components/confirm-action', () => ({ ConfirmAction: () => null }));
vi.mock('@/components/invite-athlete-dialog/invite-athlete.dialog', () => ({
  InviteAthleteDialog: () => null,
}));
vi.mock('@/components/paywall', () => ({ PaywallDialog: () => null }));
vi.mock('@/paraglide/messages', () => ({
  m: new Proxy(
    {},
    {
      get:
        (_, key) =>
        (...args: unknown[]) =>
          `${String(key)}${args.length ? JSON.stringify(args[0]) : ''}`,
    },
  ),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('AthletesTab roster invitations', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    state.roles = ['ATHLETE', 'COACH'];
    state.inviteRoster.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([
    ['SHARE', 'invitation_operation_share'],
    ['TRANSFER', 'invitation_operation_transfer'],
  ] as const)(
    'submits selected athlete IDs for %s',
    async (operation, actionLabel) => {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <AthletesTab />
          </MemoryRouter>,
        ),
      );

      const boxes = [...container.querySelectorAll('[role="checkbox"]')];
      expect(boxes).toHaveLength(2);
      await act(async () => {
        boxes[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        boxes[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const action = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes(actionLabel),
      );
      await act(async () => action?.click());

      const input = document.body.querySelector<HTMLInputElement>(
        '#roster-invite-email',
      );
      expect(input).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, 'new-coach@example.test');
        input!.dispatchEvent(new Event('input', { bubbles: true }));
        input!.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const submit = [...document.body.querySelectorAll('button')].find(
        (button) => button.textContent?.includes('send_invitation'),
      );
      await act(async () => submit?.click());

      expect(state.inviteRoster).toHaveBeenCalledWith({
        email: 'new-coach@example.test',
        operation,
        athleteIds: [101, 202],
      });
    },
  );
});
