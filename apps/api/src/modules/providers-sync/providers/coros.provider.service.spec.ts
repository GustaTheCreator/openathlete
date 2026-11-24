import axios from 'axios';

import { ProviderAccount } from '@openathlete/database';

import { InvalidRefreshTokenError } from '../errors/invalid-refresh-token.error';
import { ProviderRateLimitError } from '../errors/provider-rate-limit.error';
import {
  CorosProviderService,
  corosIssuer,
  parseMcpBody,
  toolText,
} from './coros.provider.service';

jest.mock('../../core/helpers/activity-file-parser.service', () => ({
  ActivityFileParserService: class {},
}));
jest.mock('axios', () => ({
  __esModule: true,
  ...jest.requireActual('axios'),
  default: { post: jest.fn(), get: jest.fn() },
}));

const post = axios.post as jest.Mock;

const account = {
  providerAccountId: 1,
  athleteId: 2,
  status: 'active',
  accessToken: 'token',
  refreshToken: 'refresh',
  expiresAt: new Date(Date.now() + 3_600_000),
  oauthClientId: 'client',
  region: 'us',
} as ProviderAccount;

function buildService() {
  const prisma = {
    providerAccount: { update: jest.fn(), findUnique: jest.fn() },
    eventActivity: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const queue = {
    addCorosSyncJob: jest.fn(),
    addCorosMetricsJob: jest.fn(),
    addCorosHistoryBatchJob: jest.fn(),
    addActivityImportJobs: jest.fn(),
  };
  const config = {
    get: (key: string) =>
      key === 'APP_URL' ? 'https://app.example.org/' : undefined,
  };
  const service = new CorosProviderService(
    prisma as never,
    config as never,
    queue as never,
    {} as never,
  );
  return { service, prisma, queue };
}

const toolAnswer = (text: string, isError = false) => ({
  data: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text }], isError },
  }),
});

