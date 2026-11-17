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
    document
      .querySelector('meta[name="openathlete-source-code-url"]')
      ?.remove();
    vi.unstubAllEnvs();
  });

  function setSourceMeta(content: string) {
    const meta = document.createElement('meta');
    meta.name = 'openathlete-source-code-url';
    meta.content = content;
    document.head.append(meta);
  }

  async function renderFooter() {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<InstanceFooter />));
    return container.querySelector('a:last-child')?.getAttribute('href');
  }

  it('prefers the runtime metadata URL over the build-time value', async () => {
    vi.stubEnv(
      'VITE_SOURCE_CODE_URL',
      'https://github.com/GustaTheCreator/openathlete/tree/old',
    );
    setSourceMeta(
      'https://github.com/GustaTheCreator/openathlete/tree/tourmalet-v1.7.3',
    );

    await expect(renderFooter()).resolves.toBe(
      'https://github.com/GustaTheCreator/openathlete/tree/tourmalet-v1.7.3',
    );
  });

  it('falls back to the build-time value when the runtime placeholder is unresolved', async () => {
    vi.stubEnv(
      'VITE_SOURCE_CODE_URL',
      'https://github.com/GustaTheCreator/openathlete/tree/native-build',
    );
    setSourceMeta('__OPENATHLETE_SOURCE_CODE_URL__');

    await expect(renderFooter()).resolves.toBe(
      'https://github.com/GustaTheCreator/openathlete/tree/native-build',
    );
  });

  it('links to the configured source revision', async () => {
    vi.stubEnv(
      'VITE_SOURCE_CODE_URL',
      'https://github.com/GustaTheCreator/openathlete/tree/tourmalet-v1.6.1',
    );
    await expect(renderFooter()).resolves.toBe(
      'https://github.com/GustaTheCreator/openathlete/tree/tourmalet-v1.6.1',
    );
  });

  it('uses the build-time source URL for native or Vercel builds without runtime metadata', async () => {
    vi.stubEnv(
      'VITE_SOURCE_CODE_URL',
      'https://github.com/GustaTheCreator/openathlete/tree/native-build',
    );

    await expect(renderFooter()).resolves.toBe(
      'https://github.com/GustaTheCreator/openathlete/tree/native-build',
    );
  });

  it('keeps the current source link when no release URL is configured', async () => {
    vi.stubEnv('VITE_SOURCE_CODE_URL', '');
    await expect(renderFooter()).resolves.toBe(
      'https://github.com/GustaTheCreator/openathlete/tree/tourmalet',
    );
  });
});
