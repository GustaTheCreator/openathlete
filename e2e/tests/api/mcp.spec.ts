import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

import { apiHeaders, createAthlete } from '../../support/api';
import { API_URL, WEB_URL } from '../../support/env';

const MCP_URL = `${WEB_URL}/api/mcp`;
const REDIRECT = 'http://127.0.0.1:33418/callback';

test('MCP access and discovery are unavailable', async ({ request }) => {
  const athlete = await createAthlete(request);
  const headers = apiHeaders(undefined, athlete.accessToken);

  const responses = await Promise.all([
    request.post(MCP_URL, {
      headers,
      data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    }),
    request.get(`${API_URL}/mcp/connections`, { headers }),
    request.post(`${API_URL}/mcp/tokens`, { headers, data: {} }),
    request.get(`${WEB_URL}/api/.well-known/oauth-protected-resource/mcp`),
  ]);
  expect(responses.map((response) => response.status())).toEqual([
    404, 404, 404, 404,
  ]);
});

test('OAuth refuses requests for MCP and advertises the file import scope', async ({
  request,
}) => {
  const metadata = await request.get(
    `${WEB_URL}/.well-known/oauth-authorization-server/api`,
  );
  expect(metadata.status()).toBe(200);
  const server = await metadata.json();
  expect(server.scopes_supported).toEqual(['activities:import']);

  const registration = await request.post(server.registration_endpoint, {
    headers: apiHeaders(),
    data: { client_name: 'E2E agent', redirect_uris: [REDIRECT] },
  });
  expect(registration.status()).toBe(201);
  const client = await registration.json();

  const verifier = randomBytes(32).toString('base64url');
  const query = {
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    scope: 'read write',
  };
  for (const params of [query, { ...query, resource: MCP_URL }]) {
    const authorize = await request.get(server.authorization_endpoint, {
      headers: apiHeaders(),
      params,
      maxRedirects: 0,
    });
    expect(authorize.status()).toBe(302);
    const redirect = new URL(authorize.headers().location!);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get('error')).toBe('invalid_target');
    expect(redirect.searchParams.has('code')).toBe(false);
  }
});
