import { request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { apiHeaders } from './support/api';
import { API_URL, WEB_URL } from './support/env';

const LOCAL_API = 'http://localhost:13000';
const LOCAL_WEB = 'http://localhost:18080';

export default async function globalSetup() {
  if (
    API_URL !== LOCAL_API ||
    WEB_URL !== LOCAL_WEB ||
    process.env.E2E_API_URL ||
    process.env.E2E_WEB_URL ||
    process.env.DOCKER_HOST ||
    process.env.DOCKER_CONTEXT ||
    process.env.COMPOSE_PROJECT_NAME
  ) {
    return;
  }

  const context = await request.newContext();
  const email = `e2e-admin-${randomUUID()}@example.com`;
  const password = `${randomUUID()}A1!`;
  try {
    const created = await context.post(`${API_URL}/user`, {
      headers: apiHeaders(),
      data: { email, password, firstName: 'E2E', lastName: 'Admin' },
    });
    if (!created.ok())
      throw new Error(`E2E admin signup failed: ${await created.text()}`);
    const { userId } = (await created.json()) as { userId: number };

    execFileSync(
      'docker',
      [
        'compose',
        '--project-name',
        'openathlete-e2e',
        '-f',
        'docker-compose.yml',
        'exec',
        '-T',
        'api',
        'openathlete',
        'bootstrap-super-admin',
        String(userId),
        email,
        '--apply',
      ],
      { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: 'pipe' },
    );

    process.env.E2E_ADMIN_EMAIL = email;
    process.env.E2E_ADMIN_PASSWORD = password;
  } finally {
    await context.dispose();
  }
}
