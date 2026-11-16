import { routes } from '@/utils/axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FirebaseLoginDto,
  LoginDto,
  OidcExchangeDto,
} from '@openathlete/shared';

import { AuthAPI as AuthClient } from './auth.api';

const mocks = vi.hoisted(() => ({
  native: false,
  post: vi.fn(),
}));

vi.mock('@/utils/axios', async (importActual) => ({
  ...(await importActual<typeof import('@/utils/axios')>()),
  default: { post: mocks.post, get: vi.fn() },
}));
vi.mock('@/utils/capacitor', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
  isCapacitor: () => mocks.native,
}));

const loginBody: LoginDto = {
  email: 'coach@example.invalid',
  password: 'Stage-Smoke-Only-9274!',
};
const firebaseBody: FirebaseLoginDto = { idToken: 'firebase-id-token' };
const oidcBody: OidcExchangeDto = {
  code: '00000000-0000-4000-8000-000000000001',
};

const detachedMethods = [
  {
    route: routes.auth.login,
    body: loginBody,
    invoke: () => {
      const mutationFn = AuthClient.login;
      return mutationFn(loginBody);
    },
  },
  {
    route: routes.auth.firebaseLogin,
    body: firebaseBody,
    invoke: () => {
      const mutationFn = AuthClient.loginWithFirebase;
      return mutationFn(firebaseBody);
    },
  },
  {
    route: routes.auth.oidcExchange,
    body: oidcBody,
    invoke: () => {
      const mutationFn = AuthClient.exchangeOidcCode;
      return mutationFn(oidcBody);
    },
  },
];

describe('AuthAPI detached mutation functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.native = false;
    mocks.post.mockResolvedValue({ data: { accessToken: 'access-token' } });
  });

  it('uses cookie mode for detached browser login methods', async () => {
    for (const [index, method] of detachedMethods.entries()) {
      await method.invoke();
      expect(mocks.post).toHaveBeenNthCalledWith(
        index + 1,
        method.route,
        method.body,
        {
          withCredentials: true,
          headers: { 'X-Auth-Mode': 'cookie' },
        },
      );
    }
  });

  it('preserves the native JSON login contract for detached methods', async () => {
    mocks.native = true;

    for (const [index, method] of detachedMethods.entries()) {
      await method.invoke();
      expect(mocks.post).toHaveBeenNthCalledWith(
        index + 1,
        method.route,
        method.body,
        undefined,
      );
    }
  });
});
