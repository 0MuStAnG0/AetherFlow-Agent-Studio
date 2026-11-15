import type { TokenOptimizationMode, WorkflowNode } from '../types/workflow';
import { POWER_LEVEL_META } from '../data/agentTemplates';

export interface ConversationTurn {
  role: string;
  content: string;
}

export function estimateCharTokens(text: string): number {
  const clean = (text || '').trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 4));
}

export function truncateMiddle(text: string, maxChars: number): string {
  const clean = (text || '').trim();
  if (maxChars <= 24 || clean.length <= maxChars) return clean;
  const headLen = Math.ceil((maxChars - 18) * 0.65);
  const tailLen = Math.max(10, maxChars - 18 - headLen);
  return `${clean.slice(0, headLen).trimEnd()}\n...[trimmed]...\n${clean.slice(-tailLen).trimStart()}`;
}

export function compactPromptText(text: string): string {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Replaces bulky fenced code blocks and WRITE_FILE payloads in historical
 * conversation turns with concise path + line-count placeholders so every
 * subsequent turn does not re-pay thousands of input tokens for code already
 * saved to the sandbox (agents can read_file on demand).
 */
export function compactCodeBlocksInMessage(
  content: string,
  maxKeepLines = 4,
): string {
  if (!content) return '';

  // 1. Collapse explicit WRITE_FILE:<path>\n```...``` blocks
  let compacted = content.replace(
    /WRITE_FILE:([^\n]+)\n```[^\n]*\n([\s\S]*?)```/g,
    (_full, rawPath: string, body: string) => {
      const trimmedBody = body.trimEnd();
      const lineCount = trimmedBody ? trimmedBody.split('\n').length : 0;
      const target = rawPath.trim();
      if (lineCount <= maxKeepLines) {
        return `WRITE_FILE:${target}\n\`\`\`\n${trimmedBody}\n\`\`\``;
      }
      return `[wrote ${target} (${lineCount} lines)]`;
    },
  );

  // 2. Collapse any remaining large fenced code blocks in historical chatter
  compacted = compacted.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_full, lang: string, body: string) => {
    const trimmedBody = body.trimEnd();
    const lines = trimmedBody ? trimmedBody.split('\n') : [];
    if (lines.length <= maxKeepLines) {
      return `\`\`\`${lang}\n${trimmedBody}\n\`\`\``;
    }
    const label = lang.trim() || 'code';
    return `[${label} block omitted (${lines.length} lines); use read_file if needed]`;
  });

  return compactPromptText(compacted);
}

export function compactSandboxOutput(content: string, maxChars = 240): string {
  const lines = (content || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) return '';
  return truncateMiddle(lines.join('\n'), maxChars);
}

