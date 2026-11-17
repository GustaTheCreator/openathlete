// @vitest-environment jsdom
import { waitUntil } from '@/utils/test/wait-until';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from './admin';

const state = vi.hoisted(() => ({ roles: ['SUPER_ADMIN'] as string[] }));
const api = vi.hoisted(() => ({
  getUsers: vi.fn(),
  updateUserRoles: vi.fn(),
  getCoachAthletes: vi.fn(),
  createCoachAthlete: vi.fn(),
  deleteCoachAthlete: vi.fn(),
  getInvitations: vi.fn(),
  createInvitation: vi.fn(),
  deleteInvitation: vi.fn(),
}));

vi.mock('@/api/admin', () => ({ AdminAPI: api }));
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));
vi.mock('@/contexts/auth', () => ({
  useUserRoles: () => state.roles,
  useAuthContext: () => ({ user: { userId: 7 } }),
}));
vi.mock('@/paraglide/messages', () => ({
  m: new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('AdminPage access and safe data', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    const router = createMemoryRouter(
      [
        { path: '/dashboard/admin', element: <AdminPage /> },
        { path: '/403', element: <p>forbidden</p> },
      ],
      { initialEntries: ['/dashboard/admin'] },
    );
    await act(async () =>
      root.render(
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <RouterProvider router={router} />
        </QueryClientProvider>,
      ),
    );
    return router;
  };

  beforeEach(() => {
    state.roles = ['SUPER_ADMIN'];
    api.getUsers.mockReset().mockResolvedValue({
      users: [
        {
          userId: 1,
          email: 'athlete@example.test',
          firstName: 'Ari',
          lastName: 'Athlete',
          roles: ['ATHLETE'],
          onboardingCompleted: true,
          athleteId: 42,
        },
      ],
      total: 1,
    });
    api.getCoachAthletes
      .mockReset()
      .mockResolvedValue({ associations: [], total: 0 });
    api.getInvitations
      .mockReset()
      .mockResolvedValue({ invitations: [], total: 0 });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('denies non-admin navigation without querying admin data', async () => {
    state.roles = ['ATHLETE'];
    await render();
    await waitUntil(() => container.textContent?.includes('forbidden'));
    expect(api.getUsers).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
  });

  it('shows role and relationship management from safe response fields', async () => {
    await render();
    await waitUntil(() =>
      container.textContent?.includes('athlete@example.test'),
    );
    expect(container.querySelector('#admin-user-search')).not.toBeNull();
    expect(container.querySelector('#coach-user-id')).not.toBeNull();
    expect(container.querySelector('#invitation-email')).not.toBeNull();
    expect(container.textContent).not.toMatch(/token|copy url/i);
  });

  it('requires an explicit personal or colleague purpose for coach invitations', async () => {
    await render();
    await waitUntil(() => container.querySelector('#invitation-kind'));

    const kind =
      container.querySelector<HTMLSelectElement>('#invitation-kind')!;
    await act(async () => {
      kind.value = 'COACH';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const purpose = container.querySelector<HTMLSelectElement>(
      '#coach-invitation-purpose',
    );
    expect(purpose).not.toBeNull();
    expect(container.textContent).toContain(
      'invitation_purpose_personal_description',
    );

    await act(async () => {
      purpose!.value = 'COLLEAGUE';
      purpose!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const owner =
      container.querySelector<HTMLInputElement>('#invitation-owner')!;
    const email =
      container.querySelector<HTMLInputElement>('#invitation-email')!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setValue.call(owner, '7');
      owner.dispatchEvent(new Event('input', { bubbles: true }));
      setValue.call(email, 'new-coach@example.test');
      email.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = email.closest('form')!;
    await act(async () =>
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );

    expect(api.createInvitation).toHaveBeenCalledWith({
      kind: 'COACH',
      ownerUserId: 7,
      email: 'new-coach@example.test',
      purpose: 'COLLEAGUE',
    });
  });
});
