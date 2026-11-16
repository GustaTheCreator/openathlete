import type { Request, Response } from 'express';
import { verify } from 'jsonwebtoken';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiEnvSchemaType, AuthResponseDto } from '@openathlete/shared';

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService<ApiEnvSchemaType, true>) {}

  private get origin(): string {
    return new URL(
      this.config.get('APP_URL') ||
        this.config.get('FRONTEND_URL') ||
        'http://localhost:5173',
    ).origin;
  }

  private get secure(): boolean {
    return this.origin.startsWith('https:');
  }
  private get prefix(): string {
    return this.secure ? '__Host-' : '';
  }

  private cookie(req: Request, name: string): string | undefined {
    const parts = (req.headers.cookie || '').split(';');
    const matches = parts.filter((part) => part.trim().startsWith(`${name}=`));
    if (matches.length !== 1) return undefined;
    try {
      return decodeURIComponent(matches[0].trim().slice(name.length + 1));
    } catch {
      return undefined;
    }
  }

  isBrowser(req: Request): boolean {
    return (
      req.headers['x-auth-mode'] === 'cookie' || Boolean(this.refreshToken(req))
    );
  }

  assertOrigin(req: Request): void {
    if (req.headers.origin !== this.origin)
      throw new ForbiddenException('Untrusted session origin');
  }

  assertLogin(req: Request): void {
    if (this.isBrowser(req)) this.assertOrigin(req);
  }

  assertCsrf(req: Request): void {
    this.assertOrigin(req);
    const value = this.cookie(req, `${this.prefix}oa_csrf`);
    const header = req.headers['x-csrf-token'];
    if (
      !value ||
      typeof header !== 'string' ||
      value.length > 256 ||
      header.length > 256
    )
      throw new ForbiddenException('Invalid CSRF token');
    const expected = Buffer.from(value);
    const actual = Buffer.from(header);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new ForbiddenException('Invalid CSRF token');
  }

  refreshToken(req: Request): string | undefined {
    return this.cookie(req, `${this.prefix}oa_refresh`);
  }

  respond(
    tokens: AuthResponseDto,
    req: Request,
    res: Response,
  ): AuthResponseDto {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.isBrowser(req)) return tokens;
    this.assertOrigin(req);
    if (!tokens.refreshToken) throw new UnauthorizedException();
    const payload = verify(
      tokens.refreshToken,
      this.config.getOrThrow('JWT_SECRET_KEY'),
      { algorithms: ['HS256'] },
    );
    if (!payload.exp) throw new UnauthorizedException();
    const options = {
      secure: this.secure,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: Math.max(0, payload.exp * 1000 - Date.now()),
    };
    res.cookie(`${this.prefix}oa_refresh`, tokens.refreshToken, {
      ...options,
      httpOnly: true,
    });
    res.cookie(`${this.prefix}oa_csrf`, randomBytes(32).toString('hex'), {
      ...options,
      httpOnly: false,
    });
    return { accessToken: tokens.accessToken };
  }

  clear(res: Response): void {
    const options = {
      secure: this.secure,
      sameSite: 'lax' as const,
      path: '/',
    };
    res.clearCookie(`${this.prefix}oa_refresh`, { ...options, httpOnly: true });
    res.clearCookie(`${this.prefix}oa_csrf`, { ...options, httpOnly: false });
    res.setHeader('Cache-Control', 'no-store');
  }
}
