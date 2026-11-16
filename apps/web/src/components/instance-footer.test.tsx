// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstanceFooter } from './instance-footer';

vi.mock('@/paraglide/messages', () => ({
  m: { footer_privacy: () => 'Privacy', footer_source: () => 'Source code' },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Instance footer', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    vi.unstubAllEnvs();
  });

  it('links to the configured source revision', async () => {
    vi.stubEnv(
      'VITE_SOURCE_CODE_URL',
      'https://github.com/GustaTheCreator/openathlete/tree/tourmalet-v1.6.1',
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root.render(<InstanceFooter />));

    expect(container.querySelector('a:last-child')?.getAttribute('href')).toBe(
      'https://github.com/GustaTheCreator/openathlete/tree/tourmalet-v1.6.1',
    );
  });

  it('keeps the current source link when no release URL is configured', async () => {
    vi.stubEnv('VITE_SOURCE_CODE_URL', '');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root.render(<InstanceFooter />));

    expect(container.querySelector('a:last-child')?.getAttribute('href')).toBe(
      'https://github.com/GustaTheCreator/openathlete/tree/tourmalet-2026.11.16.1',
    );
  });
});
