import { useCallback, useMemo, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch, Trash2, X } from 'lucide-react';
import type {
  AgentNodeData,
  AgentRole,
  EdgeConditionType,
  WorkflowEdge,
  WorkflowNode,
} from '../types/workflow';
import { getDefaultEdgeLabelForCondition } from '../utils/workflowEngine';
import { AgentNode } from './AgentNode';
import { CanvasActionsContext } from './CanvasActionsContext';

const nodeTypes = {
  agentNode: AgentNode,
};

interface WorkflowCanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  activeNodeId: string | null;
  waitingNodeId: string | null;
  completedNodeIds?: Set<string>;
  errorNodeIds?: Set<string>;
  selectedNodeId: string | null;
  selectedEdgeId?: string | null;
  lang?: 'en' | 'fa';
  showMiniMap?: boolean;
  gridVariant?: 'dots' | 'lines' | 'cross';
  onNodesChange: (changes: NodeChange<Node<AgentNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onConnect: (connection: Connection) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge?: (edgeId: string | null) => void;
  onUpdateEdge?: (edgeId: string, patch: Partial<WorkflowEdge>) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onEditNode?: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDropTemplate: (role: AgentRole, position: { x: number; y: number }) => void;
}

const CONDITION_COLORS: Record<EdgeConditionType, string> = {
  always: '#94a3b8',
  on_success: '#16a34a',
  on_failure: '#dc2626',
  when_contains: '#d97706',
};

