// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  allowInvitationTokenForSignup,
  captureInvitationTokenFromLocation,
  clearPendingInvitationToken,
  getPendingInvitationToken,
  hasInvitationTokenInLocation,
  takeInvitationTokenForSignup,
} from './invitation-token';

describe('invitation token URL handling', () => {
  afterEach(() => {
    clearPendingInvitationToken();
    history.replaceState(null, '', '/');
  });

  it('captures only invitation preview tokens and removes them from that URL', () => {
    history.replaceState(null, '', '/auth/invitation?token=secret&keep=1');

    captureInvitationTokenFromLocation();

    expect(getPendingInvitationToken()).toBe('secret');
    expect(location.pathname + location.search).toBe('/auth/invitation?keep=1');
    expect(hasInvitationTokenInLocation()).toBe(false);
    expect(takeInvitationTokenForSignup()).toBeNull();
  });

  it('allows a create-account token once, then prevents reuse in an unrelated signup', () => {
    history.replaceState(
      null,
      '',
      '/auth/create-account?coach-invitation=secret',
    );

    captureInvitationTokenFromLocation();

    expect(location.search).toBe('');
    expect(takeInvitationTokenForSignup()).toBe('secret');
    expect(takeInvitationTokenForSignup()).toBeNull();
  });

  it('does not capture or remove unrelated password reset or OAuth tokens', () => {
    history.replaceState(null, '', '/auth/password-reset?token=reset-secret');
    captureInvitationTokenFromLocation();
    expect(location.search).toBe('?token=reset-secret');
    expect(getPendingInvitationToken()).toBeNull();

    history.replaceState(null, '', '/auth/callback/google?token=oauth-secret');
    captureInvitationTokenFromLocation();
    expect(location.search).toBe('?token=oauth-secret');
    expect(getPendingInvitationToken()).toBeNull();
  });

  it('requires an explicit preview-to-signup transition for a stored token', () => {
    history.replaceState(null, '', '/auth/invitation?token=secret');
    captureInvitationTokenFromLocation();
    history.replaceState(null, '', '/auth/create-account');

    expect(takeInvitationTokenForSignup()).toBeNull();
    allowInvitationTokenForSignup();
    expect(takeInvitationTokenForSignup()).toBe('secret');
  });
});
