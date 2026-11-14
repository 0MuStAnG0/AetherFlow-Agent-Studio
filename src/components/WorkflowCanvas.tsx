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
import type { AgentNodeData, AgentRole, WorkflowEdge, WorkflowNode } from '../types/workflow';
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
  selectedNodeId: string | null;
  showMiniMap?: boolean;
  gridVariant?: 'dots' | 'lines' | 'cross';
  onNodesChange: (changes: NodeChange<Node<AgentNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onConnect: (connection: Connection) => void;
  onSelectNode: (nodeId: string | null) => void;
  onEditNode?: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDropTemplate: (role: AgentRole, position: { x: number; y: number }) => void;
}

export function WorkflowCanvas({
  nodes,
  edges,
  activeNodeId,
  waitingNodeId,
  selectedNodeId,
  showMiniMap = true,
  gridVariant = 'dots',
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectNode,
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
                : 'idle',
        },
      })),
    [nodes, selectedNodeId, waitingNodeId, activeNodeId],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: '#64748b',
        },
        style: { strokeWidth: 1.75, stroke: e.animated ? '#2563eb' : '#94a3b8' },
        labelStyle: { fontSize: 11, fill: '#475569', fontWeight: 500 },
        labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9 },
      })),
    [edges],
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

  return (
    <div
      className="relative h-full w-full bg-slate-50 dark:bg-slate-950"
      dir="ltr"
      data-testid="workflow-canvas"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
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
          onNodeClick={(_evt, node) => onSelectNode(node.id)}
          onPaneClick={() => onSelectNode(null)}
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
