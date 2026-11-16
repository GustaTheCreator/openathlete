import { MessagesGateway } from './messages.gateway';

describe('MessagesGateway session revocation', () => {
  const gateway = new MessagesGateway({} as never, {} as never, {} as never);

  it('disconnects sockets in a revoked session room across adapters', () => {
    const disconnectSockets = jest.fn();
    const inRoom = jest.fn().mockReturnValue({ disconnectSockets });
    gateway.server = { in: inRoom } as never;

    gateway.disconnectRevokedSession({ sessionId: 'session-7' });

    expect(inRoom).toHaveBeenCalledWith('auth-session:session-7');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('disconnects every socket for a user after password reset', () => {
    const disconnectSockets = jest.fn();
    const inRoom = jest.fn().mockReturnValue({ disconnectSockets });
    gateway.server = { in: inRoom } as never;

    gateway.disconnectRevokedUserSessions({ userId: 7 });

    expect(inRoom).toHaveBeenCalledWith('auth-user:7');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('clears the token-expiry timer when a socket disconnects', () => {
    jest.useFakeTimers();
    try {
      const timer = setTimeout(() => undefined, 60_000);
      const data: Record<string, unknown> = { authExpiryTimer: timer };
      const client = { id: 'socket-7', data } as never;

      gateway.handleDisconnect(client);

      expect(jest.getTimerCount()).toBe(0);
      expect(data.authExpiryTimer).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
