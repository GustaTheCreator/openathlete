import { setAccessToken, setRefreshToken } from '@/utils/auth';
import { MutationOptions, useMutation } from '@tanstack/react-query';

import { AuthAPI } from './auth.api';

export const useLoginMutation = (
  opt?: MutationOptions<
    Awaited<ReturnType<typeof AuthAPI.login>>,
    Error,
    Parameters<typeof AuthAPI.login>[0]
  >,
) => {
  return useMutation({
    ...opt,
    mutationFn: AuthAPI.login,
    onSuccess: (data, variables, onMutateResult, context) => {
      setAccessToken(data.accessToken);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      if (opt?.onSuccess)
        opt.onSuccess(data, variables, onMutateResult, context);
    },
  });
};

export const useLoginWithFirebaseMutation = (
  opt?: MutationOptions<
    Awaited<ReturnType<typeof AuthAPI.loginWithFirebase>>,
    Error,
    Parameters<typeof AuthAPI.loginWithFirebase>[0]
  >,
) => {
  return useMutation({
    ...opt,
    mutationFn: AuthAPI.loginWithFirebase,
    onSuccess: (data, variables, onMutateResult, context) => {
      setAccessToken(data.accessToken);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      if (opt?.onSuccess)
        opt.onSuccess(data, variables, onMutateResult, context);
    },
  });
};

export const useExchangeOidcCodeMutation = (
  opt?: MutationOptions<
    Awaited<ReturnType<typeof AuthAPI.exchangeOidcCode>>,
    Error,
    Parameters<typeof AuthAPI.exchangeOidcCode>[0]
  >,
) => {
  return useMutation({
    ...opt,
    mutationFn: AuthAPI.exchangeOidcCode,
    onSuccess: (data, variables, onMutateResult, context) => {
      setAccessToken(data.accessToken);
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      if (opt?.onSuccess)
        opt.onSuccess(data, variables, onMutateResult, context);
    },
  });
};
