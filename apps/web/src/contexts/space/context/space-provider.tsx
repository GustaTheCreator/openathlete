import { useUserRoles } from '@/contexts/auth';
import { getPath } from '@/routes/paths';
import {
  CURRENT_SPACE,
  getItem,
  removeItem,
  setItem,
} from '@/utils/local-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { SportRole, getSportsRoles } from '@openathlete/shared';

import { SpaceContextType } from '../types';
import { SpaceContext } from './space-context';

type Props = {
  children: React.ReactNode;
};

export function SpaceProvider({ children }: Props) {
  const roles = useUserRoles();
  const sportsRoles = useMemo(() => getSportsRoles(roles ?? []), [roles]);
  const [currentSpace, setCurrentSpace] = useState<SportRole | 'SUPER_ADMIN'>(
    () => {
      const storedSpace = getItem(CURRENT_SPACE);
      return sportsRoles.includes(storedSpace as SportRole)
        ? (storedSpace as SportRole)
        : (sportsRoles[0] ??
            (roles?.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' : 'ATHLETE'));
    },
  );
  const nav = useNavigate();

  useEffect(() => {
    if (!roles) return;
    const storedSpace = getItem(CURRENT_SPACE);
    const nextSpace: SportRole | 'SUPER_ADMIN' = sportsRoles.includes(
      storedSpace as SportRole,
    )
      ? (storedSpace as SportRole)
      : (sportsRoles[0] ??
        (roles.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' : 'ATHLETE'));
    setCurrentSpace(nextSpace);
    if (sportsRoles.length === 0 && roles.includes('SUPER_ADMIN')) {
      removeItem(CURRENT_SPACE);
    } else if (nextSpace !== storedSpace) {
      setItem(CURRENT_SPACE, nextSpace);
    }
  }, [roles, sportsRoles]);

  const handleSpaceChange = useCallback(
    (space: SportRole) => {
      if (!sportsRoles.includes(space)) return;
      setCurrentSpace(space);
      setItem(CURRENT_SPACE, space);
      if (space === 'COACH') {
        nav(getPath(['dashboard', 'coach']));
      } else {
        nav(getPath(['dashboard', 'calendar']));
      }
    },
    [nav, sportsRoles],
  );

  const memoizedValue = useMemo<SpaceContextType>(
    () => ({
      space: currentSpace,
      setSpace: handleSpaceChange,
    }),
    [currentSpace, handleSpaceChange],
  );

  if (!roles) return null;

  return (
    <SpaceContext.Provider value={memoizedValue}>
      {children}
    </SpaceContext.Provider>
  );
}
