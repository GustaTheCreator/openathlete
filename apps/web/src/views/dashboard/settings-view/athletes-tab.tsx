import {
  useCancelAthleteInvitationMutation,
  useGetMyCoachedAthletesQuery,
  useGetSentAthleteInvitationsQuery,
  useInviteAthleteMutation,
  useRemoveAthleteMutation,
} from '@/api/athlete';
import { useInviteRosterMutation } from '@/api/coach';
import { ConfirmAction } from '@/components/confirm-action';
import { InviteAthleteDialog } from '@/components/invite-athlete-dialog/invite-athlete.dialog';
import { ActivityAlertSettings } from '@/components/messages/activity-alert-settings';
import { PaywallDialog } from '@/components/paywall';
import { RosterInvitationDialog } from '@/components/roster-invitation-dialog/roster-invitation.dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUserRoles } from '@/contexts/auth';
import { useAthleteLimit } from '@/hooks/use-feature-access';
import { m } from '@/paraglide/messages';
import { getPath } from '@/routes/paths';
import { MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { canIssueInvitations } from '@openathlete/shared';

import { SentInvitationsSection } from './sent-invitations-section';
import {
  SettingsEmpty,
  SettingsPanel,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
} from './settings-section';

export function AthletesTab() {
  const canInvite = canIssueInvitations(useUserRoles() ?? []);
  const { data: athletes, isPending: isLoadingAthletes } =
    useGetMyCoachedAthletesQuery();
  const nav = useNavigate();
  const [alertsAthleteId, setAlertsAthleteId] = useState<number | null>(null);
  const { data: sentInvitations, isLoading: sentInvitationsLoading } =
    useGetSentAthleteInvitationsQuery({ enabled: canInvite });
  const [deleteAthleteDialog, setDeleteAthleteDialog] = useState<number | null>(
    null,
  );
  const [inviteAthleteDialog, setInviteAthleteDialog] = useState(false);
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<number[]>([]);
  const [rosterInvitationOperation, setRosterInvitationOperation] = useState<
    'SHARE' | 'TRANSFER' | null
  >(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const { maxAthletes } = useAthleteLimit();
  const currentAthleteCount = athletes?.length || 0;
  const canAddAthlete = useMemo(() => {
    if (maxAthletes === null) return true; // Unlimited
    return currentAthleteCount < maxAthletes;
  }, [maxAthletes, currentAthleteCount]);
  const removeAthleteMutation = useRemoveAthleteMutation();
  const inviteAthleteMutation = useInviteAthleteMutation({
    onSuccess: () => {
      setInviteAthleteDialog(false);
      toast.success(m.athlete_invited_successfully());
    },
    onError: () => toast.error(m.invitation_send_failed()),
  });
  const cancelInvitationMutation = useCancelAthleteInvitationMutation({
    onSuccess: () => {
      toast.success(m.invitation_cancelled());
    },
    onError: () => {
      toast.error(m.failed_to_cancel_invitation());
    },
  });
  const inviteRosterMutation = useInviteRosterMutation({
    onSuccess: () => {
      setRosterInvitationOperation(null);
      setSelectedAthleteIds([]);
      toast.success(m.invitation_sent());
    },
    onError: () => toast.error(m.invitation_send_failed()),
  });
  const selectedAthletes = (athletes ?? []).filter((athlete) =>
    selectedAthleteIds.includes(athlete.athleteId),
  );
  return (
    <div className="space-y-8">
      <Dialog
        open={alertsAthleteId !== null}
        onOpenChange={(open) => !open && setAlertsAthleteId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.activity_alert_settings_title()}</DialogTitle>
          </DialogHeader>
          {alertsAthleteId !== null && (
            <ActivityAlertSettings
              key={alertsAthleteId}
              athleteId={alertsAthleteId}
            />
          )}
        </DialogContent>
      </Dialog>
      <SettingsSection
        action={
          canInvite ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="sm"
                onClick={() => {
                  if (canAddAthlete) {
                    setInviteAthleteDialog(true);
                  } else {
                    setPaywallOpen(true);
                  }
                }}
              >
                {m.invite_athlete()}
              </Button>
            </div>
          ) : undefined
        }
      >
        {isLoadingAthletes ? (
          <SettingsRowsSkeleton count={3} />
        ) : !athletes?.length ? (
          <SettingsEmpty>{m.no_athletes_yet()}</SettingsEmpty>
        ) : (
          <SettingsPanel>
            {athletes.map((athlete) => (
              <SettingsRow
                key={athlete.athleteId}
                title={`${athlete.user?.firstName} ${athlete.user?.lastName}`}
                description={athlete.user?.email}
                leading={
                  canInvite ? (
                    <Checkbox
                      checked={selectedAthleteIds.includes(athlete.athleteId)}
                      disabled={
                        inviteRosterMutation.isPending ||
                        (!selectedAthleteIds.includes(athlete.athleteId) &&
                          selectedAthleteIds.length >= 100)
                      }
                      aria-label={m.select_athlete({
                        name: `${athlete.user?.firstName} ${athlete.user?.lastName}`,
                      })}
                      onCheckedChange={(checked) =>
                        setSelectedAthleteIds((current) =>
                          checked
                            ? [...current, athlete.athleteId]
                            : current.filter((id) => id !== athlete.athleteId),
                        )
                      }
                    />
                  ) : undefined
                }
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden sm:inline-flex"
                  onClick={() =>
                    nav(
                      getPath(['dashboard', 'calendar']) +
                        `/${athlete.athleteId}`,
                    )
                  }
                >
                  {m.view_calendar()}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="max-md:w-11"
                      aria-label={`${m.actions()} ${athlete.user?.firstName} ${athlete.user?.lastName}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="sm:hidden"
                      onClick={() =>
                        nav(
                          getPath(['dashboard', 'calendar']) +
                            `/${athlete.athleteId}`,
                        )
                      }
                    >
                      {m.view_calendar()}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setAlertsAthleteId(athlete.athleteId)}
                    >
                      {m.activity_alert_settings_title()}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleteAthleteDialog(athlete.athleteId)}
                    >
                      {m.delete_()}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SettingsRow>
            ))}
          </SettingsPanel>
        )}
      </SettingsSection>
      {canInvite && selectedAthletes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-muted-foreground">
            {m.roster_selected_count({ count: selectedAthletes.length })}
          </p>
          <Button
            variant="outline"
            onClick={() => setRosterInvitationOperation('SHARE')}
          >
            {m.invitation_operation_share()}
          </Button>
          <Button onClick={() => setRosterInvitationOperation('TRANSFER')}>
            {m.invitation_operation_transfer()}
          </Button>
        </div>
      )}
      {canInvite && (
        <SentInvitationsSection
          title={m.sent_invitations_to_athletes()}
          description={m.sent_invitations_to_athletes_description()}
          invitations={sentInvitations?.map((invitation) => ({
            id: invitation.athleteInvitationId,
            email: invitation.email,
            createdAt: invitation.createdAt,
          }))}
          isLoading={sentInvitationsLoading}
          isCancelling={cancelInvitationMutation.isPending}
          onCancel={(id) => cancelInvitationMutation.mutate(id)}
        />
      )}

      {canInvite && (
        <InviteAthleteDialog
          open={inviteAthleteDialog}
          onClose={() => setInviteAthleteDialog(false)}
          onInvite={(email) => inviteAthleteMutation.mutate({ email })}
          isLoading={inviteAthleteMutation.isPending}
        />
      )}
      {rosterInvitationOperation && (
        <RosterInvitationDialog
          open
          operation={rosterInvitationOperation}
          athleteNames={selectedAthletes.map(
            (athlete) =>
              `${athlete.user?.firstName ?? ''} ${athlete.user?.lastName ?? ''}`.trim() ||
              `#${athlete.athleteId}`,
          )}
          isLoading={inviteRosterMutation.isPending}
          onClose={() => setRosterInvitationOperation(null)}
          onInvite={(email) =>
            inviteRosterMutation.mutate({
              email,
              operation: rosterInvitationOperation,
              athleteIds: selectedAthletes.map((athlete) => athlete.athleteId),
            })
          }
        />
      )}
      <ConfirmAction
        open={!!deleteAthleteDialog}
        onClose={() => setDeleteAthleteDialog(null)}
        onConfirm={() => {
          if (deleteAthleteDialog) {
            removeAthleteMutation.mutate(deleteAthleteDialog);
          }
          setDeleteAthleteDialog(null);
        }}
        title={m.delete_athlete()}
        message={m.confirm_delete_athlete()}
        isLoading={removeAthleteMutation.isPending}
      />
      <PaywallDialog
        open={paywallOpen}
        onOpenChange={setPaywallOpen}
        reason="athlete-limit"
        analyticsSource="settings_athletes_tab"
      />
    </div>
  );
}
