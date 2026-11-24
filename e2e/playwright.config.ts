import { defineConfig, devices } from '@playwright/test';

import { WEB_URL } from './support/env';

const isCI = Boolean(process.env.CI);
const webOrigin = new URL(WEB_URL);

export default defineConfig({
  globalSetup: './global-setup.ts',
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  failOnFlakyTests: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        [
          'json',
          {
            outputFile:
              process.env.E2E_JSON_REPORT ?? 'playwright-results.json',
          },
        ],
      ]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    locale: 'en-US',
    // Most specs assert English copy and start signed out. The defaults
    // tests explicitly request a context without saved preferences.
    storageState: {
      cookies: [
        {
          name: 'OA_LOCALE',
          value: 'en',
          domain: webOrigin.hostname,
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: webOrigin.protocol === 'https:',
          sameSite: 'Lax',
        },
      ],
      origins: [
        {
          origin: webOrigin.origin,
          localStorage: [{ name: 'theme', value: 'light' }],
        },
      ],
    },
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // testMatch runs against absolute paths: anchor on tests/ so a checkout
  // in a folder named like a project ("…-mobile/") selects nothing extra
  projects: [
    { name: 'auth-form', testMatch: /auth\.setup\.ts/ },
    { name: 'api', testMatch: /tests\/api\/.*\.spec\.ts$/ },
    {
      name: 'desktop',
      testMatch: /tests\/web\/.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /tests\/mobile\/.*\.spec\.ts$/,
      // The iPhone viewport and touch input, rendered by Chromium
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
      },
    },
    {
      // The same phone tests on an Android phone: its own viewport, screen
      // density and user agent
      name: 'android',
      testMatch: /tests\/mobile\/.*\.spec\.ts$/,
      use: { ...devices['Pixel 8'] },
    },
  ],
});
