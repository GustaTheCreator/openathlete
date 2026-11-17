import { SportRole } from '@openathlete/shared';

export type SpaceContextType = {
  space: SportRole | 'SUPER_ADMIN';
  setSpace: (space: SportRole) => void;
};
