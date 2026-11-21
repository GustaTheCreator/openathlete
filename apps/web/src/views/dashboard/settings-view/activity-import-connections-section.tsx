import {
  useActivityImportConnectionsQuery,
  useRevokeActivityImportConnectionMutation,
} from '@/api/activity-import';
import { ConfirmAction } from '@/components/confirm-action';
import { Button } from '@/components/ui/button';
import { m } from '@/paraglide/messages';
import { useState } from 'react';
import { toast } from 'sonner';

import { McpConnection } from '@openathlete/shared';

import {
  SettingsPanel,
  SettingsRow,
  SettingsSection,
} from './settings-section';

export function ActivityImportConnectionsSection() {
  const { data: connections = [] } = useActivityImportConnectionsQuery();
  const revoke = useRevokeActivityImportConnectionMutation();
  const [selected, setSelected] = useState<McpConnection | null>(null);

  if (connections.length === 0) return null;

  return (
    <SettingsSection title={m.activity_import_connections_title()}>
      <SettingsPanel>
        {connections.map((connection) => (
          <SettingsRow key={connection.mcpGrantId} title={connection.name}>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              aria-label={`${m.mcp_revoke()} ${connection.name}`}
              onClick={() => setSelected(connection)}
            >
              {m.mcp_revoke()}
            </Button>
          </SettingsRow>
        ))}
      </SettingsPanel>
      <ConfirmAction
        open={selected !== null}
        onClose={() => setSelected(null)}
        onConfirm={async () => {
          if (!selected) return;
          try {
            await revoke.mutateAsync(selected.mcpGrantId);
            toast.success(m.mcp_revoked());
            setSelected(null);
          } catch {
            toast.error(m.mcp_revoke_failed());
          }
        }}
        title={`${m.mcp_revoke()} ${selected?.name ?? ''}`}
        message={m.activity_import_revoke_confirm()}
        isLoading={revoke.isPending}
      />
    </SettingsSection>
  );
}
