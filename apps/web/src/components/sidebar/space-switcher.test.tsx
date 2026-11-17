// @vitest-environment jsdom
import { SidebarProvider } from '@/components/ui/sidebar';
import { SpaceProvider, useSpaceContext } from '@/contexts/space';
import { CURRENT_SPACE, setItem } from '@/utils/local-storage';
import { waitUntil } from '@/utils/test/wait-until';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpaceSwitcher } from './space-switcher';

const auth = vi.hoisted(() => ({ roles: ['ATHLETE', 'COACH'] as string[] }));
vi.mock('@/contexts/auth', () => ({ useUserRoles: () => auth.roles }));
vi.mock('@/paraglide/messages', () => ({
  m: {
    my_training: () => 'My training',
    my_athletes: () => 'My athletes',
    spaces: () => 'Spaces',
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function CurrentSpace() {
  const { space } = useSpaceContext();
  return <output>{space}</output>;
}

describe('SpaceSwitcher', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <SpaceProvider>
              <SidebarProvider>
                <CurrentSpace />
                <SpaceSwitcher />
              </SidebarProvider>
            </SpaceProvider>
          ),
        },
      ],
      { initialEntries: ['/'] },
    );
    await act(async () => root.render(<RouterProvider router={router} />));
  };

  beforeEach(() => {
    auth.roles = ['ATHLETE', 'COACH'];
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('offers only personal and coaching areas for a dual-role admin', async () => {
    auth.roles = ['ATHLETE', 'COACH', 'SUPER_ADMIN'];
    setItem(CURRENT_SPACE, 'ATHLETE');
    await render();
    const trigger = container.querySelector('button');
    expect(trigger?.textContent).toContain('My training');
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
    });
    await waitUntil(() => document.body.querySelector('[role="menuitem"]'));
    expect(document.body.textContent).toContain('My athletes');
    expect(document.body.textContent).not.toContain('SUPER_ADMIN');
  });

  it('keeps a coach-only user in coaching space without athletes', async () => {
    auth.roles = ['COACH'];
    setItem(CURRENT_SPACE, 'ATHLETE');
    await render();
    expect(container.querySelector('output')?.textContent).toBe('COACH');
    expect(localStorage.getItem(CURRENT_SPACE)).toBe('COACH');
    expect(container.querySelector('button')).toBeNull();
  });

  it('does not render a sports selector for an admin-only account', async () => {
    auth.roles = ['SUPER_ADMIN'];
    await render();
    expect(container.querySelector('output')?.textContent).toBe('SUPER_ADMIN');
    expect(container.querySelector('button')).toBeNull();
  });
});
