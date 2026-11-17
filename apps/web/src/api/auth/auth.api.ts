import client, { routes } from '@/utils/axios';
import { getApiBaseUrl, isCapacitor } from '@/utils/capacitor';

import {
  AuthResponseDto,
  EmailLanguage,
  FirebaseLoginDto,
  InvitationPreviewDto,
  InvitationTokenDto,
  LoginDto,
  OidcExchangeDto,
} from '@openathlete/shared';

function sessionRequestConfig() {
  return isCapacitor()
    ? undefined
    : {
        withCredentials: true,
        headers: { 'X-Auth-Mode': 'cookie' },
      };
}

export class AuthAPI {
  static async login(body: LoginDto): Promise<AuthResponseDto> {
    const res = await client.post(
      routes.auth.login,
      body,
      sessionRequestConfig(),
    );
    return res.data;
  }

  static async loginWithFirebase(
    body: FirebaseLoginDto,
  ): Promise<AuthResponseDto> {
    const res = await client.post(
      routes.auth.firebaseLogin,
      body,
      sessionRequestConfig(),
    );
    return res.data;
  }

  static async exchangeOidcCode(
    body: OidcExchangeDto,
  ): Promise<AuthResponseDto> {
    const res = await client.post(
      routes.auth.oidcExchange,
      body,
      sessionRequestConfig(),
    );
    return res.data;
  }

  /** Where the browser goes to sign in with the instance's provider */
  static oidcSignInUrl(params: {
    invitation?: string;
    coachInvitation?: string;
    language?: EmailLanguage;
  }): string {
    const query = new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => !!entry[1],
      ),
    );
    return `${getApiBaseUrl()}${routes.auth.oidc}?${query}`;
  }

  static async verifyInvitation(token: string): Promise<InvitationPreviewDto> {
    const res = await client.get(routes.auth.verifyInvitation, {
      params: { token },
    });
    return res.data;
  }

  static async acceptInvitation(body: InvitationTokenDto): Promise<void> {
    await client.post(routes.auth.acceptInvitation, body);
  }

  static async rejectInvitation(body: InvitationTokenDto): Promise<void> {
    await client.post(routes.auth.rejectInvitation, body);
  }
}
