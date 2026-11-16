declare module 'jsonwebtoken' {
  export interface JwtPayload {
    userId: number;
    user_id?: number; // Alias for compatibility
    email: string;
    type: string;
    iat?: number;
    exp?: number;
    iss?: string;
    aud?: string | string[];
    jti?: string;
    sessionId?: string;
    sessionVersion?: number;
    tokenType?: 'access' | 'refresh';
  }

  export function sign(
    payload: string | object | Buffer,
    secretOrPrivateKey: string | Buffer,
    options?: {
      expiresIn?: string | number;
      algorithm?: string;
      issuer?: string;
      audience?: string;
    },
  ): string;

  export function verify(
    token: string,
    secretOrPublicKey: string | Buffer,
    options?: {
      algorithms?: string[];
      issuer?: string;
      audience?: string;
    },
  ): JwtPayload;
}
