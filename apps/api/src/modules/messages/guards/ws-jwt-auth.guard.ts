import type { JwtPayload } from 'jsonwebtoken';
import { Socket } from 'socket.io';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  JwtService,
  type JwtVerifyOptions,
  TokenExpiredError,
} from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';

import { AuthUser } from 'src/modules/auth/decorators/user.decorator';
import { AuthService } from 'src/modules/auth/services';

@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const token = this.extractTokenFromHandshake(client);

    if (!token) throw new WsException('Unauthorized');

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        algorithms: ['HS256'],
      } as unknown as JwtVerifyOptions);
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        this.logger.debug('WebSocket authentication failed: token expired');
        throw new WsException('Unauthorized: jwt expired');
      }
      throw new WsException('Unauthorized');
    }

    try {
      const user: AuthUser = await this.authService.validateUser(payload);
      if (!user.authSessionId || typeof payload.exp !== 'number') {
        throw new WsException('Unauthorized');
      }
      client.data.user = user;
      await client.join(`auth-session:${user.authSessionId}`);
      await client.join(`auth-user:${user.userId}`);

      if (!client.data.authExpiryTimer) {
        const millisecondsUntilExpiry = Math.max(
          0,
          payload.exp * 1000 - Date.now(),
        );
        client.data.authExpiryTimer = setTimeout(() => {
          client.disconnect(true);
        }, millisecondsUntilExpiry);
      }
      return true;
    } catch {
      throw new WsException('Unauthorized');
    }
  }

  private extractTokenFromHandshake(client: Socket): string | null {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);

    const token = client.handshake.auth?.token;
    return typeof token === 'string' ? token : null;
  }
}