export function compactConversationHistory(
  history: ConversationTurn[],
  options: {
    mode?: TokenOptimizationMode;
  } = {},
): {
  messages: ConversationTurn[];
  rawEstimatedTokens: number;
  optimizedEstimatedTokens: number;
  savedTokens: number;
} {
  const mode = options.mode ?? 'ultra_compact';
  const rawText = history.map((m) => `[${m.role.toUpperCase()}]:\n${m.content}`).join('\n\n---\n\n');
  const rawEstimatedTokens = estimateCharTokens(rawText);

  if (mode === 'off' || history.length === 0) {
    return {
      messages: history,
      rawEstimatedTokens,
      optimizedEstimatedTokens: rawEstimatedTokens,
      savedTokens: 0,
    };
  }

  const keepRecentCount = mode === 'ultra_compact' ? 4 : 6;
  const maxHistoricalTurnChars = mode === 'ultra_compact' ? 320 : 600;
  const maxSandboxTurnChars = mode === 'ultra_compact' ? 200 : 360;
  const maxKeepCodeLines = mode === 'ultra_compact' ? 3 : 8;

  // Separate pinned anchors (memory + initial user/task prompt) from conversational turns
  const pinned: ConversationTurn[] = [];
  const rest: ConversationTurn[] = [];

  for (let idx = 0; idx < history.length; idx++) {
    const turn = history[idx];
    const roleLower = turn.role.toLowerCase();
    if (idx === 0 && roleLower === 'memory') {
      pinned.push({
        role: turn.role,
        content: truncateMiddle(turn.content, mode === 'ultra_compact' ? 680 : 1100),
      });
    } else if (
      (idx === 0 || (idx === 1 && history[0]?.role.toLowerCase() === 'memory')) &&
      roleLower === 'user'
    ) {
      pinned.push({
        role: turn.role,
        content: compactPromptText(turn.content),
      });
    } else {
      rest.push(turn);
    }
  }

  const droppedCount = Math.max(0, rest.length - keepRecentCount);
  const recentWindow = rest.slice(-keepRecentCount);

  const compactedRecent = recentWindow.map((turn, idx) => {
    const isLatestTurn = idx === recentWindow.length - 1;
    const roleLower = turn.role.toLowerCase();
    if (roleLower === 'sandbox') {
      return {
        role: turn.role,
        content: compactSandboxOutput(
          turn.content,
          isLatestTurn ? maxSandboxTurnChars + 140 : maxSandboxTurnChars,
        ),
      };
    }

    if (isLatestTurn && roleLower === 'user') {
      return { role: turn.role, content: compactPromptText(turn.content) };
    }

    const strippedCode = compactCodeBlocksInMessage(
      turn.content,
      isLatestTurn ? maxKeepCodeLines + 5 : maxKeepCodeLines,
    );
    const limit = isLatestTurn ? maxHistoricalTurnChars * 2 : maxHistoricalTurnChars;
    return {
      role: turn.role,
      content: truncateMiddle(strippedCode, limit),
    };
  });

  const messages: ConversationTurn[] = [
    ...pinned,
    ...(droppedCount > 0
      ? [
          {
            role: 'context',
            content: `[${droppedCount} earlier turn(s) omitted to save tokens; use read_file for file inspection]`,
          },
        ]
      : []),
    ...compactedRecent,
  ];

  const optimizedText = messages.map((m) => `[${m.role.toUpperCase()}]:\n${m.content}`).join('\n\n---\n\n');
  const optimizedEstimatedTokens = estimateCharTokens(optimizedText);
  const savedTokens = Math.max(0, rawEstimatedTokens - optimizedEstimatedTokens);

  return {
    messages,
    rawEstimatedTokens,
    optimizedEstimatedTokens,
    savedTokens,
  };
}

