import { useInstanceInfoQuery } from '@/api/instance';
import {
  useDisconnectProviderMutation,
  useGetConnectedProvidersQuery,
  useGetOAuthUriMutation,
  useImportAllActivitiesMutation,
  useUpdateProviderPreferencesMutation,
} from '@/api/provider';
import { GarminLogo, StravaIcon } from '@/assets/icons';
import { CorosLogo, PolarLogo, SuuntoLogo } from '@/assets/icons/providers';
import { ConfirmAction } from '@/components/confirm-action';
import {
  ConnectorsUnavailable,
  offeredProviders,
} from '@/components/connectors';
import { CorosRegionDialog } from '@/components/connectors/coros-region-dialog';
import { ImportFitDialog } from '@/components/import-fit-dialog/import-fit-dialog';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useUserRoles } from '@/contexts/auth';
import { m } from '@/paraglide/messages';
import {
  AnalyticsEvent,
  setOauthConnectSourceForRedirect,
} from '@/utils/analytics-events';
import { connectorProviderLabelMap } from '@/utils/label-map/core/connector-provider.label-map';
import {
  openOAuthUrl,
  rememberWahooLogin,
  wahooConnectionQuotaMessage,
} from '@/utils/oauth';
import { cn } from '@/utils/shadcn';
import { CheckCircle2, ChevronDown, Link2, Link2Off } from 'lucide-react';
import { usePostHog } from 'posthog-js/react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  ConnectorProvider,
  ProviderHistoryPeriod,
  ProviderPreferencesDto,
  getProviderSyncCapabilities,
  isFullImportInProgress,
} from '@openathlete/shared';

import { ActivityImportConnectionsSection } from './activity-import-connections-section';
import { CalendarFeedSection } from './calendar-feed-section';
import { DuplicateActivitiesSection } from './duplicate-activities-section';
import { GarminPersonalSection } from './garmin-personal-section';
import {
  SettingsPanel,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
} from './settings-section';
import { StravaActivityDescriptionRows } from './strava-activity-description';

const SUPPORTED_PROVIDERS: ConnectorProvider[] = [
  'STRAVA',
  'GARMIN',
  'SUUNTO',
  'POLAR',
  'COROS',
  'WAHOO',
];

function formatInputDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ConnectorsTab() {
  const posthog = usePostHog();
  const [corosRegionOpen, setCorosRegionOpen] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [providerToDisconnect, setProviderToDisconnect] =
    useState<ConnectorProvider | null>(null);
  const [openProvider, setOpenProvider] = useState<ConnectorProvider | null>(
    null,
  );
  const [updatingProvider, setUpdatingProvider] =
    useState<ConnectorProvider | null>(null);
  const roles = useUserRoles();
  const [importingProvider, setImportingProvider] =
    useState<ConnectorProvider | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<
    ProviderHistoryPeriod | 'custom'
  >('1m');
  const [historyStartDate, setHistoryStartDate] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 30);
    return formatInputDate(date);
  });
  const [historyEndDate, setHistoryEndDate] = useState(() =>
    formatInputDate(new Date()),
  );

  const { data: connectedProviders = [], isLoading: isLoadingAccounts } =
    useGetConnectedProvidersQuery();
  const { data: instance, isPending: isLoadingInstance } =
    useInstanceInfoQuery();
  const isLoadingConnected = isLoadingAccounts || isLoadingInstance;
  const providers = offeredProviders(
    SUPPORTED_PROVIDERS,
    instance?.providers ?? [],
    connectedProviders.map((account) => account.provider),
  );

  const getOAuthUriMutation = useGetOAuthUriMutation({
    onSuccess: async (response, { provider }) => {
      setOauthConnectSourceForRedirect('settings');
      posthog?.capture(AnalyticsEvent.provider_connect_initiated, {
        provider,
        source: 'settings',
      });
      // For PKCE providers (like Garmin), store codeVerifier in localStorage
      // Using localStorage instead of sessionStorage to persist across OAuth redirects
      if (provider.toUpperCase() === 'WAHOO') {
        rememberWahooLogin(response);
      } else if (response.codeVerifier) {
        const storageKey = `oauth_code_verifier_${provider.toUpperCase()}`;
        localStorage.setItem(storageKey, response.codeVerifier);
      } else if (provider.toUpperCase() === 'GARMIN') {
        console.error('Garmin OAuth: codeVerifier not found in response');
      }
      await openOAuthUrl(response.uri);
    },
    onError: (error) => {
      toast.error(
        wahooConnectionQuotaMessage(error) ??
          (error.message || m.failed_to_initiate_connection()),
      );
    },
  });

  const disconnectMutation = useDisconnectProviderMutation({
    onSuccess: (result, provider) => {
      posthog?.capture('provider_disconnected', { provider });
      setDisconnectDialogOpen(false);
      if (result.remoteRevoked === false) {
        toast.warning(m.wahoo_disconnect_remote_pending());
        return;
      }
      toast.success(
        m.disconnected_from_provider({
          provider: connectorProviderLabelMap[provider],
        }),
      );
      setDisconnectDialogOpen(false);
      setProviderToDisconnect(null);
    },
    onError: (error) => {
      toast.error(error.message || m.failed_to_disconnect());
    },
  });

  const updatePreferencesMutation = useUpdateProviderPreferencesMutation({
    onMutate: ({ provider }) => {
      setUpdatingProvider(provider);
    },
    onSuccess: (_, variables) => {
      toast.success(
        m.provider_preferences_updated({
          provider: connectorProviderLabelMap[variables.provider],
        }),
      );
    },
    onError: (error, variables) => {
      toast.error(
        error.message ||
          m.provider_preferences_failed({
            provider: variables.provider
              ? connectorProviderLabelMap[variables.provider]
              : '',
          }),
      );
    },
    onSettled: () => {
      setUpdatingProvider(null);
    },
  });

  const importAllActivitiesMutation = useImportAllActivitiesMutation({
    onMutate: ({ provider }) => {
      setImportingProvider(provider);
    },
    onSuccess: (result, { provider }) => {
      posthog?.capture('provider_full_import_requested', { provider });
      toast.success(
        result.queued
          ? m.full_import_started({
              provider: connectorProviderLabelMap[provider],
            })
          : m.full_import_completed(),
      );
    },
    onError: (error, { provider }) => {
      toast.error(
        error.message ||
          m.full_import_failed({
            provider: connectorProviderLabelMap[provider],
          }),
      );
    },
    onSettled: () => {
      setImportingProvider(null);
    },
  });

  const isConnected = (provider: ConnectorProvider) => {
    return connectedProviders.some((p) => p.provider === provider);
  };

  const handleConnect = (provider: ConnectorProvider) => {
    if (provider === 'COROS') {
      setCorosRegionOpen(true);
      return;
    }
    getOAuthUriMutation.mutate({ provider });
  };

  const handleDisconnect = (provider: ConnectorProvider) => {
    setProviderToDisconnect(provider);
    setDisconnectDialogOpen(true);
  };

  const handleConfirmDisconnect = () => {
    if (providerToDisconnect) {
      disconnectMutation.mutate(providerToDisconnect);
    }
  };

  const getProviderIcon = (provider: ConnectorProvider) => {
    switch (provider) {
      case 'STRAVA':
        return <StravaIcon />;
      case 'GARMIN':
        return <GarminLogo className="h-6 w-auto" />;
      case 'POLAR':
        return <PolarLogo className="h-6 w-auto" />;
      case 'SUUNTO':
        return <SuuntoLogo className="h-6 w-auto" />;
      case 'COROS':
        return <CorosLogo className="h-6 w-auto" />;
      default:
        return <Link2 className="h-5 w-5" />;
    }
  };

  const handlePreferenceChange = (
    provider: ConnectorProvider,
    preference: keyof ProviderPreferencesDto,
    value: boolean,
  ) => {
    posthog?.capture(AnalyticsEvent.provider_sync_preference_changed, {
      provider,
      preference,
      enabled: value,
    });
    updatePreferencesMutation.mutate({
      provider,
      payload: { [preference]: value } as ProviderPreferencesDto,
    });
  };

  return (
    <div className="space-y-8">
      {instance?.garminPersonalApi && <GarminPersonalSection />}
      {isLoadingConnected ? (
        <SettingsRowsSkeleton count={SUPPORTED_PROVIDERS.length} />
      ) : providers.length === 0 ? (
        <ConnectorsUnavailable />
      ) : (
        <SettingsPanel>
          {providers.map((provider) => {
            const connected = isConnected(provider);
            const isLoading =
              getOAuthUriMutation.isPending ||
              disconnectMutation.isPending ||
              isLoadingConnected;
            const providerDetails = connectedProviders.find(
              (p) => p.provider === provider,
            );
            const capabilities = getProviderSyncCapabilities(provider);
            const preferenceToggles =
              providerDetails && connected
                ? ([
                    capabilities.importActivities && {
                      key: 'importActivitiesEnabled',
                      label: m.import_sessions_toggle_label(),
                      description: m.import_sessions_toggle_description({
                        provider: connectorProviderLabelMap[provider],
                      }),
                      value: providerDetails.importActivitiesEnabled,
                    },
                    capabilities.exportWorkouts && {
                      key: 'exportWorkoutsEnabled',
                      label: m.export_workouts_toggle_label(),
                      description: m.export_workouts_toggle_description({
                        provider: connectorProviderLabelMap[provider],
                      }),
                      value: providerDetails.exportWorkoutsEnabled,
                    },
                    capabilities.importMetrics && {
                      key: 'importMetricsEnabled',
                      label: m.import_metrics_toggle_label(),
                      description: m.import_metrics_toggle_description({
                        provider: connectorProviderLabelMap[provider],
                      }),
                      value: providerDetails.importMetricsEnabled,
                    },
                  ].filter(Boolean) as Array<{
                    key: keyof ProviderPreferencesDto;
                    label: string;
                    description: string;
                    value: boolean;
                  }>)
                : [];
            const isUpdatingThisProvider =
              updatingProvider === provider &&
              updatePreferencesMutation.isPending;
            const isImportingThisProvider =
              importingProvider === provider &&
              importAllActivitiesMutation.isPending;
            const fullImportCompleted =
              providerDetails?.fullImportCompletedAt != null;
            const fullImportInProgress =
              providerDetails != null &&
              isFullImportInProgress(providerDetails);
            const isOpen = openProvider === provider;
            const logo = (
              <div className="flex size-10 items-center justify-center text-foreground">
                {getProviderIcon(provider)}
              </div>
            );

            if (!connected || !providerDetails) {
              return (
                <SettingsRow
                  key={provider}
                  leading={logo}
                  title={connectorProviderLabelMap[provider]}
                  description={m.not_connected()}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConnect(provider)}
                    disabled={isLoading}
                  >
                    <Link2 className="size-4" />
                    {m.connect()}
                  </Button>
                </SettingsRow>
              );
            }

            return (
              <Collapsible
                key={provider}
                open={isOpen}
                onOpenChange={(openState) =>
                  setOpenProvider(openState ? provider : null)
                }
              >
                <SettingsRow
                  leading={logo}
                  title={connectorProviderLabelMap[provider]}
                  description={
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3.5 shrink-0" />
                      {m.connected_and_syncing()}
                    </span>
                  }
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-w-11"
                      aria-label={`${connectorProviderLabelMap[provider]} ${m.provider_sync_options_title()}`}
                    >
                      <span className="hidden sm:inline">
                        {isOpen ? m.hide_sync_options() : m.show_sync_options()}
                      </span>
                      <ChevronDown
                        className={cn(
                          'size-4 transition-transform',
                          isOpen && 'rotate-180',
                        )}
                      />
                    </Button>
                  </CollapsibleTrigger>
                </SettingsRow>
                <CollapsibleContent className="divide-y border-t bg-muted/30">
                  {preferenceToggles.map((toggle) => {
                    const id = `${provider}-${toggle.key}`;
                    return (
                      <SettingsRow
                        key={toggle.key}
                        title={<Label htmlFor={id}>{toggle.label}</Label>}
                        description={toggle.description}
                      >
                        <Switch
                          id={id}
                          checked={toggle.value}
                          onCheckedChange={(checked) =>
                            handlePreferenceChange(
                              provider,
                              toggle.key,
                              checked,
                            )
                          }
                          disabled={isUpdatingThisProvider}
                        />
                      </SettingsRow>
                    );
                  })}
                  {capabilities.writeActivityDescription && (
                    <StravaActivityDescriptionRows
                      account={providerDetails}
                      onAuthorize={() =>
                        getOAuthUriMutation.mutate({ provider })
                      }
                    />
                  )}
                  {capabilities.supportsFullImport && (
                    <SettingsRow
                      stacked
                      title={m.full_import_title()}
                      description={
                        <>
                          {m.full_import_description({
                            provider: connectorProviderLabelMap[provider],
                          })}
                          {provider === 'GARMIN' &&
                            ` ${m.full_import_garmin_hint()}`}
                          {provider === 'POLAR' &&
                            ` ${m.full_import_polar_hint()}`}
                          {fullImportCompleted &&
                            ` ${m.full_import_completed()}`}
                          {!providerDetails.importActivitiesEnabled &&
                            ` ${m.full_import_disabled()}`}
                        </>
                      }
                    >
                      <div className="flex w-full flex-col gap-2 sm:w-auto">
                        <div className="w-full sm:w-48">
                          <Label
                            className="sr-only"
                            htmlFor="provider-history-period"
                          >
                            {m.provider_history_period_label()}
                          </Label>
                          <Select
                            value={historyPeriod}
                            onValueChange={(value) =>
                              setHistoryPeriod(
                                value as ProviderHistoryPeriod | 'custom',
                              )
                            }
                            disabled={
                              fullImportInProgress || isImportingThisProvider
                            }
                          >
                            <SelectTrigger
                              id="provider-history-period"
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1w">
                                {m.provider_history_period_1w()}
                              </SelectItem>
                              <SelectItem value="1m">
                                {m.provider_history_period_1m()}
                              </SelectItem>
                              <SelectItem value="2m">
                                {m.provider_history_period_2m()}
                              </SelectItem>
                              <SelectItem value="6m">
                                {m.provider_history_period_6m()}
                              </SelectItem>
                              <SelectItem value="1y">
                                {m.provider_history_period_1y()}
                              </SelectItem>
                              <SelectItem value="custom">
                                {m.history_period_custom()}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {historyPeriod === 'custom' && (
                          <div className="grid w-full gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label htmlFor={`${provider}-history-start`}>
                                {m.history_custom_start()}
                              </Label>
                              <input
                                id={`${provider}-history-start`}
                                type="date"
                                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                                value={historyStartDate}
                                max={historyEndDate}
                                onChange={(event) =>
                                  setHistoryStartDate(event.target.value)
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`${provider}-history-end`}>
                                {m.history_custom_end()}
                              </Label>
                              <input
                                id={`${provider}-history-end`}
                                type="date"
                                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                                value={historyEndDate}
                                min={historyStartDate}
                                max={formatInputDate(new Date())}
                                onChange={(event) =>
                                  setHistoryEndDate(event.target.value)
                                }
                              />
                            </div>
                          </div>
                        )}
                        <div className="flex w-full flex-col gap-2 sm:flex-row">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            disabled={
                              fullImportInProgress ||
                              isImportingThisProvider ||
                              !providerDetails.importActivitiesEnabled ||
                              (historyPeriod === 'custom' &&
                                (!historyStartDate ||
                                  !historyEndDate ||
                                  historyStartDate > historyEndDate))
                            }
                            onClick={() =>
                              importAllActivitiesMutation.mutate({
                                provider,
                                request:
                                  historyPeriod === 'custom'
                                    ? {
                                        period: 'custom',
                                        startDate: historyStartDate,
                                        endDate: historyEndDate,
                                      }
                                    : { period: historyPeriod },
                              })
                            }
                          >
                            {fullImportInProgress || isImportingThisProvider
                              ? m.full_import_in_progress()
                              : m.provider_history_import_cta()}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            disabled={
                              fullImportInProgress ||
                              isImportingThisProvider ||
                              !providerDetails.importActivitiesEnabled
                            }
                            onClick={() =>
                              importAllActivitiesMutation.mutate({
                                provider,
                                request: { period: 'all' },
                              })
                            }
                          >
                            {m.full_import_cta()}
                          </Button>
                        </div>
                      </div>
                    </SettingsRow>
                  )}
                  <SettingsRow
                    stacked
                    description={m.provider_account_connected({
                      provider: connectorProviderLabelMap[provider],
                    })}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive-foreground"
                      onClick={() => handleDisconnect(provider)}
                      disabled={isLoading}
                    >
                      <Link2Off className="size-4" />
                      {m.disconnect()}
                    </Button>
                  </SettingsRow>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </SettingsPanel>
      )}

      {roles?.includes('ATHLETE') && (
        <SettingsSection
          title={m.fit_import_title()}
          description={m.fit_import_help()}
        >
          <ImportFitDialog />
        </SettingsSection>
      )}

      {roles?.includes('ATHLETE') && <DuplicateActivitiesSection />}

      {roles?.includes('ATHLETE') && <ActivityImportConnectionsSection />}

      {roles?.includes('ATHLETE') && <CalendarFeedSection />}

      <CorosRegionDialog
        open={corosRegionOpen}
        onOpenChange={setCorosRegionOpen}
        onSelect={(region) => {
          setCorosRegionOpen(false);
          getOAuthUriMutation.mutate({ provider: 'COROS', region });
        }}
      />

      <ConfirmAction
        open={disconnectDialogOpen}
        onClose={() => {
          setDisconnectDialogOpen(false);
          setProviderToDisconnect(null);
        }}
        onConfirm={handleConfirmDisconnect}
        title={m.disconnect()}
        message={
          providerToDisconnect
            ? m.confirm_disconnect_provider({
                provider: connectorProviderLabelMap[providerToDisconnect],
              })
            : ''
        }
        isLoading={disconnectMutation.isPending}
      />
    </div>
  );
}
