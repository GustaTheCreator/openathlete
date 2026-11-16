import type { Request, Response } from 'express';
import { sign } from 'jsonwebtoken';

import { AuthCookieService } from './auth-cookie.service';

const key = 'test-only-cookie-signing-key-not-for-deployment';
function setup() {
  const service = new AuthCookieService({
    get: (name: string) =>
      name === 'APP_URL' ? 'https://training.example.org' : undefined,
    getOrThrow: () => key,
  } as never);
  const res = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response;
  const req = (headers: Record<string, string>) => ({ headers }) as Request;
  const tokens = {
    accessToken: 'test-access',
    refreshToken: sign({ tokenType: 'refresh' }, key, { expiresIn: '1h' }),
  };
  return { service, res, req, tokens };
}

describe('browser session cookie boundary', () => {
  it('returns only the access token to browsers, with a secure host-only HttpOnly refresh cookie', () => {
    const { service, res, req, tokens } = setup();
    expect(
      service.respond(
        tokens,
        req({
          'x-auth-mode': 'cookie',
          origin: 'https://training.example.org',
        }),
        res,
      ),
    ).toEqual({ accessToken: tokens.accessToken });
    expect(res.cookie).toHaveBeenCalledWith(
      '__Host-oa_refresh',
      tokens.refreshToken,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        path: '/',
        sameSite: 'lax',
      }),
    );
    const options = (res.cookie as jest.Mock).mock.calls[0][2];
    expect(options).not.toHaveProperty('domain');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('preserves the native JSON bearer contract', () => {
    const { service, res, req, tokens } = setup();
    expect(service.respond(tokens, req({}), res)).toEqual(tokens);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('requires the configured origin and matching CSRF token for cookie refresh/logout', () => {
    const { service, req } = setup();
    const headers = {
      origin: 'https://training.example.org',
      cookie: '__Host-oa_csrf=test-csrf',
      'x-csrf-token': 'test-csrf',
    };
    expect(() => service.assertCsrf(req(headers))).not.toThrow();
    expect(() =>
      service.assertCsrf(
        req({ ...headers, origin: 'https://attacker.example.org' }),
      ),
    ).toThrow();
    expect(() =>
      service.assertCsrf(req({ ...headers, 'x-csrf-token': 'wrong' })),
    ).toThrow();
    expect(() => service.assertCsrf(req({ ...headers, origin: '' }))).toThrow();
  });

  it('rejects duplicate or malformed CSRF cookies and untrusted login origins', () => {
    const { service, req } = setup();
    expect(() =>
      service.assertCsrf(
        req({
          origin: 'https://training.example.org',
          cookie: '__Host-oa_csrf=a; __Host-oa_csrf=b',
          'x-csrf-token': 'a',
        }),
      ),
    ).toThrow();
    expect(() =>
      service.assertCsrf(
        req({
          origin: 'https://training.example.org',
          cookie: '__Host-oa_csrf=%zz',
          'x-csrf-token': '%zz',
        }),
      ),
    ).toThrow();
    expect(() =>
      service.assertLogin(
        req({
          origin: 'https://attacker.example.org',
          'x-auth-mode': 'cookie',
        }),
      ),
    ).toThrow();
  });

  it('treats cookie-bearing requests as browser requests even without the mode header', () => {
    const { service, req } = setup();
    expect(
      service.isBrowser(req({ cookie: '__Host-oa_refresh=test-refresh' })),
    ).toBe(true);
  });

  it('clears both cookies with the original scope on logout', () => {
    const { service, res } = setup();
    service.clear(res);
    expect(res.clearCookie).toHaveBeenCalledWith(
      '__Host-oa_refresh',
      expect.objectContaining({ secure: true, path: '/', httpOnly: true }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      '__Host-oa_csrf',
      expect.objectContaining({ secure: true, path: '/', httpOnly: false }),
    );
  });
});
