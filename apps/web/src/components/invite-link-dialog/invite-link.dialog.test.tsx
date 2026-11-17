// @vitest-environment jsdom
import { InviteAthleteDialog } from '@/components/invite-athlete-dialog/invite-athlete.dialog';
import { waitUntil } from '@/utils/test/wait-until';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InvitationLinkPanel } from './invite-link.dialog';

const api = vi.hoisted(() => ({ createInvitationLink: vi.fn() }));
vi.mock('@/api/athlete', () => ({
  AthleteAPI: { createInvitationLink: api.createInvitationLink },
}));
vi.mock('@/paraglide/messages', () => ({
  m: new Proxy({}, { get: (_, key) => () => String(key) }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('InvitationLinkPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    api.createInvitationLink.mockReset().mockResolvedValue({
      url: 'https://app.example.test/auth/invitation?token=secret',
      expiresAt: '2026-11-18T00:00:00.000Z',
    });
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

  it('creates one purpose-bound link on open and copies it without sending email', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const renderPanel = async () => {
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <InvitationLinkPanel kind="COACH" purpose="COLLEAGUE" />
          </QueryClientProvider>,
        ),
      );
    };

    await renderPanel();
    await waitUntil(() =>
      expect(container.querySelector('input')?.value).toBe(
        'https://app.example.test/auth/invitation?token=secret',
      ),
    );
    await renderPanel();

    expect(api.createInvitationLink).toHaveBeenCalledTimes(1);
    expect(api.createInvitationLink).toHaveBeenCalledWith({
      kind: 'COACH',
      purpose: 'COLLEAGUE',
    });
    expect(container.querySelector('input')?.readOnly).toBe(true);
    expect(container.querySelector('input')?.value).toBe(
      'https://app.example.test/auth/invitation?token=secret',
    );

    const copy = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('copy_link'),
    );
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith(
      'https://app.example.test/auth/invitation?token=secret',
    );
    expect(container.textContent).toContain('link_copied');
    expect(api.createInvitationLink.mock.calls[0][0]).not.toHaveProperty(
      'email',
    );
  });

  it('copies from the email form without submitting the email invitation', async () => {
    const onInvite = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <InviteAthleteDialog open onClose={vi.fn()} onInvite={onInvite} />
        </QueryClientProvider>,
      ),
    );

    await waitUntil(() =>
      expect(
        document.body.querySelector<HTMLInputElement>('#invitation-link-url')
          ?.value,
      ).toBe('https://app.example.test/auth/invitation?token=secret'),
    );
    const email = document.body.querySelector<HTMLInputElement>('#email')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(email, 'athlete@example.test');
      email.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const copy = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('copy_link'),
    );
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith(
      'https://app.example.test/auth/invitation?token=secret',
    );
    expect(onInvite).not.toHaveBeenCalled();
  });

  it('shows link creation errors and retries on explicit action', async () => {
    api.createInvitationLink
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        url: 'https://app.example.test/auth/invitation?token=retry',
        expiresAt: '2026-11-18T00:00:00.000Z',
      });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <InvitationLinkPanel kind="ATHLETE" />
        </QueryClientProvider>,
      ),
    );

    await waitUntil(() =>
      expect(document.body.textContent).toContain('invitation_link_failed'),
    );
    const retry = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('retry'),
    );
    await act(async () => retry?.click());
    await waitUntil(() =>
      expect(
        document.body.querySelector<HTMLInputElement>('#invitation-link-url')
          ?.value,
      ).toBe('https://app.example.test/auth/invitation?token=retry'),
    );
    expect(api.createInvitationLink).toHaveBeenCalledTimes(2);
  });
});
