import { JwtPayload, sign, verify } from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  ApiEnvSchemaType,
  AuthResponseDto,
  CreateAccountDto,
  FirebaseLoginDto,
  LoginDto,
} from '@openathlete/shared';

import { PrismaService } from 'src/modules/prisma/services/prisma.service';

import { AuthUser } from '../decorators/user.decorator';
import { FirebaseAuthService } from './firebase-auth.service';
import { UserService } from './user.service';

function deriveNames(params: { name?: string; email: string }): {
  firstName: string;
  lastName: string;
} {
  const safeName = (params.name || '').trim();
  if (safeName) {
    const parts = safeName.split(/\s+/g).filter(Boolean);
    if (parts.length === 1) {
      return { firstName: parts[0]!, lastName: '' };
    }
    return {
      firstName: parts[0]!,
      lastName: parts.slice(1).join(' '),
    };
  }

  const emailLocalPart = params.email.split('@')[0] || 'Athlete';
  return { firstName: emailLocalPart, lastName: '' };
}

/** Who a sign-in provider says the user is */
export type ProviderIdentity = {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  invitationToken?: string;
  coachInvitationToken?: string;
  language?: CreateAccountDto['language'];
};

export type AuthTokenPair = Required<AuthResponseDto>;
const SESSION_AUDIENCE = 'openathlete:session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private userService: UserService,
    private readonly configService: ConfigService<ApiEnvSchemaType, true>,
    private readonly firebaseAuthService: FirebaseAuthService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  private get issuer(): string {
    return (
      this.configService.get('APP_URL') ||
      this.configService.get('FRONTEND_URL') ||
      'http://localhost:5173'
    );
  }

  private createToken(
    user: { userId: number; email: string; sessionVersion: number },
    sessionId: string,
    tokenType: 'access' | 'refresh',
    expiresAt: Date,
  ): string {
    return sign(
      { ...user, sessionId, tokenType, jti: randomUUID() },
      this.configService.getOrThrow('JWT_SECRET_KEY'),
      {
        expiresIn:
          tokenType === 'refresh'
            ? Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
            : Math.min(
                15 * 60,
                Math.max(
                  1,
                  Math.floor((expiresAt.getTime() - Date.now()) / 1000),
                ),
              ),
        algorithm: 'HS256',
        issuer: this.issuer,
        audience: SESSION_AUDIENCE,
      },
    );
  }

  async login(credentials: LoginDto): Promise<AuthTokenPair> {
    const { email, password } = credentials;
    const user = await this.prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
      },
      select: {
        userId: true,
        password: true,
        email: true,
        sessionVersion: true,
      },
    });
    if (!user?.password) throw new UnauthorizedException();

    await this.userService.comparePasswords(
      {
        pass_hash: user.password,
        pass_string: password,
      },
      { email },
    );

    return this.sessionFor(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokenPair> {
    let payload: JwtPayload;
    try {
      payload = verify(
        refreshToken,
        this.configService.getOrThrow('JWT_SECRET_KEY'),
        {
          algorithms: ['HS256'],
          issuer: this.issuer,
          audience: SESSION_AUDIENCE,
        },
      );
    } catch {
      throw new UnauthorizedException();
    }
    this.assertClaims(payload, 'refresh');
    const user = await this.prisma.user.findFirst({
      where: {
        userId: payload.userId,
      },
      select: {
        userId: true,
        email: true,
        sessionVersion: true,
      },
    });
    if (
      !user ||
      user.email !== payload.email ||
      user.sessionVersion !== payload.sessionVersion
    )
      throw new UnauthorizedException();
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId! },
    });
    if (
      !session ||
      session.userId !== user.userId ||
      session.expiresAt <= new Date()
    )
      throw new UnauthorizedException();
    const tokens = {
      accessToken: this.createToken(
        user,
        session.id,
        'access',
        session.expiresAt,
      ),
      refreshToken: this.createToken(
        user,
        session.id,
        'refresh',
        session.expiresAt,
      ),
    };
    const rotated = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        userId: user.userId,
        refreshTokenHash: tokenHash(refreshToken),
        expiresAt: { gt: new Date() },
      },
      data: { refreshTokenHash: tokenHash(tokens.refreshToken) },
    });
    if (rotated.count !== 1) {
      // Reuse of a spent credential revokes the device's whole token family.
      await this.revokeSession(user.userId, session.id);
      throw new UnauthorizedException();
    }
    return tokens;
  }

  async loginWithFirebase(body: FirebaseLoginDto): Promise<AuthTokenPair> {
    const verified = await this.firebaseAuthService.verifyIdToken(body.idToken);
    const user = await this.providerAccount({
      email: verified.email,
      name: verified.name,
      invitationToken: body.invitationToken,
      coachInvitationToken: body.coachInvitationToken,
      language: body.language,
    });
    return this.sessionFor(user);
  }

  /**
   * The account of an address a provider vouched for (Google,
   * Apple, an OpenID Connect provider), creating it on first sign-in within
   * the instance's sign-up mode.
   */
  async providerAccount(
    identity: ProviderIdentity,
  ): Promise<{ userId: number; email: string }> {
    const email = identity.email.toLowerCase();

    let user = await this.prisma.user.findFirst({
      where: { email },
      select: { userId: true, email: true },
    });

    if (!user) {
      const derived = deriveNames({ name: identity.name, email });
      const firstName = identity.firstName?.trim() || derived.firstName;
      const lastName = identity.lastName?.trim() || derived.lastName;

      // Create a strong random password (OAuth users won't use it directly).
      const randomPassword = randomUUID();
      try {
        const created = await this.userService.createAccount(
          {
            email,
            password: randomPassword,
            firstName,
            lastName,
            invitationToken: identity.invitationToken,
            coachInvitationToken: identity.coachInvitationToken,
            language: identity.language,
          },
          { emailFromProvider: true },
        );
        user = { userId: created.userId, email };
      } catch (error) {
        // A concurrent sign-in for the same account created it first
        if (!(error instanceof ConflictException)) throw error;
        user = await this.prisma.user.findFirst({
          where: { email },
          select: { userId: true, email: true },
        });
        if (!user) throw error;
      }
    }

    return user;
  }

  /** The web app's session tokens for a user */
  async sessionFor(user: {
    userId: number;
    email: string;
    sessionVersion?: number;
  }): Promise<AuthTokenPair> {
    const current =
      user.sessionVersion === undefined
        ? await this.prisma.user.findUnique({
            where: { userId: user.userId },
            select: { sessionVersion: true },
          })
        : user;
    if (!current || current.sessionVersion === undefined)
      throw new UnauthorizedException();
    const identity = {
      userId: user.userId,
      email: user.email,
      sessionVersion: current.sessionVersion,
    };
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_MS);
    const tokens = {
      accessToken: this.createToken(identity, sessionId, 'access', expiresAt),
      refreshToken: this.createToken(identity, sessionId, 'refresh', expiresAt),
    };
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.userId,
        refreshTokenHash: tokenHash(tokens.refreshToken),
        expiresAt,
      },
    });
    return tokens;
  }

  async revokeSession(userId: number, sessionId: string): Promise<void> {
    await this.prisma.authSession.deleteMany({
      where: { id: sessionId, userId },
    });
    this.events?.emit('auth.session.revoked', { userId, sessionId });
  }

  private assertClaims(
    payload: JwtPayload,
    tokenType: 'access' | 'refresh',
  ): void {
    if (
      payload.tokenType !== tokenType ||
      !Number.isInteger(payload.userId) ||
      payload.userId <= 0 ||
      !payload.email ||
      !payload.sessionId ||
      !Number.isInteger(payload.sessionVersion) ||
      payload.iss !== this.issuer ||
      payload.aud !== SESSION_AUDIENCE ||
      !payload.exp ||
      payload.exp * 1000 <= Date.now()
    ) {
      throw new UnauthorizedException();
    }
  }

  async validateUser(payload: JwtPayload): Promise<AuthUser> {
    this.assertClaims(payload, 'access');
    const user = await this.prisma.user.findUnique({
      where: {
        email: payload.email,
      },
      select: {
        userId: true,
        email: true,
        sessionVersion: true,
        roles: true,
        athlete: {
          select: {
            athleteId: true,
          },
        },
        coachAthletes: {
          select: {
            athleteId: true,
          },
        },
      },
    });

    if (
      !user ||
      user.userId !== payload.userId ||
      user.sessionVersion !== payload.sessionVersion
    )
      throw new UnauthorizedException();
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId! },
    });
    if (
      !session ||
      session.userId !== user.userId ||
      session.expiresAt <= new Date()
    )
      throw new UnauthorizedException();

    return {
      userId: user.userId,
      email: user.email,
      authSessionId: session.id,
      roles: user.roles,
      athlete: user.athlete ? { athleteId: user.athlete.athleteId } : null,
      coachAthletes:
        user.coachAthletes?.map((ca) => ({ athleteId: ca.athleteId })) || [],
    };
  }
}
