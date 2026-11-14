import { createContext, useContext } from 'react';

export interface CanvasNodeActions {
  onEditNode?: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
}

export const CanvasActionsContext = createContext<CanvasNodeActions>({});

export function useCanvasActions() {
  return useContext(CanvasActionsContext);
}
