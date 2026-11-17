import { useLoginMutation } from '@/api/auth';
import { AuthAPI } from '@/api/auth/auth.api';
import { useInstanceInfoQuery } from '@/api/instance';
import { useCreateAccountMutation } from '@/api/user';
import { FormProvider, RHFTextField } from '@/components/hook-form';
import { RHFCheckbox } from '@/components/hook-form/rhf-checkbox';
import { Button } from '@/components/ui/button';
import { useAuthContext } from '@/contexts/auth';
import { m } from '@/paraglide/messages';
import { getPath } from '@/routes/paths';
import { takeInvitationTokenForSignup } from '@/utils/invitation-token';
import { currentLanguage } from '@/utils/language-choice';
import { localizedNewPasswordSchema } from '@/utils/password';
import { localizedPersonNameSchema } from '@/utils/person-name';
import {
  RETURN_TO_PARAM,
  clearReturnTo,
  rememberReturnTo,
} from '@/utils/return-to';
import { cn } from '@/utils/shadcn';
import { signupRefusal } from '@/utils/signup';
import { OAuthButtons } from '@/views/auth/oauth-buttons';
import { zodResolver } from '@hookform/resolvers/zod';
import { isAxiosError } from 'axios';
import { usePostHog } from 'posthog-js/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import z from 'zod';

import {
  InvitationPreviewDto,
  createAccountDtoSchema,
} from '@openathlete/shared';

const PLAN_TOKEN_STORAGE_KEY = 'pendingPlanToken';

