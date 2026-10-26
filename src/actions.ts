import { createContext, useContext, type PointerEvent } from 'react';
import type { Item, Kind } from './model';

export type Actions = {
  add: (parentId: string, kind: Kind) => void;
  update: (id: string, patch: Partial<Item>) => void;
  select: (id: string) => void;
  toggleMenu: (id: string) => void;
  startEdit: (id: string) => void;
  stopEdit: () => void;
  /** Inline-edit keys: Tab = commit + open the add menu. */
  editKey: (id: string, key: 'Enter' | 'Escape' | 'Tab') => void;
  /** Compact view: press on a pill to start dragging it to another card (mouse only). */
  startPillDrag: (id: string, e: PointerEvent<HTMLElement>) => void;
};

export const ActionsContext = createContext<Actions | null>(null);
export const useActions = () => useContext(ActionsContext)!;
