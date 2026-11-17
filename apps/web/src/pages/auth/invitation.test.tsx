// @vitest-environment jsdom
import { SpaceSwitcher } from '@/components/sidebar/space-switcher';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AuthConsumer, AuthProvider, useUserRoles } from '@/contexts/auth';
import { SpaceProvider } from '@/contexts/space';
import { ACCESS_TOKEN } from '@/utils/local-storage';
import { waitUntil } from '@/utils/test/wait-until';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InvitationPage from './invitation';

const api = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  verifyInvitation: vi.fn(),
  getMe: vi.fn(),
  updateAccount: vi.fn(),
}));
vi.mock('@/api/auth/auth.api', () => ({ AuthAPI: api }));
vi.mock('@/api/user/user.api', () => ({
  UserAPI: { getMe: api.getMe, updateAccount: api.updateAccount },
}));
vi.mock('@/utils/push-notifications', () => ({
  initializePushNotifications: () => Promise.resolve(),
  sendPendingTokenIfAny: () => undefined,
}));
vi.mock('posthog-js', () => ({
  default: { identify: vi.fn(), capture: vi.fn(), reset: vi.fn() },
}));
vi.mock('@/paraglide/messages', () => ({
  m: new Proxy(
    {
      my_training: () => 'My training',
      my_athletes: () => 'My athletes',
      spaces: () => 'Spaces',
    },
    {
      get: (target, key) =>
        target[key as keyof typeof target] ?? (() => String(key)),
    },
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function DashboardRoles() {
  const roles = useUserRoles();
  return (
    <SpaceProvider>
      <SidebarProvider>
        <output data-testid="roles">{roles?.join(',')}</output>
        <SpaceSwitcher />
      </SidebarProvider>
    </SpaceProvider>
  );
}

describe('invitation acceptance role refresh', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let router: ReturnType<typeof createMemoryRouter>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ACCESS_TOKEN, 'session');
    api.acceptInvitation.mockReset().mockResolvedValue({ success: true });
    api.verifyInvitation.mockReset().mockResolvedValue({
      valid: true,
      kind: 'COACH',
      purpose: 'PERSONAL',
      email: null,
      inviterName: 'Coach',
      expiresAt: '2026-11-18T00:00:00.000Z',
    });
    let loadCount = 0;
    api.getMe.mockReset().mockImplementation(async () => {
      loadCount += 1;
      return {
        userId: 42,
        language: 'en',
        timeZone: 'UTC',
        roles: loadCount === 1 ? ['ATHLETE'] : ['ATHLETE', 'COACH'],
      };
    });
    api.updateAccount.mockReset().mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    router = createMemoryRouter(
      [
        { path: '/auth/invitation', element: <InvitationPage /> },
        { path: '/dashboard', element: <DashboardRoles /> },
      ],
      { initialEntries: ['/auth/invitation?token=secret'] },
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it('refreshes the real AuthContext before showing the newly granted coaching area', async () => {
    await act(async () =>
      root.render(
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <AuthConsumer>
              <RouterProvider router={router} />
            </AuthConsumer>
          </QueryClientProvider>
        </AuthProvider>,
      ),
    );

    const accept = await waitForButton('invitation_accept');
    await act(async () => accept.click());

    await waitUntil(() =>
      expect(
        container.querySelector('[data-testid="roles"]')?.textContent,
      ).toBe('ATHLETE,COACH'),
    );
    expect(api.getMe).toHaveBeenCalledTimes(2);

    const switcher = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('My training'),
    );
    expect(switcher).toBeDefined();
    await act(async () =>
      switcher?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      ),
    );
    await waitUntil(() =>
      expect(document.body.textContent).toContain('My athletes'),
    );
  });

  it('returns an existing-account login to the preview without putting its token in returnTo', async () => {
    localStorage.removeItem(ACCESS_TOKEN);
    api.getMe.mockRejectedValue(new Error('401'));
    await act(async () =>
      root.render(
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <AuthConsumer>
              <RouterProvider router={router} />
            </AuthConsumer>
          </QueryClientProvider>
        </AuthProvider>,
      ),
    );

    await waitUntil(() =>
      expect(
        [...container.querySelectorAll('a')].some((link) =>
          link.textContent?.includes('invitation_preview_sign_in'),
        ),
      ).toBe(true),
    );
    const loginLink = [...container.querySelectorAll('a')].find((link) =>
      link.textContent?.includes('invitation_preview_sign_in'),
    )!;
    const loginUrl = new URL(loginLink.href);

    expect(loginUrl.pathname).toBe('/auth/login');
    expect(loginUrl.searchParams.get('returnTo')).toBe('/auth/invitation');
    expect(loginUrl.href).not.toContain('secret');
  });
});

async function waitForButton(label: string) {
  let button: HTMLButtonElement | undefined;
  await waitUntil(() => {
    button = [...document.querySelectorAll('button')].find((item) =>
      item.textContent?.includes(label),
    );
    expect(button).toBeDefined();
  });
  return button!;
}