describe('CorosProviderService', () => {
  beforeEach(() => post.mockReset());

  it('registers a client in the chosen region and starts PKCE', async () => {
    const { service } = buildService();
    post.mockResolvedValue({ data: { client_id: 'abc' } });

    const { uri, codeVerifier } =
      await service.getAuthorizationUriForRegion('us');

    expect(post.mock.calls[0][0]).toBe(
      'https://mcpus.coros.com/connect/register',
    );
    expect(post.mock.calls[0][1]).toMatchObject({
      redirect_uris: ['https://app.example.org/auth/callback/coros'],
      token_endpoint_auth_method: 'none',
    });
    const url = new URL(uri);
    expect(url.origin + url.pathname).toBe(
      'https://mcpus.coros.com/oauth2/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe(
      'https://mcpus.coros.com/mcp',
    );
    expect(
      JSON.parse(Buffer.from(codeVerifier, 'base64url').toString()),
    ).toMatchObject({ region: 'us', clientId: 'abc' });
  });

  it('exchanges the code at the region of the login', async () => {
    const { service, queue } = buildService();
    const saved = { providerAccountId: 9 };
    jest
      .spyOn(service, 'saveProviderAccount')
      .mockResolvedValue(saved as ProviderAccount);
    post.mockResolvedValue({
      data: { access_token: 'a', refresh_token: 'r', expires_in: 60 },
    });
    const pending = Buffer.from(
      JSON.stringify({ region: 'eu', clientId: 'abc', verifier: 'v' }),
    ).toString('base64url');

    await service.connect('code', pending, 2);

    expect(post.mock.calls[0][0]).toBe('https://mcpeu.coros.com/oauth2/token');
    const form = new URLSearchParams(post.mock.calls[0][1] as string);
    expect(form.get('code_verifier')).toBe('v');
    expect(form.get('client_id')).toBe('abc');
    expect(service.saveProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({ oauthClientId: 'abc', region: 'eu' }),
    );
    expect(queue.addCorosSyncJob).toHaveBeenCalledWith(9);
  });

  it('refuses a tampered login', async () => {
    const { service } = buildService();
    const pending = Buffer.from(
      JSON.stringify({ region: 'evil.host', clientId: 'a', verifier: 'v' }),
    ).toString('base64url');
    await expect(service.connect('code', pending, 2)).rejects.toThrow(
      'Invalid COROS code verifier',
    );
  });

  it('refreshes with the client and region of the account', async () => {
    const { service } = buildService();
    post.mockResolvedValue({ data: { access_token: 'a' } });

    await service.refreshAccessToken('old', account);

    expect(post.mock.calls[0][0]).toBe('https://mcpus.coros.com/oauth2/token');
    const form = new URLSearchParams(post.mock.calls[0][1] as string);
    expect(form.get('client_id')).toBe('client');
    expect(form.get('refresh_token')).toBe('old');
  });

  it('calls a tool on the server of the account', async () => {
    const { service } = buildService();
    post.mockResolvedValue(toolAnswer('hello'));

    await expect(service.callTool(account, 'queryUserInfo')).resolves.toBe(
      'hello',
    );
    expect(post.mock.calls[0][0]).toBe('https://mcpus.coros.com/mcp');
    expect(post.mock.calls[0][1]).toMatchObject({
      method: 'tools/call',
      params: { name: 'queryUserInfo' },
    });
  });

  it('turns the FIT quota into a rate limit', async () => {
    const { service } = buildService();
    post.mockResolvedValue(toolAnswer('Daily file limit exceeded', true));

    await expect(
      service.callTool(account, 'queryActivityFitFileDownloadUrls'),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it('never relays the text of a failed tool', async () => {
    const { service } = buildService();
    post.mockResolvedValue(
      toolAnswer(
        'Tool call anomalies detected. Initialize a new session',
        true,
      ),
    );

    await expect(
      service.callTool(account, 'getActivityDetail'),
    ).rejects.toThrow('COROS getActivityDetail failed');
  });

  it('treats a failure written in a successful answer as a failure', async () => {
    const { service, prisma } = buildService();
    post.mockResolvedValue(
      toolAnswer(
        'High risk of session context pollution. Resolution Strategy:',
      ),
    );
    await expect(
      service.callTool(account, 'querySportRecords'),
    ).rejects.toThrow('COROS querySportRecords failed');
    expect(prisma.providerAccount.update).not.toHaveBeenCalled();
  });

  const REFUSED =
    'Client authentication credentials missing, expired, or identity mismatched. Diagnostic advice: Verify COROS App login status';

  it('refreshes a refused token once and carries on', async () => {
    const { service, prisma } = buildService();
    prisma.providerAccount.update.mockResolvedValue({ accessToken: 'new' });
    post
      .mockResolvedValueOnce(toolAnswer(REFUSED))
      .mockResolvedValueOnce({ data: { access_token: 'new', expires_in: 60 } })
      .mockResolvedValueOnce(toolAnswer('No sport records found'));

    await expect(service.callTool(account, 'querySportRecords')).resolves.toBe(
      'No sport records found',
    );
    expect(post.mock.calls[1][0]).toBe('https://mcpus.coros.com/oauth2/token');
    expect(post.mock.calls[2][2].headers.Authorization).toBe('Bearer new');
  });

  it('asks for a reconnection when a fresh token is refused too', async () => {
    const { service, prisma } = buildService();
    prisma.providerAccount.update.mockResolvedValue({ accessToken: 'new' });
    post
      .mockResolvedValueOnce(toolAnswer(REFUSED))
      .mockResolvedValueOnce({ data: { access_token: 'new', expires_in: 60 } })
      .mockResolvedValueOnce(toolAnswer(REFUSED));

    await expect(
      service.callTool(account, 'querySportRecords'),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    expect(prisma.providerAccount.update).toHaveBeenLastCalledWith({
      where: { providerAccountId: 1 },
      data: { status: 'revoked' },
    });
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('queues only the activities it does not hold', async () => {
    const { service, prisma, queue } = buildService();
    const recentDate = new Date(Date.now() - 24 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    prisma.providerAccount.findUnique.mockResolvedValue({
      ...account,
      importActivitiesEnabled: true,
    });
    prisma.eventActivity.findMany.mockResolvedValue([{ externalId: '11' }]);
    post.mockResolvedValue(
      toolAnswer(`Sport Records (2 records)

1. Outdoor Run — ${recentDate}
   LabelId: 11 | SportType: 100

2. Outdoor Run — ${recentDate}
   LabelId: 22 | SportType: 100`),
    );

    await service.syncAccount(1);

    const [, missing] = queue.addActivityImportJobs.mock.calls[0];
    expect(missing.map((a: { externalId: string }) => a.externalId)).toEqual([
      '22',
    ]);
  });

  it('spreads the history over days, within the file quota', async () => {
    const { service, queue } = buildService();
    const recentDate = new Date(Date.now() - 24 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const records = Array.from(
      { length: 95 },
      (_, index) =>
        `${index + 1}. Run — ${recentDate}\n   LabelId: ${index} | SportType: 100`,
    ).join('\n\n');
    post
      .mockResolvedValueOnce(toolAnswer(`Sport Records\n\n${records}`))
      .mockResolvedValue(toolAnswer('No sport records found.'));

    await expect(service.queueFullImport(account)).resolves.toEqual({
      queuedActivities: 95,
    });

    const calls = queue.addCorosHistoryBatchJob.mock.calls;
    expect(calls.map(([, activities]) => activities.length)).toEqual([
      40, 40, 15,
    ]);
    expect(calls.map(([, , delay]) => delay / 3_600_000)).toEqual([0, 25, 50]);
  });

  it('keeps requesting bounded history through empty windows', async () => {
    const { service } = buildService();
    const callTool = jest
      .spyOn(service, 'callTool')
      .mockResolvedValue('No sport records found.');
    const startDate = new Date('2026-10-01T00:00:00.000Z');
    const endDate = new Date('2026-10-02T23:59:59.999Z');

    await service.queueFullImport(account, { startDate, endDate });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(account, 'querySportRecords', {
      startDate: '20260930',
      endDate: '20261003',
      sportTypeCodes: [65535],
      limit: 200,
    });
  });

  it('queries all available COROS records in one adaptive date range', async () => {
    const { service } = buildService();
    const callTool = jest
      .spyOn(service, 'callTool')
      .mockResolvedValue('No sport records found.');
    const endDate = new Date('2026-10-31T23:59:59.999Z');

    await service.queueFullImport(account, { endDate });

    expect(callTool).toHaveBeenCalledWith(account, 'querySportRecords', {
      startDate: '19691231',
      endDate: '20261101',
      sportTypeCodes: [65535],
      limit: 200,
    });
  });

  it('splits a saturated activity query into disjoint date ranges', async () => {
    const { service } = buildService();
    const callTool = jest.spyOn(service, 'callTool');
    const records = Array.from(
      { length: 200 },
      (_, index) =>
        `${index + 1}. Run — ${index < 100 ? '2026-10-06' : '2026-10-20'}\n   LabelId: ${index} | SportType: 100`,
    ).join('\n\n');
    const firstHalf = records.split('\n\n').slice(0, 100).join('\n\n');
    const secondHalf = records.split('\n\n').slice(100).join('\n\n');
    callTool
      .mockResolvedValueOnce(`Sport Records\n\n${records}`)
      .mockResolvedValueOnce(`Sport Records\n\n${firstHalf}`)
      .mockResolvedValueOnce(`Sport Records\n\n${secondHalf}`);

    const activities = await service.importActivities(account, {
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-31T23:59:59.999Z'),
    });

    expect(activities).toHaveLength(200);
    expect(callTool).toHaveBeenCalledTimes(3);
    expect(callTool.mock.calls[1][2]).toMatchObject({
      startDate: '20260930',
      endDate: '20261016',
    });
    expect(callTool.mock.calls[2][2]).toMatchObject({
      startDate: '20261017',
      endDate: '20261101',
    });
  });

  it('filters COROS local-date envelope records by their exact timestamps', async () => {
    const { service } = buildService();
    const startDate = new Date('2026-10-01T00:00:00.000Z');
    const endDate = new Date('2026-10-01T23:59:59.999Z');
    const outsideStart = Math.floor(
      new Date('2026-09-30T22:59:59.000Z').getTime() / 1000,
    );
    const insideStart = Math.floor(
      new Date('2026-10-01T01:00:00.000Z').getTime() / 1000,
    );
    const callTool = jest.spyOn(service, 'callTool').mockResolvedValue(
      `Sport Records (2 records)

1. Run — 2026-09-30
   LabelId: 1 | SportType: 100 | startTimestamp=${outsideStart}

2. Run — 2026-10-01
   LabelId: 2 | SportType: 100 | startTimestamp=${insideStart}`,
    );

    const activities = await service.importActivities(account, {
      startDate,
      endDate,
    });

    expect(callTool.mock.calls[0][2]).toMatchObject({
      startDate: '20260930',
      endDate: '20261002',
    });
    expect(activities.map(({ externalId }) => externalId)).toEqual(['2']);
  });

  it('fails instead of dropping records when one COROS day reaches the query limit', async () => {
    const { service } = buildService();
    const records = Array.from(
      { length: 200 },
      (_, index) =>
        `${index + 1}. Run — 2026-10-06\n   LabelId: ${index} | SportType: 100`,
    ).join('\n\n');
    jest
      .spyOn(service, 'callTool')
      .mockResolvedValue(`Sport Records\n\n${records}`);

    await expect(
      service.importActivities(account, {
        startDate: new Date('2026-10-06T00:00:00.000Z'),
        endDate: new Date('2026-10-06T23:59:59.999Z'),
      }),
    ).rejects.toThrow('cannot be imported without risking omissions');
  });

  it('skips delayed history batches after the COROS account changes', async () => {
    const { service, prisma, queue } = buildService();
    prisma.providerAccount.findUnique.mockResolvedValue({
      ...account,
      externalUserId: 'new-user',
      importActivitiesEnabled: true,
    });

    await service.importHistoryBatch(1, [], 'old-user');

    expect(queue.addActivityImportJobs).not.toHaveBeenCalled();
  });
});

describe('corosIssuer', () => {
  it('maps each region to its fixed COROS host', () => {
    expect(corosIssuer('eu')).toBe('https://mcpeu.coros.com');
    expect(corosIssuer('us')).toBe('https://mcpus.coros.com');
    expect(corosIssuer('cn')).toBe('https://mcpcn.coros.com');
  });

  it('never builds a host from an unknown region', () => {
    expect(corosIssuer('evil.example/')).toBe('https://mcpeu.coros.com');
    expect(corosIssuer('constructor')).toBe('https://mcpeu.coros.com');
  });
});

describe('COROS MCP answers', () => {
  it('reads JSON and event streams without losing long ids', () => {
    const json = '{"result":{"content":[{"type":"text","text":"a"}]}}';
    expect(parseMcpBody(json).result?.content?.[0].text).toBe('a');
    expect(
      parseMcpBody(`event: message\ndata: ${json}\n\n`).result?.content?.[0]
        .text,
    ).toBe('a');
  });

  it('decodes text that a tool encoded twice, and only that', () => {
    const block = (text: string) => ({ content: [{ type: 'text', text }] });
    expect(toolText(block('"line\\nnext"'))).toBe('line\nnext');
    expect(toolText(block('{"lapGroups":[]}'))).toBe('{"lapGroups":[]}');
  });
});
