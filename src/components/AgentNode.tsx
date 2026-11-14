import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentNodeData } from '../types/workflow';

const ROLE_LABELS: Record<AgentNodeData['role'], string> = {
  manager: 'Manager',
  backend: 'Backend',
  frontend: 'Frontend',
  security_qa: 'Security & QA',
  executor: 'Executor',
  custom: 'Custom Agent',
};

const PROVIDER_LABELS: Record<AgentNodeData['provider'], string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Claude',
  ollama: 'Ollama',
  opencode: 'OpenCode',
};

export const AgentNode = memo(function AgentNode({
  data,
  selected,
}: NodeProps & { data: AgentNodeData }) {
  const enabledTools = [
    data.tools.readFile ? 'Read' : null,
    data.tools.writeFile ? 'Write' : null,
    data.tools.execBash ? 'Bash' : null,
  ].filter(Boolean);

  const isSpeaking = data.status === 'speaking';
  const isWaiting = data.status === 'waiting_approval';
  const isError = data.status === 'error';

  let borderClass = 'border-slate-200 dark:border-slate-800';
  if (selected) {
    borderClass = 'border-blue-600 ring-2 ring-blue-600/20 dark:border-blue-500';
  } else if (isWaiting) {
    borderClass = 'border-amber-500 ring-2 ring-amber-500/20';
  } else if (isSpeaking) {
    borderClass = 'border-emerald-600 ring-2 ring-emerald-600/20';
  } else if (isError) {
    borderClass = 'border-red-600 ring-2 ring-red-600/20';
  }

  return (
    <div
      className={`w-[248px] rounded-xl border bg-white px-4 py-3.5 text-left transition-shadow dark:bg-slate-900 ${borderClass} shadow-sm`}
      data-testid={`agent-node-${data.role}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400 dark:!border-slate-900 dark:!bg-slate-500"
      />

      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-700 dark:text-slate-300">
          {ROLE_LABELS[data.role]}
        </span>
        <span className="font-mono tabular-nums">
          T={Number(data.temperature ?? 0.2).toFixed(2)}
        </span>
      </div>

      <div className="mt-1 truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
        {data.label}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
        <span>{PROVIDER_LABELS[data.provider]}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate font-mono text-[11px]">{data.model}</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="truncate">
          {enabledTools.length > 0 ? `Tools: ${enabledTools.join(' · ')}` : 'Tools: None'}
        </span>
        {isSpeaking && (
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Active</span>
        )}
        {isWaiting && (
          <span className="font-medium text-amber-700 dark:text-amber-400">Approval</span>
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