export function buildCompactSystemPrompt(params: {
  node: WorkflowNode;
  mode?: TokenOptimizationMode;
  nativeToolsEnabled?: boolean;
  isManager?: boolean;
  isGroupDiscussion?: boolean;
  teammates?: string[];
  delegationPhase?: 'test' | 'deploy' | 'review';
}): {
  systemPrompt: string;
  baselineTokens: number;
  optimizedTokens: number;
  savedTokens: number;
} {
  const {
    node,
    mode = 'ultra_compact',
    nativeToolsEnabled = false,
    isManager = false,
    isGroupDiscussion = false,
    teammates = [],
    delegationPhase = 'review',
  } = params;

  const powerKey = node.data.powerLevel ?? 'standard';
  const powerMeta = POWER_LEVEL_META[powerKey] ?? POWER_LEVEL_META.standard;

  // Baseline legacy size estimate for savings telemetry
  const legacyBaselineChars = 980 + (node.data.systemPrompt?.length ?? 0) + (isManager ? 320 : 0);
  const baselineTokens = Math.ceil(legacyBaselineChars / 4);

  const toolsList: string[] = [];
  if (node.data.tools.readFile) {
    toolsList.push(nativeToolsEnabled ? 'read_file' : 'READ_FILE:<path>');
  }
  if (node.data.tools.writeFile) {
    toolsList.push(nativeToolsEnabled ? 'write_file' : 'WRITE_FILE:<path>+```code```');
  }
  if (node.data.tools.execBash) {
    toolsList.push(nativeToolsEnabled ? 'exec_bash' : 'EXEC_BASH:<cmd>');
  }

  if (mode === 'off') {
    const full = compactPromptText(
      `${node.data.systemPrompt}\n` +
        `Agent: ${node.data.label} (${node.data.role})` +
        (node.data.section ? ` | Dept: ${node.data.section}` : '') +
        (node.data.positionTitle ? ` | Post: ${node.data.positionTitle}` : '') +
        (node.data.responsibility ? `\nResponsibility: ${node.data.responsibility}` : '') +
        `\nProfile: ${powerMeta.en} — ${powerMeta.directive}` +
        `\nTools: ${toolsList.join(', ') || 'None'}` +
        `\nEdit files directly in source/test folders; write change notes only in README.md. Keep reply under 240 words.` +
        (isManager
          ? `\nManager (${delegationPhase}): audit sandbox & bugs. Call delegate_agent or DELEGATE: {"targetRole":"backend"|"frontend"|"security_qa"|"executor","issue":"...","reason":"..."} if defects exist; emit TERMINATE only when clean.`
          : '') +
        (isGroupDiscussion
          ? `\nGroupChat teammates: ${teammates.join(', ')}. Reply directly in User's language; no TERMINATE unless requested.`
          : `\nReply in User's language.`) +
        `\nTo log issues call report_bug or emit BUG_REPORT: {"category":"bug"|"improvement","severity":"critical"|"high"|"medium"|"low","title":"...","description":"...","suggestedFix":"..."}`,
    );
    const optimizedTokens = estimateCharTokens(full);
    return {
      systemPrompt: full,
      baselineTokens,
      optimizedTokens,
      savedTokens: Math.max(0, baselineTokens - optimizedTokens),
    };
  }

  const wordBudget = mode === 'ultra_compact' ? 140 : 210;
  const corePrompt = truncateMiddle(
    compactPromptText(node.data.systemPrompt),
    mode === 'ultra_compact' ? 320 : 480,
  );
  const respLine = node.data.responsibility
    ? `\nScope: ${truncateMiddle(compactPromptText(node.data.responsibility), 120)}`
    : '';

  const toolLine =
    toolsList.length > 0
      ? nativeToolsEnabled
        ? `Tools: use native ${toolsList.join('/')}.`
        : `Tools: ${toolsList.join(' | ')}.`
      : 'Tools: none.';

  const managerRule = isManager
    ? `\nMgr(${delegationPhase}): if bugs/failures exist, call ${nativeToolsEnabled ? 'delegate_agent' : 'DELEGATE:{"targetRole":"backend|frontend|security_qa|executor","issue":"...","reason":"..."}'}; else emit TERMINATE.`
    : '';

  const groupRule = isGroupDiscussion
    ? `\nRoom(${teammates.slice(0, 5).join(', ')}): address user & prior speakers; match user language; no TERMINATE.`
    : `\nMatch user language.`;

  const bugRule = nativeToolsEnabled
    ? `Bugs: call report_bug.`
    : `Bugs: BUG_REPORT:{"category":"bug|improvement","severity":"critical|high|medium|low","title":"...","description":"..."}`;

  const compact =
    `${corePrompt}\n` +
    `Role: ${node.data.label} [${node.data.role}]${respLine}\n` +
    `${toolLine} ${bugRule}\n` +
    `Rules: edit real src/test paths directly (changelog only in README.md); avoid repeating unchanged code; stay under ${wordBudget} words.` +
    managerRule +
    groupRule;

  const optimizedTokens = estimateCharTokens(compact);
  return {
    systemPrompt: compact,
    baselineTokens,
    optimizedTokens,
    savedTokens: Math.max(0, baselineTokens - optimizedTokens),
  };
}
