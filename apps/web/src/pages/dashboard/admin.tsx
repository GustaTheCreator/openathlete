import { AdminAPI } from '@/api/admin';
import { ConfirmAction } from '@/components/confirm-action';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageTitle } from '@/components/ui/page-title';
import { useAuthContext, useUserRoles } from '@/contexts/auth';
import { m } from '@/paraglide/messages';
import {
  invitationPurposeLabel,
  openInvitationLabel,
} from '@/utils/invitations';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  AdminCoachAthleteDto,
  AdminCreateInvitationDto,
  AdminInvitationDto,
  AdminUserDto,
  UserRole,
} from '@openathlete/shared';

const editableRoles: UserRole[] = ['ATHLETE', 'COACH', 'SUPER_ADMIN'];

function UserRoleEditor({
  user,
  pending,
  onSave,
}: {
  user: AdminUserDto;
  pending: boolean;
  onSave: (roles: UserRole[]) => void;
}) {
  const [roles, setRoles] = useState<UserRole[]>(user.roles);
  useEffect(() => setRoles(user.roles), [user.roles]);
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(roles);
      }}
    >
      {editableRoles.map((role) => (
        <Label key={role} className="font-normal">
          <Checkbox
            checked={roles.includes(role)}
            onCheckedChange={(checked) =>
              setRoles((current) =>
                checked
                  ? [...new Set([...current, role])]
                  : current.filter((value) => value !== role),
              )
            }
          />
          {role}
        </Label>
      ))}
      <Button size="sm" type="submit" disabled={pending || roles.length === 0}>
        {m.admin_save_roles()}
      </Button>
    </form>
  );
}

