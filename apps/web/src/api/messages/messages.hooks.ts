import {
  MutationOptions,
  QueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { CreateMessageThreadDto } from '@openathlete/shared';

import { MessagesAPI } from './messages.api';
import { messagesKeys } from './messages.keys';

// ==================== Thread Hooks ====================

export const useGetUserThreadsQuery = (
  opt?: QueryOptions<Awaited<ReturnType<typeof MessagesAPI.getUserThreads>>> & {
    enabled?: boolean;
  },
) =>
  useQuery({
    ...opt,
    queryFn: MessagesAPI.getUserThreads,
    queryKey: messagesKeys.getUserThreads,
  });

export const useGetThreadQuery = (
  threadId: number,
  opt?: QueryOptions<Awaited<ReturnType<typeof MessagesAPI.getThread>>>,
) =>
  useQuery({
    ...opt,
    queryFn: () => MessagesAPI.getThread(threadId),
    queryKey: messagesKeys.getThread(threadId),
    enabled: !!threadId,
  });

export const useCreateThreadMutation = (
  opt?: MutationOptions<
    Awaited<ReturnType<typeof MessagesAPI.createThread>>,
    Error,
    CreateMessageThreadDto
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    ...opt,
    mutationFn: MessagesAPI.createThread,
    onSuccess: (data, variables, onMutateResult, context) => {
      if (opt?.onSuccess)
        opt.onSuccess(data, variables, onMutateResult, context);
      queryClient.invalidateQueries({
        queryKey: messagesKeys.getUserThreads,
      });
    },
  });
};

export const useDeleteThreadMutation = (
  opt?: MutationOptions<
    Awaited<ReturnType<typeof MessagesAPI.deleteThread>>,
    Error,
    number
  >,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    ...opt,
    mutationFn: MessagesAPI.deleteThread,
    onSuccess: (data, variables, onMutateResult, context) => {
      if (opt?.onSuccess)
        opt.onSuccess(data, variables, onMutateResult, context);
      queryClient.invalidateQueries({
        queryKey: messagesKeys.getUserThreads,
      });
    },
  });
};

// ==================== Message Hooks ====================

export const useGetThreadMessagesQuery = (
  threadId: number,
  opt?: QueryOptions<Awaited<ReturnType<typeof MessagesAPI.getThreadMessages>>>,
) =>
  useQuery({
    ...opt,
    queryFn: () => MessagesAPI.getThreadMessages(threadId),
    queryKey: messagesKeys.getThreadMessages(threadId),
    enabled: !!threadId,
  });
