const STORAGE_KEY = 'openathlete-pending-invitation-token';
const SIGNUP_ALLOWED_KEY = 'openathlete-invitation-signup-allowed';

let memoryToken: string | null = null;
let memorySignupAllowed = false;

/** Capture only invitation URLs, before analytics initialization can observe them. */
export function captureInvitationTokenFromLocation() {
  const url = new URL(window.location.href);
  const isInvitationPreview = url.pathname === '/auth/invitation';
  const isAccountCreation = url.pathname === '/auth/create-account';
  if (!isInvitationPreview && !isAccountCreation) return;

  const param = isInvitationPreview
    ? 'token'
    : ['invitation', 'coach-invitation'].find((name) =>
        url.searchParams.has(name),
      );
  if (!param) return;

  const token = url.searchParams.get(param);
  if (!token) return;
  memoryToken = token;
  if (isAccountCreation) memorySignupAllowed = true;

  let persisted = false;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
    if (isAccountCreation) {
      window.sessionStorage.setItem(SIGNUP_ALLOWED_KEY, 'true');
    }
    persisted = true;
  } catch {
    // Keep the token in memory and leave the URL intact if storage is blocked.
  }

  if (persisted) {
    url.searchParams.delete(param);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
}

export function getPendingInvitationToken() {
  if (memoryToken) return memoryToken;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function hasInvitationTokenInLocation() {
  const url = new URL(window.location.href);
  return (
    (url.pathname === '/auth/invitation' && url.searchParams.has('token')) ||
    (url.pathname === '/auth/create-account' &&
      (url.searchParams.has('invitation') ||
        url.searchParams.has('coach-invitation')))
  );
}

/** Explicitly allow an account-creation page reached from the preview to use its token. */
export function allowInvitationTokenForSignup() {
  memorySignupAllowed = true;
  try {
    window.sessionStorage.setItem(SIGNUP_ALLOWED_KEY, 'true');
  } catch {
    // The permission remains available for this in-memory app session.
  }
}

export function takeInvitationTokenForSignup() {
  let allowed = memorySignupAllowed;
  memorySignupAllowed = false;
  try {
    allowed =
      allowed || window.sessionStorage.getItem(SIGNUP_ALLOWED_KEY) === 'true';
    window.sessionStorage.removeItem(SIGNUP_ALLOWED_KEY);
  } catch {
    // Use the in-memory permission when storage is unavailable.
  }
  return allowed ? getPendingInvitationToken() : null;
}

export function clearPendingInvitationToken() {
  memoryToken = null;
  memorySignupAllowed = false;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(SIGNUP_ALLOWED_KEY);
  } catch {
    // Storage can be unavailable in private mode.
  }
}
