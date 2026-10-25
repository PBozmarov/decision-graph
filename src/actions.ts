import { createContext, useContext } from 'react';
import type { Item, Kind } from './model';

export type Actions = {
  add: (parentId: string, kind: Kind) => void;
  update: (id: string, patch: Partial<Item>) => void;
  select: (id: string) => void;
};

export const ActionsContext = createContext<Actions | null>(null);
export const useActions = () => useContext(ActionsContext)!;
