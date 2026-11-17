// @vitest-environment jsdom
import { waitUntil } from '@/utils/test/wait-until';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateAccountView } from './create-account-view';

const state = vi.hoisted(() => ({ signup: 'open' }));
const api = vi.hoisted(() => ({
  createAccount: vi.fn(),
  login: vi.fn(),
  verifyInvitation: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/api/user/user.api', () => ({
  UserAPI: { createAccount: api.createAccount },
}));
vi.mock('@/api/auth/auth.api', () => ({
  AuthAPI: {
    login: api.login,
    verifyInvitation: api.verifyInvitation,
  },
}));
vi.mock('@/api/instance', () => ({
  useInstanceInfoQuery: () => ({
    data: { signup: state.signup, personalEmails: false },
  }),
}));
vi.mock('sonner', () => ({ toast: { error: api.toastError } }));
vi.mock('@/contexts/auth', () => ({
  useAuthContext: () => ({ initialize: vi.fn() }),
}));
vi.mock('posthog-js/react', () => ({ usePostHog: () => undefined }));
vi.mock('@/views/auth/oauth-buttons', () => ({
  OAuthButtons: ({ redirectTo }: { redirectTo?: string }) => (
    <div data-testid="oauth-provider" data-redirect-to={redirectTo}>
      provider login
    </div>
  ),
}));
vi.mock('@/paraglide/runtime', () => ({ getLocale: () => 'es' }));
vi.mock('@/paraglide/messages', () => ({
  m: new Proxy({}, { get: (_target, key) => () => String(key) }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => undefined;

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data: {} },
  });

function LocationOutput() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname}</output>;
}

describe('CreateAccountView', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    state.signup = 'open';
    api.verifyInvitation.mockResolvedValue({ valid: false });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  });

  const renderAt = async (entry = '/auth/create-account') => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[entry]}>
            <CreateAccountView />
            <LocationOutput />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  };

  const fillAndSubmit = async ({ includeEmail = true } = {}) => {
    await act(async () => {
      for (const [name, value] of Object.entries({
        firstName: 'Ana',
        lastName: 'Runner',
        ...(includeEmail ? { email: 'ana@example.test' } : {}),
        password: 'long enough password',
      })) {
        const input = container.querySelector<HTMLInputElement>(
          `input[name="${name}"]`,
        )!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
  };

  const submitAndWaitForFailure = async () => {
    await fillAndSubmit();
    await waitUntil(() => expect(api.toastError).toHaveBeenCalled());
  };

  it('says when the email already has an account', async () => {
    await renderAt();
    api.createAccount.mockRejectedValue(httpError(409));
    await submitAndWaitForFailure();
    expect(api.createAccount.mock.calls[0][0]).toMatchObject({
      email: 'ana@example.test',
    });
    expect(api.toastError).toHaveBeenCalledWith('signup_email_exists');
    expect(api.login).not.toHaveBeenCalled();
  });

  it('signs up in the language the app is shown in', async () => {
    await renderAt();
    api.createAccount.mockRejectedValue(httpError(500));
    await submitAndWaitForFailure();
    expect(api.createAccount.mock.calls[0][0]).toMatchObject({
      language: 'ES',
    });
  });

  it('reports other sign-up failures', async () => {
    await renderAt();
    api.createAccount.mockRejectedValue(httpError(500));
    await submitAndWaitForFailure();
    expect(api.toastError).toHaveBeenCalledWith('signup_failed');
  });

  it('reports a failed sign-in after the account is created', async () => {
    await renderAt();
    api.createAccount.mockResolvedValue({ userId: 1 });
    api.login.mockRejectedValue(httpError(500));
    await fillAndSubmit();
    await waitUntil(() => expect(api.login).toHaveBeenCalled());
    expect(api.toastError).toHaveBeenCalledWith('signup_login_failed');
  });

  it('requires password signup for an open invitation and submits explicit acceptance', async () => {
    state.signup = 'invite';
    api.verifyInvitation.mockResolvedValue({
      valid: true,
      kind: 'COACH',
      purpose: 'COLLEAGUE',
      email: null,
    });
    await renderAt('/auth/create-account?coach-invitation=coach-open-token');
    await waitUntil(() =>
      expect(container.textContent).toContain(
        'invitation_provider_signup_unavailable',
      ),
    );
    expect(
      container.querySelector('[data-testid="oauth-provider"]'),
    ).toBeNull();

    const checkbox = container.querySelector('[role="checkbox"]');
    expect(checkbox).not.toBeNull();
    await act(async () =>
      checkbox!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    api.createAccount.mockResolvedValue({ userId: 8 });
    api.login.mockResolvedValue({ accessToken: 'session-token' });
    await fillAndSubmit();
    await waitUntil(() => expect(api.createAccount).toHaveBeenCalled());

    expect(api.createAccount.mock.calls[0][0]).toMatchObject({
      coachInvitationToken: 'coach-open-token',
      acceptInvitation: true,
    });
    expect(api.createAccount.mock.calls[0][0].invitationToken).toBeUndefined();
  });

  it('does not keep a spent non-roster preview as signup return target', async () => {
    state.signup = 'invite';
    api.verifyInvitation.mockResolvedValue({
      valid: true,
      kind: 'ATHLETE',
      email: 'ana@example.test',
    });
    api.createAccount.mockResolvedValue({ userId: 9 });
    api.login.mockResolvedValue({ accessToken: 'session-token' });
    sessionStorage.setItem('openathlete-return-to', '/auth/invitation');
    await renderAt('/auth/create-account?invitation=bound-athlete-token');
    await waitUntil(() => expect(api.verifyInvitation).toHaveBeenCalled());
    await fillAndSubmit({ includeEmail: false });
    await waitUntil(() => expect(api.login).toHaveBeenCalled());

    expect(api.createAccount.mock.calls[0][0]).toMatchObject({
      invitationToken: 'bound-athlete-token',
    });
    expect(sessionStorage.getItem('openathlete-return-to')).toBeNull();
    await waitUntil(() =>
      expect(
        container.querySelector('[data-testid="route"]')?.textContent,
      ).toBe('/dashboard/onboarding'),
    );
  });

  it('routes a SHARE invitation signup to received invitations after onboarding', async () => {
    state.signup = 'invite';
    api.verifyInvitation.mockResolvedValue({
      valid: true,
      kind: 'COACH',
      purpose: 'SHARE',
      email: 'new-coach@example.test',
    });
    api.createAccount.mockResolvedValue({ userId: 10 });
    api.login.mockResolvedValue({ accessToken: 'session-token' });
    await renderAt('/auth/create-account?coach-invitation=roster-token');
    await waitUntil(() => expect(api.verifyInvitation).toHaveBeenCalled());
    await fillAndSubmit({ includeEmail: false });
    await waitUntil(() => expect(api.login).toHaveBeenCalled());

    expect(api.createAccount.mock.calls[0][0]).toMatchObject({
      coachInvitationToken: 'roster-token',
    });
    expect(sessionStorage.getItem('openathlete-return-to')).toBe(
      '/dashboard/settings?tab=invitations',
    );
  });
});