export function CreateAccountView({ className }: React.ComponentProps<'form'>) {
  const { initialize } = useAuthContext();
  const navigate = useNavigate();
  const posthog = usePostHog();
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('invitation');
  const coachInvitationToken = searchParams.get('coach-invitation');
  const [pendingInvitationToken] = useState(takeInvitationTokenForSignup);
  const rawInvitationToken =
    invitationToken || coachInvitationToken || pendingInvitationToken;
  const planToken = searchParams.get('planToken');
  const [invitationEmail, setInvitationEmail] = useState<string | null>(null);
  const [invitationPreview, setInvitationPreview] =
    useState<InvitationPreviewDto | null>(null);
  const [invitationCheckFailed, setInvitationCheckFailed] = useState(false);
  const [isVerifyingInvitation, setIsVerifyingInvitation] = useState(false);
  const methods = useForm<z.infer<typeof createAccountDtoSchema>>({
    resolver: zodResolver(
      createAccountDtoSchema.extend({
        password: localizedNewPasswordSchema(),
        firstName: localizedPersonNameSchema(),
        lastName: localizedPersonNameSchema(),
      }),
    ),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      invitationToken: invitationToken || undefined,
      coachInvitationToken: coachInvitationToken || undefined,
      acceptInvitation: false,
      // Consent to news must be given, never assumed (CNIL)
      emailNews: false,
    },
  });

  const returnTo = searchParams.get(RETURN_TO_PARAM);

  // Store planToken in sessionStorage if present
  useEffect(() => {
    if (planToken) {
      sessionStorage.setItem(PLAN_TOKEN_STORAGE_KEY, planToken);
    }
  }, [planToken]);

  // Followed once onboarding is done
  useEffect(() => {
    const token = rawInvitationToken;
    if (token) {
      setIsVerifyingInvitation(true);
      AuthAPI.verifyInvitation(token)
        .then((result) => {
          setInvitationPreview(result);
          setInvitationCheckFailed(!result.valid);
          if (result.valid && result.email) {
            setInvitationEmail(result.email);
            methods.setValue('email', result.email);
          }
        })
        .catch(() => setInvitationCheckFailed(true))
        .finally(() => {
          setIsVerifyingInvitation(false);
        });
    }
  }, [rawInvitationToken, methods]);

  const loginMutation = useLoginMutation({
    onSuccess: async () => {
      await initialize();
      navigate(getPath(['dashboard', 'onboarding']));
    },
    onError: () => toast.error(m.signup_login_failed()),
  });
  const createAccountMutation = useCreateAccountMutation({
    onSuccess: async (_, variables) => {
      posthog?.capture('user_signed_up');
      loginMutation.mutate({
        email: variables.email,
        password: variables.password,
      });
    },
    onError: (error) =>
      toast.error(
        signupRefusal(error) ??
          (isAxiosError(error) && error.response?.status === 409
            ? m.signup_email_exists()
            : m.signup_failed()),
      ),
  });
  const { data: instance } = useInstanceInfoQuery();
  const signup = instance?.signup ?? 'open';
  // In invite mode, the link of an invitation still opens the form
  const signupBlocked =
    signup === 'closed' || (signup === 'invite' && !rawInvitationToken);

  const { handleSubmit } = methods;

  const onSubmit = handleSubmit(async (data) => {
    const isOpenInvitation =
      invitationPreview?.valid === true && invitationPreview.email == null;
    if (isOpenInvitation && !data.acceptInvitation) {
      toast.error(m.invitation_accept_required());
      return;
    }
    const isCoachInvitation = invitationPreview?.kind === 'COACH';
    const inviteToken = rawInvitationToken;
    const submitData = {
      ...data,
      invitationToken: !isCoachInvitation
        ? inviteToken || undefined
        : undefined,
      coachInvitationToken: isCoachInvitation
        ? inviteToken || undefined
        : undefined,
      acceptInvitation: isOpenInvitation ? true : undefined,
      // Emails, starting with the welcome one, follow the app's language
      language: currentLanguage(),
    };
    createAccountMutation.mutate(submitData);
  });

  const invitationTokenValue = rawInvitationToken;
  const invitationReturnPath = invitationTokenValue
    ? getPath(['auth', 'invitation'])
    : undefined;
  const rosterReturnPath =
    invitationPreview?.kind === 'COACH' &&
    (invitationPreview.purpose === 'SHARE' ||
      invitationPreview.purpose === 'TRANSFER')
      ? `${getPath(['dashboard', 'settings'])}?tab=invitations`
      : undefined;

  useEffect(() => {
    if (returnTo) {
      rememberReturnTo(returnTo);
    } else if (rawInvitationToken && rosterReturnPath) {
      rememberReturnTo(rosterReturnPath);
    } else if (rawInvitationToken) {
      clearReturnTo();
    }
  }, [returnTo, rawInvitationToken, rosterReturnPath]);
  const isOpenInvitation =
    invitationPreview?.valid === true && invitationPreview.email == null;
  const acceptsOpenInvitation = methods.watch('acceptInvitation');
  const loginReturnPath = rosterReturnPath ?? invitationReturnPath;
  const loginUrl = loginReturnPath
    ? `${getPath(['auth', 'login'])}?returnTo=${encodeURIComponent(loginReturnPath)}`
    : getPath(['auth', 'login']);

  if (signupBlocked) {
    return (
      <div
        className={cn('flex flex-col gap-6 text-center', className)}
        data-signup-blocked={signup}
      >
        <h1 className="text-2xl font-bold">{m.create_an_account()}</h1>
        <p className="text-muted-foreground text-sm text-balance">
          {signup === 'closed'
            ? m.signup_closed_message()
            : m.signup_invite_only_message()}
        </p>
        <div className="text-sm">
          {m.already_have_account()}{' '}
          <Link to="/auth/login" className="underline underline-offset-4">
            {m.login()}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <FormProvider
      methods={methods}
      onSubmit={onSubmit}
      className={cn('flex flex-col gap-6', className)}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">{m.create_an_account()}</h1>
        <p className="text-muted-foreground text-sm text-balance">
          {invitationEmail
            ? m.create_account_from_invitation()
            : m.enter_details_to_create_account()}
        </p>
      </div>
      {isVerifyingInvitation && (
        <p className="text-sm text-muted-foreground text-center">
          {m.verifying_invitation()}
        </p>
      )}
      {invitationCheckFailed && (
        <p role="alert" className="text-sm text-destructive">
          {m.invitation_preview_invalid()}
        </p>
      )}
      {isOpenInvitation && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">
            {invitationPreview?.kind === 'COACH' &&
            invitationPreview.purpose === 'PERSONAL'
              ? m.invitation_preview_coach_personal()
              : invitationPreview?.kind === 'COACH' &&
                  invitationPreview.purpose === 'COLLEAGUE'
                ? m.invitation_preview_coach_colleague()
                : invitationPreview?.kind === 'COACH' &&
                    invitationPreview.purpose === 'TRANSFER'
                  ? m.invitation_preview_coach_transfer()
                  : invitationPreview?.kind === 'COACH' &&
                      invitationPreview.purpose === 'SHARE'
                    ? m.invitation_preview_coach_share()
                    : m.invitation_preview_athlete()}
          </p>
          <RHFCheckbox name="acceptInvitation" label={m.invitation_accept()} />
        </div>
      )}
      <div className="grid gap-6">
        <RHFTextField
          name="firstName"
          type="text"
          placeholder={m.first_name_placeholder()}
          label={m.first_name()}
          required
        />
        <RHFTextField
          name="lastName"
          type="text"
          placeholder={m.last_name_placeholder()}
          label={m.last_name()}
          required
        />
        <RHFTextField
          name="email"
          type="email"
          placeholder={m.email_placeholder()}
          label={m.email()}
          required
          disabled={!!invitationEmail}
        />
        <RHFTextField
          name="password"
          type="password"
          required
          label={m.password()}
        />
        {instance?.personalEmails && (
          <RHFCheckbox name="emailNews" label={m.signup_email_news()} />
        )}
        <Button
          type="submit"
          className="w-full"
          onClick={onSubmit}
          isLoading={
            createAccountMutation.isPending ||
            loginMutation.isPending ||
            isVerifyingInvitation ||
            invitationCheckFailed ||
            (isOpenInvitation && !acceptsOpenInvitation)
          }
        >
          {m.create_account()}
        </Button>
        {!rawInvitationToken && (
          <OAuthButtons
            redirectTo={rosterReturnPath ?? getPath(['dashboard'])}
          />
        )}
        {rawInvitationToken &&
          !isVerifyingInvitation &&
          invitationPreview?.valid && (
            <p className="text-center text-sm text-muted-foreground">
              {m.invitation_provider_signup_unavailable()}
            </p>
          )}
      </div>
      <div className="text-center text-sm">
        {m.already_have_account()}{' '}
        <Link to={loginUrl} className="underline underline-offset-4">
          {m.login()}
        </Link>
      </div>
    </FormProvider>
  );
}
