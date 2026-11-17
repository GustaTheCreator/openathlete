// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AthleteAPI } from './athlete.api';
import { useGetMyCoachedAthletesQuery } from './athlete.hooks';

const auth = vi.hoisted(() => ({ roles: undefined as string[] | undefined }));
vi.mock('@/contexts/auth', () => ({ useUserRoles: () => auth.roles }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const renderQuery = async (enabled?: boolean) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  function Probe() {
    useGetMyCoachedAthletesQuery({ enabled });
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return {
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
};

describe('useGetMyCoachedAthletesQuery role access', () => {
  let cleanup: (() => void)[];
  let getCoachedAthletes: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup = [];
    auth.roles = undefined;
    getCoachedAthletes = vi
      .spyOn(AthleteAPI, 'getCoachedAthletes')
      .mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup.forEach((dispose) => dispose());
    vi.restoreAllMocks();
  });

  it.each([
    ['no authenticated user', undefined, false],
    ['ATHLETE only', ['ATHLETE'], false],
    ['SUPER_ADMIN only', ['SUPER_ADMIN'], false],
    ['COACH', ['COACH'], true],
    ['ATHLETE and COACH', ['ATHLETE', 'COACH'], true],
    ['SUPER_ADMIN and COACH', ['SUPER_ADMIN', 'COACH'], true],
  ])('%s', async (_name, roles, shouldFetch) => {
    auth.roles = roles as string[] | undefined;
    const view = await renderQuery();
    cleanup.push(view.cleanup);

    if (shouldFetch)
      await vi.waitFor(() => expect(getCoachedAthletes).toHaveBeenCalledOnce());
    else await act(() => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(getCoachedAthletes).toHaveBeenCalledTimes(shouldFetch ? 1 : 0);
  });

  it('preserves an explicit disabled option for coaches', async () => {
    auth.roles = ['COACH'];
    const view = await renderQuery(false);
    cleanup.push(view.cleanup);

    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(getCoachedAthletes).not.toHaveBeenCalled();
  });
});
