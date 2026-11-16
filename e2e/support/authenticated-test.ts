import { test as base } from '@playwright/test';

import { createAthlete } from './api';
import { signIn } from './browser';

/** Give these specs a fresh account and refresh-token family for every test. */
export const test = base.extend<{ authenticated: void }>({
  authenticated: [
    async ({ page, request }, use) => {
      const athlete = await createAthlete(request);
      await signIn(page, athlete);
      await use();
    },
    { auto: true },
  ],
});
