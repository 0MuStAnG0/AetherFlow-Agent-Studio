import { createContext, useContext } from 'react';

export interface CanvasNodeActions {
  lang?: 'en' | 'fa';
  onEditNode?: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDismissAgentError?: (nodeId: string) => void;
  onReopenAgentError?: (nodeId: string) => void;
  onInspectAgentError?: (nodeId: string) => void;
}

export const CanvasActionsContext = createContext<CanvasNodeActions>({});

export function useCanvasActions() {
  return useContext(CanvasActionsContext);
}
