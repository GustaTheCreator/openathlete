import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getFirebaseIdTokenForProvider,
  revokeAppleSignIn,
} from './firebase-auth';

const native = vi.hoisted(() => ({
  isCapacitor: vi.fn(() => true),
  isIOS: vi.fn(() => true),
}));
const plugin = vi.hoisted(() => ({
  signInWithApple: vi.fn(),
  signInWithGoogle: vi.fn(),
  getIdToken: vi.fn(),
  getCurrentUser: vi.fn(),
  revokeAccessToken: vi.fn(),
}));
const firebaseSdk = vi.hoisted(() => ({
  app: { name: 'firebase-app' },
  auth: { name: 'firebase-auth' },
  inMemoryPersistence: { type: 'memory' },
  browserPopupRedirectResolver: { type: 'popup-resolver' },
  initializeApp: vi.fn(() => ({ name: 'firebase-app' })),
  initializeAuth: vi.fn(() => ({ name: 'firebase-auth' })),
  signInWithPopup: vi.fn(async () => ({
    user: { getIdToken: async () => 'web-firebase-id-token' },
  })),
}));

vi.mock('@/utils/capacitor', () => native);
vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: plugin,
}));
vi.mock('firebase/app', () => ({ initializeApp: firebaseSdk.initializeApp }));
vi.mock('firebase/auth', () => ({
  browserPopupRedirectResolver: firebaseSdk.browserPopupRedirectResolver,
  inMemoryPersistence: firebaseSdk.inMemoryPersistence,
  initializeAuth: firebaseSdk.initializeAuth,
  signInWithPopup: firebaseSdk.signInWithPopup,
  GoogleAuthProvider: class {
    addScope = vi.fn();
  },
  OAuthProvider: class {
    addScope = vi.fn();
  },
}));

describe('getFirebaseIdTokenForProvider in the native apps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin.getIdToken.mockResolvedValue({ token: 'firebase-id-token' });
  });

  it('signs in with Apple natively', async () => {
    await expect(getFirebaseIdTokenForProvider('apple')).resolves.toBe(
      'firebase-id-token',
    );
    expect(plugin.signInWithApple).toHaveBeenCalledOnce();
    expect(plugin.signInWithGoogle).not.toHaveBeenCalled();
  });

  it('signs in with Google natively', async () => {
    await getFirebaseIdTokenForProvider('google');
    expect(plugin.signInWithGoogle).toHaveBeenCalledOnce();
    expect(plugin.signInWithApple).not.toHaveBeenCalled();
  });
});

describe('getFirebaseIdTokenForProvider on web', () => {
  it('initializes Firebase Auth with in-memory persistence before the popup', async () => {
    native.isCapacitor.mockReturnValue(false);
    firebaseSdk.initializeApp.mockReturnValue(firebaseSdk.app);
    firebaseSdk.initializeAuth.mockReturnValue(firebaseSdk.auth);
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'api-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'auth.example.test');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'project');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'app-id');

    await expect(getFirebaseIdTokenForProvider('google')).resolves.toBe(
      'web-firebase-id-token',
    );

    expect(firebaseSdk.initializeAuth).toHaveBeenCalledWith(
      firebaseSdk.app,
      expect.objectContaining({
        persistence: firebaseSdk.inMemoryPersistence,
        popupRedirectResolver: firebaseSdk.browserPopupRedirectResolver,
      }),
    );
    expect(firebaseSdk.initializeAuth.mock.invocationCallOrder[0]).toBeLessThan(
      firebaseSdk.signInWithPopup.mock.invocationCallOrder[0],
    );
  });
});

describe('revokeAppleSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.isIOS.mockReturnValue(true);
  });

  it('revokes with a fresh authorization code for an Apple account', async () => {
    plugin.getCurrentUser.mockResolvedValue({
      user: { providerData: [{ providerId: 'apple.com' }] },
    });
    plugin.signInWithApple.mockResolvedValue({
      credential: { authorizationCode: 'auth-code' },
    });

    await revokeAppleSignIn();

    expect(plugin.revokeAccessToken).toHaveBeenCalledWith({
      token: 'auth-code',
    });
  });

  it('leaves Google and email accounts alone', async () => {
    plugin.getCurrentUser.mockResolvedValue({
      user: { providerData: [{ providerId: 'google.com' }] },
    });

    await revokeAppleSignIn();

    expect(plugin.signInWithApple).not.toHaveBeenCalled();
    expect(plugin.revokeAccessToken).not.toHaveBeenCalled();
  });

  it('does nothing outside iOS', async () => {
    native.isIOS.mockReturnValue(false);

    await revokeAppleSignIn();

    expect(plugin.getCurrentUser).not.toHaveBeenCalled();
  });
});
