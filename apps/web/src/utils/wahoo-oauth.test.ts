import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeWahooLogin, rememberWahooLogin } from './oauth';

describe('Wahoo OAuth login', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts only the matching login, once', () => {
    rememberWahooLogin({ state: 'nonce', codeVerifier: 'verifier' });
    expect(consumeWahooLogin('nonce')).toBe('verifier');
    expect(consumeWahooLogin('nonce')).toBeNull();
  });

  it('rejects a missing or mismatched state without consuming another login', () => {
    for (const state of [null, 'wrong']) {
      rememberWahooLogin({ state: 'nonce', codeVerifier: 'verifier' });
      expect(consumeWahooLogin(state)).toBeNull();
      expect(consumeWahooLogin('nonce')).toBe('verifier');
    }
  });

  it('keeps concurrent logins separate', () => {
    rememberWahooLogin({ state: 'one', codeVerifier: 'first' });
    rememberWahooLogin({ state: 'two', codeVerifier: 'second' });
    expect(consumeWahooLogin('one')).toBe('first');
    expect(consumeWahooLogin('two')).toBe('second');
  });

  it('rejects an expired login', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    rememberWahooLogin({ state: 'nonce', codeVerifier: 'verifier' });
    clock.mockReturnValue(600_000);
    expect(consumeWahooLogin('nonce')).toBeNull();
    clock.mockRestore();
  });

  it('refuses to start a login without both PKCE and state', () => {
    expect(() => rememberWahooLogin({ state: 'nonce' })).toThrow();
    expect(consumeWahooLogin('nonce')).toBeNull();
  });
});
