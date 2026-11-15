import { memo } from 'react';
import { CopyPlus, Pencil, Trash2 } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { POWER_LEVEL_META } from '../data/agentTemplates';
import type { AgentNodeData, AgentPowerLevel } from '../types/workflow';
import { useCanvasActions } from './CanvasActionsContext';

const ROLE_LABELS: Record<AgentNodeData['role'], string> = {
  manager: 'Manager',
  backend: 'Backend',
  frontend: 'Frontend',
  security_qa: 'Security & QA',
  executor: 'Executor',
  custom: 'Specialist',
};

const PROVIDER_LABELS: Record<AgentNodeData['provider'], string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Claude',
  ollama: 'Ollama',
  opencode: 'OpenCode',
};

const POWER_STYLES: Record<AgentPowerLevel, string> = {
  eco: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  standard: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  pro: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  ultra: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
};

export const AgentNode = memo(function AgentNode({
  id,
  data,
  selected,
}: NodeProps & { data: AgentNodeData }) {
  const { onEditNode, onDuplicateNode, onDeleteNode } = useCanvasActions();

  const enabledTools = [
    data.tools.readFile ? 'Read' : null,
    data.tools.writeFile ? 'Write' : null,
    data.tools.execBash ? 'Bash' : null,
  ].filter(Boolean);

  const isSpeaking = data.status === 'speaking';
  const isWaiting = data.status === 'waiting_approval';
  const isError = data.status === 'error';
  const isDone = data.status === 'done';
  const power: AgentPowerLevel = data.powerLevel ?? 'standard';

  let borderClass = 'border-slate-200 dark:border-slate-800';
  if (selected) {
    borderClass = 'border-blue-600 ring-2 ring-blue-600/20 dark:border-blue-500';
  } else if (isWaiting) {
    borderClass = 'border-amber-500 ring-2 ring-amber-500/20';
  } else if (isSpeaking) {
    borderClass = 'border-emerald-600 ring-2 ring-emerald-600/20';
  } else if (isError) {
    borderClass = 'border-red-600 ring-2 ring-red-600/20';
  } else if (isDone) {
    borderClass = 'border-emerald-500/70 dark:border-emerald-600/70';
  }

  return (
    <div
      className={`group w-[264px] rounded-xl border bg-white px-4 py-3 text-left transition-shadow dark:bg-slate-900 ${borderClass} shadow-sm`}
      data-testid={`agent-node-${data.role}`}
      data-status={data.status ?? 'idle'}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 dark:!border-slate-900 dark:!bg-slate-500"
      />

      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="truncate font-medium text-slate-700 dark:text-slate-300">
          {data.section || ROLE_LABELS[data.role]}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${POWER_STYLES[power]}`}
            title={`Power: ${POWER_LEVEL_META[power].en}`}
          >
            {POWER_LEVEL_META[power].short}
          </span>
          <div
            className={`nodrag nopan flex items-center gap-0.5 transition-opacity ${
              selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            }`}
          >
            {onEditNode && (
              <button
                type="button"
                aria-label={`Edit ${data.label}`}
                title="Edit Agent"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditNode(id);
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {onDuplicateNode && (
              <button
                type="button"
                aria-label={`Duplicate ${data.label}`}
                title="Duplicate (+1 Agent)"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicateNode(id);
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800 dark:hover:text-emerald-400"
              >
                <CopyPlus className="h-3 w-3" />
              </button>
            )}
            {onDeleteNode && (
              <button
                type="button"
                aria-label={`Delete node ${data.label}`}
                title="Delete Agent"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteNode(id);
                }}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-1 truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
        {data.label}
      </div>

      {data.positionTitle && (
        <div className="mt-0.5 truncate text-[11px] font-medium text-blue-700 dark:text-blue-400">
          {data.positionTitle}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
        <span>{PROVIDER_LABELS[data.provider]}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate font-mono text-[11px]">{data.model}</span>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="truncate">
          {enabledTools.length > 0 ? `Tools: ${enabledTools.join(' · ')}` : 'Tools: None'}
        </span>
        <span className="font-mono tabular-nums text-[10px]">
          T={Number(data.temperature ?? 0.2).toFixed(2)}
        </span>
        {isSpeaking && (
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Active</span>
        )}
        {isWaiting && (
          <span className="font-medium text-amber-700 dark:text-amber-400">Approval</span>
        )}
        {isError && (
          <span className="font-medium text-red-700 dark:text-red-400">Error</span>
        )}
        {isDone && (
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Done</span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-blue-600 dark:!border-slate-900 dark:!bg-blue-500"
      />
    </div>
  );
});
