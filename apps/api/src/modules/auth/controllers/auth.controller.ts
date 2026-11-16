import type { Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  AuthResponseDto,
  FirebaseLoginDto,
  LoginDto,
  RefreshTokenDto,
  firebaseLoginDtoSchema,
  loginDtoSchema,
  refreshTokenDtoSchema,
} from '@openathlete/shared';

import { RATE_LIMITS } from 'src/common/security/rate-limits';

import { AuthUser, JwtUser } from '../decorators/user.decorator';
import { AuthService } from '../services';
import { AuthCookieService } from '../services/auth-cookie.service';
import { InvitationService } from '../services/invitation.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private invitationService: InvitationService,
    private cookies: AuthCookieService,
  ) {}

  @Throttle(RATE_LIMITS.login)
  @Post('login')
  @ApiOperation({
    summary: 'Authenticate user with email and password',
    description:
      'Validates user credentials and returns access and refresh tokens. The access token expires in 1 hour, while the refresh token expires in 30 days.',
  })
  @ApiBody({
    description: 'User login credentials',
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'user@example.com',
        },
        password: {
          type: 'string',
          format: 'password',
          example: 'securePassword123',
        },
      },
      required: ['email', 'password'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful',
    schema: {
      type: 'object',
      properties: {
        accessToken: {
          type: 'string',
          description: 'JWT access token (expires in 1 hour)',
          example:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSJ9...',
        },
        refreshToken: {
          type: 'string',
          description: 'JWT refresh token (expires in 30 days)',
          example:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSJ9...',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials - email or password is incorrect',
  })
  async login(
    @Body(new ZodValidationPipe(loginDtoSchema)) credentials: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    this.cookies.assertLogin(req);
    return this.cookies.respond(
      await this.authService.login(credentials),
      req,
      res,
    );
  }

  @Throttle(RATE_LIMITS.login)
  @Post('firebase')
  @ApiOperation({
    summary: 'Authenticate user with Firebase OAuth (ID token exchange)',
    description:
      'Verifies a Firebase ID token (OAuth providers: Google/Apple/GitHub), creates a user if missing, and returns OpenAthlete access and refresh tokens.',
  })
  async loginWithFirebase(
    @Body(new ZodValidationPipe(firebaseLoginDtoSchema)) body: FirebaseLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    this.cookies.assertLogin(req);
    return this.cookies.respond(
      await this.authService.loginWithFirebase(body),
      req,
      res,
    );
  }

  @Throttle(RATE_LIMITS.tokenRefresh)
  @Post('refresh-token')
  @ApiOperation({
    summary: 'Refresh access token using refresh token',
    description:
      'Generates a new pair of access and refresh tokens using a valid refresh token. Useful for maintaining user sessions without requiring re-authentication.',
  })
  @ApiBody({
    description: 'Refresh token request',
    schema: {
      type: 'object',
      properties: {
        refreshToken: {
          type: 'string',
          description: 'Valid refresh token',
          example:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSJ9...',
        },
      },
      required: ['refreshToken'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Token refresh successful',
    schema: {
      type: 'object',
      properties: {
        accessToken: {
          type: 'string',
          description: 'New JWT access token (expires in 1 hour)',
          example:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSJ9...',
        },
        refreshToken: {
          type: 'string',
          description: 'New JWT refresh token (expires in 30 days)',
          example:
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSJ9...',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token',
  })
  async refreshToken(
    @Body(new ZodValidationPipe(refreshTokenDtoSchema)) body: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const browser = this.cookies.isBrowser(req);
    const token = browser ? this.cookies.refreshToken(req) : body.refreshToken;
    if (!token) throw new UnauthorizedException();
    if (browser) this.cookies.assertCsrf(req);
    return this.cookies.respond(
      await this.authService.refresh(token),
      req,
      res,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  async logout(
    @JwtUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (this.cookies.isBrowser(req)) this.cookies.assertCsrf(req);
    if (!user.authSessionId) throw new UnauthorizedException();
    await this.authService.revokeSession(user.userId, user.authSessionId);
    this.cookies.clear(res);
  }

  @Throttle(RATE_LIMITS.accountLookup)
  @Get('invitation')
  @ApiOperation({
    summary: 'Verify invitation token validity',
    description:
      'Validates an invitation token and returns the associated email if valid. The token can be for either an athlete invitation or a coach invitation. Returns valid=false if the token is invalid or expired.',
  })
  @ApiQuery({
    name: 'token',
    type: String,
    description: 'Invitation token to verify',
    example: 'abc123def456...',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Invitation verification result',
    schema: {
      type: 'object',
      properties: {
        valid: {
          type: 'boolean',
          description: 'Whether the invitation token is valid',
          example: true,
        },
        email: {
          type: 'string',
          format: 'email',
          description:
            'Email address associated with the invitation (only present if valid=true)',
          example: 'invited@example.com',
        },
      },
      required: ['valid'],
    },
  })
  async verifyInvitation(@Query('token') token: string) {
    const invitation =
      await this.invitationService.verifyInvitationToken(token);
    if (!invitation) {
      return { valid: false };
    }
    return {
      valid: true,
      email: invitation.email,
    };
  }
}
