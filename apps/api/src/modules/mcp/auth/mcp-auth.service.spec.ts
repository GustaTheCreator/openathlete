import { AuthUser } from 'src/modules/auth/decorators/user.decorator';

import { McpAuthService } from './mcp-auth.service';

const athlete = { userId: 12 } as AuthUser;
const grant = {
  mcpGrantId: 4,
  kind: 'OAUTH',
  name: 'Activity uploader',
  scopes: ['activities:import', 'read', 'write'],
  tokenHint: null,
  clientUri: null,
  client: { clientUri: 'https://uploader.example' },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  lastUsedAt: null,
  expiresAt: null,
};

describe('McpAuthService activity import connections', () => {
  it('lists only import grants and hides scopes for other resources', async () => {
    const findMany = jest.fn().mockResolvedValue([grant]);
    const service = new McpAuthService({ mcpGrant: { findMany } } as never);

    await expect(
      service.listActivityImportConnections(athlete),
    ).resolves.toMatchObject([
      {
        mcpGrantId: 4,
        scopes: ['activities:import'],
        clientUri: 'https://uploader.example',
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 12, scopes: { has: 'activities:import' } },
      }),
    );
  });

  it('revokes only grants that contain the activity import scope', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new McpAuthService({ mcpGrant: { deleteMany } } as never);

    await service.revokeActivityImportConnection(athlete, 4);

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        mcpGrantId: 4,
        userId: 12,
        scopes: { has: 'activities:import' },
      },
    });
  });
});