export function WorkflowCanvas({
  nodes,
  edges,
  activeNodeId,
  waitingNodeId,
  completedNodeIds,
  errorNodeIds,
  selectedNodeId,
  selectedEdgeId = null,
  lang = 'en',
  showMiniMap = true,
  gridVariant = 'dots',
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectNode,
  onSelectEdge,
  onUpdateEdge,
  onDeleteEdge,
  onEditNode,
  onDuplicateNode,
  onDeleteNode,
  onDropTemplate,
}: WorkflowCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const canvasActions = useMemo(
    () => ({ onEditNode, onDuplicateNode, onDeleteNode }),
    [onEditNode, onDuplicateNode, onDeleteNode],
  );

  const selectedEdge = useMemo(
    () => (selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) ?? null : null),
    [edges, selectedEdgeId],
  );

  const nodeLabelById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.data.label])),
    [nodes],
  );

  const rfNodes: Node<AgentNodeData>[] = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        data: {
          ...n.data,
          status:
            waitingNodeId === n.id
              ? 'waiting_approval'
              : activeNodeId === n.id
                ? 'speaking'
                : errorNodeIds?.has(n.id)
                  ? 'error'
                  : completedNodeIds?.has(n.id)
                    ? 'done'
                    : 'idle',
        },
      })),
    [nodes, selectedNodeId, waitingNodeId, activeNodeId, errorNodeIds, completedNodeIds],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const condType: EdgeConditionType = e.conditionType ?? 'always';
        const isEdgeSelected = e.id === selectedEdgeId;
        const strokeColor = isEdgeSelected
          ? '#2563eb'
          : condType !== 'always'
            ? CONDITION_COLORS[condType]
            : e.animated
              ? '#2563eb'
              : CONDITION_COLORS.always;
        const displayLabel =
          e.label ||
          (condType !== 'always'
            ? getDefaultEdgeLabelForCondition(condType, e.conditionValue)
            : undefined);

        return {
          ...e,
          selected: isEdgeSelected,
          label: displayLabel,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: strokeColor,
          },
          style: {
            strokeWidth: isEdgeSelected ? 2.5 : condType !== 'always' ? 2 : 1.75,
            stroke: strokeColor,
          },
          labelStyle: {
            fontSize: 11,
            fill: condType !== 'always' ? strokeColor : '#475569',
            fontWeight: 600,
          },
          labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.92 },
        };
      }),
    [edges, selectedEdgeId],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<AgentNodeData>>[]) => {
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes);
    },
    [onEdgesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      onConnect(connection);
    },
    [onConnect],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const role = event.dataTransfer.getData('application/aetherflow-role') as AgentRole;
      if (!role) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      onDropTemplate(role, position);
    },
    [screenToFlowPosition, onDropTemplate],
  );

  const isFa = lang === 'fa';

  return (
    <div
      className="relative h-full w-full bg-slate-50 dark:bg-slate-950"
      dir="ltr"
      data-testid="workflow-canvas"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {selectedEdge && onUpdateEdge && (
        <div
          data-testid="edge-condition-editor"
          dir={isFa ? 'rtl' : 'ltr'}
          className="absolute left-1/2 top-3 z-20 flex w-max max-w-[96%] -translate-x-1/2 flex-nowrap items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 px-3 py-1.5 text-xs shadow-md backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95"
        >
          <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="max-w-[140px] truncate">
              {nodeLabelById.get(selectedEdge.source) ?? selectedEdge.source} →{' '}
              {nodeLabelById.get(selectedEdge.target) ?? selectedEdge.target}
            </span>
          </span>

          <select
            aria-label={isFa ? 'شرط مسیر' : 'Edge Routing Condition'}
            data-testid="edge-condition-type-select"
            value={selectedEdge.conditionType ?? 'always'}
            onChange={(e) => {
              const nextType = e.target.value as EdgeConditionType;
              onUpdateEdge(selectedEdge.id, {
                conditionType: nextType,
                label: getDefaultEdgeLabelForCondition(nextType, selectedEdge.conditionValue),
              });
            }}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="always">{isFa ? 'همیشه (پیش‌فرض)' : 'Always (Default)'}</option>
            <option value="on_success">{isFa ? 'در صورت موفقیت' : 'On Success'}</option>
            <option value="on_failure">{isFa ? 'در صورت خطا / رد' : 'On Failure / Error'}</option>
            <option value="when_contains">{isFa ? 'اگر خروجی شامل کلمه بود' : 'When Output Contains'}</option>
          </select>

          {(selectedEdge.conditionType ?? 'always') === 'when_contains' && (
            <input
              type="text"
              aria-label={isFa ? 'کلمه کلیدی شرط' : 'Condition Keyword'}
              data-testid="edge-condition-value-input"
              value={selectedEdge.conditionValue ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                onUpdateEdge(selectedEdge.id, {
                  conditionValue: val,
                  label: getDefaultEdgeLabelForCondition('when_contains', val),
                });
              }}
              placeholder={isFa ? 'مثلاً: APPROVED' : 'e.g. APPROVED'}
              className="w-28 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          )}

          <input
            type="text"
            aria-label={isFa ? 'برچسب مسیر' : 'Edge Label'}
            data-testid="edge-label-input"
            value={selectedEdge.label ?? ''}
            onChange={(e) => onUpdateEdge(selectedEdge.id, { label: e.target.value })}
            placeholder={isFa ? 'برچسب...' : 'Label...'}
            className="w-24 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />

          {onDeleteEdge && (
            <button
              type="button"
              aria-label="Delete edge"
              data-testid="edge-delete-btn"
              onClick={() => onDeleteEdge(selectedEdge.id)}
              className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              <Trash2 className="h-3 w-3" />
              <span>{isFa ? 'حذف' : 'Delete'}</span>
            </button>
          )}

          <button
            type="button"
            aria-label="Close edge editor"
            onClick={() => onSelectEdge?.(null)}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-xl border border-dashed border-slate-300 bg-white/95 p-6 text-center dark:border-slate-700 dark:bg-slate-900/95">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Empty Multi-Agent Canvas
            </h3>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              Click or drag an Agent Role Template from the left library to begin wiring your GroupChat graph.
            </p>
          </div>
        </div>
      )}

      <CanvasActionsContext.Provider value={canvasActions}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeClick={(_evt, node) => {
            onSelectEdge?.(null);
            onSelectNode(node.id);
          }}
          onEdgeClick={(_evt, edge) => {
            onSelectNode(null);
            onSelectEdge?.(edge.id);
          }}
          onPaneClick={() => {
            onSelectNode(null);
            onSelectEdge?.(null);
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background
            variant={
              gridVariant === 'lines'
                ? BackgroundVariant.Lines
                : gridVariant === 'cross'
                  ? BackgroundVariant.Cross
                  : BackgroundVariant.Dots
            }
            gap={20}
            size={1}
            color="#cbd5e1"
            className="dark:opacity-30"
          />
          <Controls />
          {showMiniMap && (
            <MiniMap
              pannable
              zoomable
              nodeColor={() => '#2563eb'}
              maskColor="rgba(15, 23, 42, 0.08)"
            />
          )}
        </ReactFlow>
      </CanvasActionsContext.Provider>
    </div>
  );
}