export function AdminPage() {
  const roles = useUserRoles();
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [coachUserId, setCoachUserId] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [invitationKind, setInvitationKind] = useState<'ATHLETE' | 'COACH'>(
    'ATHLETE',
  );
  const [coachInvitationPurpose, setCoachInvitationPurpose] = useState<
    'PERSONAL' | 'COLLEAGUE'
  >('PERSONAL');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [associationToRemove, setAssociationToRemove] =
    useState<AdminCoachAthleteDto | null>(null);
  const [invitationToRemove, setInvitationToRemove] =
    useState<AdminInvitationDto | null>(null);

  const users = useQuery({
    queryKey: ['admin-users', search, offset],
    queryFn: () => AdminAPI.getUsers(search, offset),
    enabled: roles?.includes('SUPER_ADMIN'),
  });
  const associations = useQuery({
    queryKey: ['admin-coach-athletes'],
    queryFn: AdminAPI.getCoachAthletes,
    enabled: roles?.includes('SUPER_ADMIN'),
  });
  const invitations = useQuery({
    queryKey: ['admin-invitations'],
    queryFn: AdminAPI.getInvitations,
    enabled: roles?.includes('SUPER_ADMIN'),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-coach-athletes'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] }),
    ]);
  const handleError = (error: Error) => toast.error(error.message);

  const updateRoles = useMutation({
    mutationFn: ({ userId, roles }: { userId: number; roles: UserRole[] }) =>
      AdminAPI.updateUserRoles(userId, { roles }),
    onSuccess: async (_, variables) => {
      await refresh();
      toast.success(
        variables.userId === user?.userId
          ? m.admin_roles_saved_self()
          : m.admin_roles_saved(),
      );
    },
    onError: handleError,
  });
  const createAssociation = useMutation({
    mutationFn: AdminAPI.createCoachAthlete,
    onSuccess: async () => {
      setCoachUserId('');
      setAthleteId('');
      await refresh();
      toast.success(m.admin_association_created());
    },
    onError: handleError,
  });
  const removeAssociation = useMutation({
    mutationFn: AdminAPI.deleteCoachAthlete,
    onSuccess: refresh,
    onError: handleError,
  });
  const createInvitation = useMutation({
    mutationFn: (body: AdminCreateInvitationDto) =>
      AdminAPI.createInvitation(body),
    onSuccess: async () => {
      setInviteEmail('');
      await refresh();
      toast.success(m.admin_invitation_created());
    },
    onError: handleError,
  });
  const removeInvitation = useMutation({
    mutationFn: AdminAPI.deleteInvitation,
    onSuccess: refresh,
    onError: handleError,
  });

  if (!roles?.includes('SUPER_ADMIN')) return <Navigate to="/403" replace />;

  const onCreateAssociation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const coach = Number(coachUserId);
    const athlete = Number(athleteId);
    if (
      !Number.isInteger(coach) ||
      coach <= 0 ||
      !Number.isInteger(athlete) ||
      athlete <= 0
    ) {
      toast.error(m.admin_invalid_ids());
      return;
    }
    createAssociation.mutate({ coachUserId: coach, athleteId: athlete });
  };

  const onCreateInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const owner = Number(ownerUserId);
    if (!Number.isInteger(owner) || owner <= 0) {
      toast.error(m.admin_invalid_ids());
      return;
    }
    const email = inviteEmail.trim();
    const body: AdminCreateInvitationDto =
      invitationKind === 'COACH'
        ? {
            kind: 'COACH',
            ownerUserId: owner,
            email,
            purpose: coachInvitationPurpose,
          }
        : { kind: 'ATHLETE', ownerUserId: owner, email };
    createInvitation.mutate(body);
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 p-4 md:p-8">
      <header>
        <PageTitle>{m.admin_users()}</PageTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {m.admin_description()}
        </p>
      </header>

      <section aria-labelledby="admin-users-heading" className="space-y-4">
        <h2 id="admin-users-heading" className="text-lg font-semibold">
          {m.admin_users()}
        </h2>
        <div className="max-w-md space-y-2">
          <Label htmlFor="admin-user-search">{m.admin_search_users()}</Label>
          <Input
            id="admin-user-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
            placeholder={m.email_placeholder()}
          />
        </div>
        {users.isPending ? (
          <p role="status">{m.loading()}</p>
        ) : users.isError ? (
          <p role="alert">{users.error.message}</p>
        ) : users.data.users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.admin_no_users()}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {users.data.users.map((adminUser) => (
              <div
                key={adminUser.userId}
                className="grid gap-3 p-4 md:grid-cols-[minmax(12rem,1fr)_2fr] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {adminUser.firstName} {adminUser.lastName}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {adminUser.email} · ID {adminUser.userId}
                  </p>
                </div>
                <UserRoleEditor
                  user={adminUser}
                  pending={updateRoles.isPending}
                  onSave={(nextRoles) =>
                    updateRoles.mutate({
                      userId: adminUser.userId,
                      roles: nextRoles,
                    })
                  }
                />
              </div>
            ))}
          </div>
        )}
        {users.data && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {m.admin_user_count({ count: users.data.total })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || users.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                {m.admin_previous()}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + 100 >= users.data.total || users.isFetching}
                onClick={() => setOffset(offset + 100)}
              >
                {m.admin_next()}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section
        aria-labelledby="admin-associations-heading"
        className="space-y-4 border-t pt-6"
      >
        <h2 id="admin-associations-heading" className="text-lg font-semibold">
          {m.admin_coach_athlete_links()}
        </h2>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={onCreateAssociation}
        >
          <div className="space-y-2">
            <Label htmlFor="coach-user-id">{m.admin_coach_user_id()}</Label>
            <Input
              id="coach-user-id"
              type="number"
              min="1"
              required
              value={coachUserId}
              onChange={(event) => setCoachUserId(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="athlete-id">{m.admin_athlete_id()}</Label>
            <Input
              id="athlete-id"
              type="number"
              min="1"
              required
              value={athleteId}
              onChange={(event) => setAthleteId(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={createAssociation.isPending}
            className="sm:mt-auto"
          >
            {m.admin_add_link()}
          </Button>
        </form>
        {associations.isPending ? (
          <p role="status">{m.loading()}</p>
        ) : associations.isError ? (
          <p role="alert">{associations.error.message}</p>
        ) : associations.data.associations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.admin_no_links()}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {associations.data.associations.map((association) => (
              <div
                key={association.coachAthleteId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <p className="min-w-0 text-sm">
                  <span className="font-medium">{association.coachName}</span> (
                  {association.coachEmail}) →{' '}
                  <span className="font-medium">{association.athleteName}</span>{' '}
                  ({association.athleteEmail})
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={removeAssociation.isPending}
                  onClick={() => setAssociationToRemove(association)}
                >
                  {m.delete_()}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="admin-invitations-heading"
        className="space-y-4 border-t pt-6"
      >
        <h2 id="admin-invitations-heading" className="text-lg font-semibold">
          {m.invitations()}
        </h2>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={onCreateInvitation}
        >
          <div className="space-y-2">
            <Label htmlFor="invitation-kind">{m.admin_invitation_kind()}</Label>
            <select
              id="invitation-kind"
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={invitationKind}
              onChange={(event) =>
                setInvitationKind(event.target.value as 'ATHLETE' | 'COACH')
              }
            >
              <option value="ATHLETE">ATHLETE</option>
              <option value="COACH">COACH</option>
            </select>
          </div>
          {invitationKind === 'COACH' && (
            <div className="space-y-2">
              <Label htmlFor="coach-invitation-purpose">
                {m.invitation_purpose()}
              </Label>
              <select
                id="coach-invitation-purpose"
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={coachInvitationPurpose}
                onChange={(event) =>
                  setCoachInvitationPurpose(
                    event.target.value as 'PERSONAL' | 'COLLEAGUE',
                  )
                }
              >
                <option value="PERSONAL">
                  {m.invitation_purpose_personal()}
                </option>
                <option value="COLLEAGUE">
                  {m.invitation_purpose_colleague()}
                </option>
              </select>
              <p className="text-sm text-muted-foreground">
                {coachInvitationPurpose === 'PERSONAL'
                  ? m.invitation_purpose_personal_description()
                  : m.invitation_purpose_colleague_description()}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="invitation-owner">{m.admin_owner_user_id()}</Label>
            <Input
              id="invitation-owner"
              type="number"
              min="1"
              required
              value={ownerUserId}
              onChange={(event) => setOwnerUserId(event.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="invitation-email">{m.admin_invitee_email()}</Label>
            <Input
              id="invitation-email"
              type="email"
              maxLength={254}
              required
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={createInvitation.isPending}
            className="sm:col-span-2 sm:justify-self-start"
          >
            {m.admin_create_invitation()}
          </Button>
        </form>
        {invitations.isPending ? (
          <p role="status">{m.loading()}</p>
        ) : invitations.isError ? (
          <p role="alert">{invitations.error.message}</p>
        ) : invitations.data.invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {m.admin_no_invitations()}
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {invitations.data.invitations.map((invitation) => (
              <div
                key={`${invitation.kind}-${invitation.invitationId}`}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <p className="min-w-0 text-sm">
                  <span className="font-medium">{invitation.kind}</span> ·{' '}
                  {invitation.email ?? openInvitationLabel()} ·{' '}
                  {invitation.purpose &&
                    invitationPurposeLabel(invitation.purpose)}{' '}
                  · {invitation.status ?? '—'} · {invitation.ownerEmail}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={removeInvitation.isPending}
                  onClick={() => setInvitationToRemove(invitation)}
                >
                  {m.cancel_invitation()}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      <ConfirmAction
        open={associationToRemove !== null}
        onClose={() => setAssociationToRemove(null)}
        onConfirm={() => {
          if (associationToRemove) {
            removeAssociation.mutate(associationToRemove.coachAthleteId);
          }
          setAssociationToRemove(null);
        }}
        title={m.admin_remove_link_title()}
        message={m.admin_remove_link_message()}
        isLoading={removeAssociation.isPending}
      />
      <ConfirmAction
        open={invitationToRemove !== null}
        onClose={() => setInvitationToRemove(null)}
        onConfirm={() => {
          if (invitationToRemove) removeInvitation.mutate(invitationToRemove);
          setInvitationToRemove(null);
        }}
        title={m.admin_cancel_invitation_title()}
        message={m.admin_cancel_invitation_message()}
        isLoading={removeInvitation.isPending}
      />
    </main>
  );
}

export default AdminPage;
