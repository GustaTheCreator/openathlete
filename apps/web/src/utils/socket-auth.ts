import type { Socket } from 'socket.io-client';

import { getAccessToken, isValidToken, refreshToken } from './auth';

const EXPIRY_CHECK_INTERVAL = 60 * 1000;

export type SocketAuthentication = {
  /** Reconnects with a fresh token when the one of the handshake expired. */
  reconnectIfExpired: () => void;
  stop: () => void;
};

/**
 * The API authenticates every socket event with the token of the handshake,
 * which stays the same for the whole connection: a token refreshed later only
 * reaches the server when the socket reconnects. This hands each connection a
 * fresh token and reconnects once it expires, so a tab or the app left open
 * keeps its real-time updates.
 */
export function keepSocketAuthenticated(socket: Socket): SocketAuthentication {
  let handshakeToken: string | null = null;
  let active = true;
  let refreshInFlight: Promise<void> | null = null;

  socket.auth = (send) => {
    void getAccessToken()
      .catch(() => null)
      .then((info) => {
        handshakeToken = info?.accessToken ?? null;
        send({ token: handshakeToken ?? '' });
      });
  };

  const reconnectIfExpired = () => {
    if (
      active &&
      socket.connected &&
      handshakeToken &&
      !isValidToken(handshakeToken)
    ) {
      socket.disconnect().connect();
    }
  };

  // The server can detect expiry before the device's clock. Event refusals
  // and server disconnects share one refresh so simultaneous signals cannot
  // race or reconnect with the same expired token.
  const refreshAndReconnect = () => {
    if (!active || refreshInFlight) return;

    refreshInFlight = refreshToken(true)
      .catch(() => null)
      .then((info) => {
        if (!active || !info || info.accessToken === handshakeToken) return;
        if (socket.connected) {
          socket.disconnect().connect();
        } else {
          socket.connect();
        }
      })
      .finally(() => {
        refreshInFlight = null;
      });
  };

  const onException = (error: { message?: unknown }) => {
    if (
      !active ||
      typeof error?.message !== 'string' ||
      !error.message.includes('jwt expired')
    ) {
      return;
    }
    refreshAndReconnect();
  };

  const onDisconnect = (reason: string) => {
    if (reason === 'io server disconnect') refreshAndReconnect();
  };

  socket.on('exception', onException);
  socket.on('disconnect', onDisconnect);

  const interval = setInterval(reconnectIfExpired, EXPIRY_CHECK_INTERVAL);

  return {
    reconnectIfExpired,
    stop: () => {
      active = false;
      clearInterval(interval);
      socket.off('exception', onException);
      socket.off('disconnect', onDisconnect);
    },
  };
}
