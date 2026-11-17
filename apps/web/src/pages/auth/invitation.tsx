import { AuthAPI } from '@/api/auth/auth.api';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/ui/page-title';
import { useAuthContext } from '@/contexts/auth';
import { m } from '@/paraglide/messages';
import { getPath } from '@/routes/paths';
import {
  allowInvitationTokenForSignup,
  clearPendingInvitationToken,
  getPendingInvitationToken,
} from '@/utils/invitation-token';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { InvitationPreviewDto } from '@openathlete/shared';

function invitationDescription(preview: InvitationPreviewDto) {
  if (preview.kind === 'ATHLETE') return m.invitation_preview_athlete();
  switch (preview.purpose) {
    case 'PERSONAL':
      return m.invitation_preview_coach_personal();
    case 'COLLEAGUE':
      return m.invitation_preview_coach_colleague();
    case 'SHARE':
      return m.invitation_preview_coach_share();
    case 'TRANSFER':
      return m.invitation_preview_coach_transfer();
    default:
      return m.invitation_preview_generic();
  }
}

export function InvitationPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? getPendingInvitationToken();
  const navigate = useNavigate();
  const { authenticated, initialize } = useAuthContext();
  const previewQuery = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => AuthAPI.verifyInvitation(token!),
    enabled: Boolean(token),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => AuthAPI.acceptInvitation({ token: token! }),
    onSuccess: async () => {
      await initialize();
      clearPendingInvitationToken();
      navigate(getPath(['dashboard']), { replace: true });
    },
  });
  const reject = useMutation({
    mutationFn: () => AuthAPI.rejectInvitation({ token: token! }),
    onSuccess: () => {
      clearPendingInvitationToken();
      navigate(getPath(['dashboard']), { replace: true });
    },
  });

  const returnTo = getPath(['auth', 'invitation']);
  const createAccountUrl = getPath(['auth', 'createAccount']);
  const isRosterInvitation =
    previewQuery.data?.kind === 'COACH' &&
    (previewQuery.data.purpose === 'SHARE' ||
      previewQuery.data.purpose === 'TRANSFER');
  const invitationSettingsUrl = `${getPath(['dashboard', 'settings'])}?tab=invitations`;

  if (!token || previewQuery.isError || previewQuery.data?.valid === false) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 text-center">
        <PageTitle>{m.invitation_preview_title()}</PageTitle>
        <p role="alert" className="text-sm text-muted-foreground">
          {m.invitation_preview_invalid()}
        </p>
        <Button asChild variant="outline">
          <Link to={getPath(['auth', 'login'])}>{m.login()}</Link>
        </Button>
      </div>
    );
  }

  if (previewQuery.isPending || !previewQuery.data) {
    return (
      <div className="mx-auto w-full max-w-lg p-4">
        <p role="status">{m.invitation_preview_loading()}</p>
      </div>
    );
  }

  const preview = previewQuery.data;
  const loginUrl = `${getPath(['auth', 'login'])}?returnTo=${encodeURIComponent(isRosterInvitation ? invitationSettingsUrl : returnTo)}`;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-5 p-4">
      <header className="space-y-2">
        <PageTitle>{m.invitation_preview_title()}</PageTitle>
        {preview.inviterName && (
          <p className="text-sm text-muted-foreground">
            {m.invitation_preview_invited_by({ name: preview.inviterName })}
          </p>
        )}
      </header>
      <p>{invitationDescription(preview)}</p>
      {preview.email && (
        <p className="text-sm text-muted-foreground">{preview.email}</p>
      )}
      {preview.expiresAt && (
        <p className="text-sm text-muted-foreground">
          {m.invitation_link_expires({
            date: new Date(preview.expiresAt).toLocaleString(),
          })}
        </p>
      )}

      {authenticated && isRosterInvitation ? (
        <Button asChild>
          <Link
            to={invitationSettingsUrl}
            onClick={clearPendingInvitationToken}
          >
            {m.invitations()}
          </Link>
        </Button>
      ) : authenticated ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => accept.mutate()}
            disabled={accept.isPending || reject.isPending}
            isLoading={accept.isPending}
          >
            {m.invitation_accept()}
          </Button>
          <Button
            variant="outline"
            onClick={() => reject.mutate()}
            disabled={accept.isPending || reject.isPending}
          >
            {m.invitation_reject()}
          </Button>
          {(accept.isError || reject.isError) && (
            <p role="alert" className="text-sm text-destructive">
              {accept.isError
                ? m.invitation_accept_error()
                : m.invitation_reject_error()}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <Link to={loginUrl}>{m.invitation_preview_sign_in()}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={createAccountUrl} onClick={allowInvitationTokenForSignup}>
              {m.invitation_preview_create_account()}
            </Link>
          </Button>
        </div>
      )}
    </main>
  );
}

export default InvitationPage;
