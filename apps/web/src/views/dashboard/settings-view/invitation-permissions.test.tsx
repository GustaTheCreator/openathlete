// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoachesTab } from './coaches-tab';
import { InvitationsTab } from './invitations-tab';

const state = vi.hoisted(() => ({
  roles: ['ATHLETE'] as string[],
  enabled: [] as boolean[],
  sentEnabled: false,
}));
const mocks = vi.hoisted(() => ({
  coaches: vi.fn(),
  coachSent: vi.fn(),
  athletePending: vi.fn(),
  coachPending: vi.fn(),
  noOp: vi.fn(),
}));

vi.mock('@/api/athlete', () => ({
  useGetMyCoachesQuery: () => ({
    data: [
      {
        userId: 3,
        firstName: 'Existing',
        lastName: 'Coach',
        email: 'coach@example.test',
      },
    ],
    isPending: false,
  }),
  useGetSentCoachInvitationsQuery: (options: { enabled: boolean }) => {
    state.sentEnabled = options.enabled;
    return {
      data: options.enabled
        ? [
            {
              coachInvitationId: 9,
              email: 'pending@example.test',
              createdAt: '2026-11-17',
              purpose: 'PERSONAL',
              athleteNames: [],
            },
          ]
        : undefined,
      isLoading: false,
    };
  },
  useCancelCoachInvitationMutation: () => ({
    mutate: mocks.noOp,
    isPending: false,
  }),
  useRemoveCoachMutation: () => ({ mutate: mocks.noOp, isPending: false }),
  useGetPendingInvitationsQuery: (options: { enabled: boolean }) => {
    state.enabled.push(options.enabled);
    return {
      data: [
        {
          athleteInvitationId: 1,
          user: {
            firstName: 'Coach',
            lastName: 'Inviter',
            email: 'coach-inviter@example.test',
          },
        },
      ],
      isLoading: false,
    };
  },
  useAcceptInvitationMutation: () => ({ mutate: mocks.noOp, isPending: false }),
  useRejectInvitationMutation: () => ({ mutate: mocks.noOp, isPending: false }),
}));
vi.mock('@/api/coach', () => ({
  useGetPendingInvitationsQuery: (options: { enabled: boolean }) => {
    state.enabled.push(options.enabled);
    return {
      data: [
        {
          coachInvitationId: 2,
          purpose: 'PERSONAL',
          athleteIds: [],
          athleteNames: [],
          athleteUser: {
            firstName: 'Athlete',
            lastName: 'Inviter',
            email: 'athlete-inviter@example.test',
          },
        },
      ],
      isLoading: false,
    };
  },
  useAcceptInvitationMutation: () => ({ mutate: mocks.noOp, isPending: false }),
  useRejectInvitationMutation: () => ({ mutate: mocks.noOp, isPending: false }),
}));
vi.mock('@/contexts/auth', () => ({
  useUserRoles: () => state.roles,
  useAuthContext: () => ({ initialize: mocks.noOp }),
}));
vi.mock('@/components/invite-coach-dialog/invite-coach.dialog', () => ({
  InviteCoachDialog: () => <div>invite-coach-dialog</div>,
}));
vi.mock('@/components/confirm-action', () => ({ ConfirmAction: () => null }));
vi.mock('@/paraglide/messages', () => ({
  m: new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('invitation role permissions', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (element: React.ReactNode) => {
    await act(async () => root.render(element));
  };

  beforeEach(() => {
    state.roles = ['ATHLETE'];
    state.enabled = [];
    state.sentEnabled = false;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps received invitations visible and actionable to an athlete-only invitee', async () => {
    await render(<InvitationsTab />);
    expect(state.enabled).toEqual([true, true]);
    expect(container.textContent).toContain('coach-inviter@example.test');
    expect(container.textContent).toContain('athlete-inviter@example.test');
    expect(
      [...container.querySelectorAll('button')].map(
        (button) => button.textContent,
      ),
    ).toContain('accept');
    expect(
      [...container.querySelectorAll('button')].map(
        (button) => button.textContent,
      ),
    ).toContain('reject');
  });

  it('hides coach invitation issuance for athlete-only users but preserves removals', async () => {
    await render(<CoachesTab />);
    expect(state.sentEnabled).toBe(false);
    expect(container.textContent).not.toContain('invite_a_coach');
    expect(container.textContent).toContain('Existing Coach');
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('allows a dual-role athlete to invite their own coach', async () => {
    state.roles = ['ATHLETE', 'COACH'];
    await render(<CoachesTab />);
    expect(state.sentEnabled).toBe(true);
    expect(container.textContent).toContain('invite_a_coach');
  });
});
