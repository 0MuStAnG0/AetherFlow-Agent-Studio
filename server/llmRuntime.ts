import { type FunctionDeclaration, GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { getAppSettings, resolveServerSecret } from './db.ts';
import { POWER_LEVEL_META } from '../src/data/agentTemplates.ts';
import type {
  AppSettings,
  TokenUsage,
  WorkflowNode,
} from '../src/types/workflow.ts';
import {
  formatGeminiApiError,
  type GeminiApiVersion,
  normalizeSecretName,
  parseGeminiBaseUrl,
} from '../src/utils/secretUtils.ts';
import { parseGoogleJsonCredential } from '../src/utils/providerJsonSync.ts';
import {
  buildCompactSystemPrompt,
  compactConversationHistory,
  truncateMiddle,
  type ActiveManagerAssignment,
} from '../src/utils/promptOptimizer.ts';
import { estimateTokenUsage, isManagerNode } from '../src/utils/workflowEngine.ts';

export interface StructuredToolInvocation {
  name: 'read_file' | 'write_file' | 'exec_bash' | 'report_bug' | 'delegate_agent';
  args: Record<string, unknown>;
}

export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchWithTransientRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
  maxAttempts = 3,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (externalSignal?.aborted) {
      throw new Error('Execution cancelled by operator');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);
    const onExternalAbort = () => controller.abort(new Error('Execution cancelled by operator'));
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);

      const retryableStatus =
        res.status === 429 ||
        res.status === 500 ||
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504;
      if (!retryableStatus || attempt === maxAttempts) {
        return res;
      }
      await sleepWithAbort(300 * attempt, externalSignal);
    } catch (err) {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      lastError = err;
      if (externalSignal?.aborted || attempt === maxAttempts) {
        throw err;
      }
      await sleepWithAbort(300 * attempt, externalSignal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Upstream request failed');
}

export function getAiClient(
  secretRef?: string,
  options?: {
    baseUrl?: string;
    apiKey?: string;
    apiVersion?: GeminiApiVersion;
    vertexai?: boolean;
  },
): GoogleGenAI | null {
  const settings = getAppSettings();
  const primaryRef = secretRef || settings.providers.gemini?.envVarName || 'GEMINI_API_KEY';
  const resolved =
    options?.apiKey?.trim() ||
    resolveServerSecret(primaryRef).value ||
    (primaryRef !== 'GEMINI_API_KEY' ? resolveServerSecret('GEMINI_API_KEY').value : null);
  if (!resolved) return null;

  const rawBase =
    options?.baseUrl?.trim() ||
    settings.providers.gemini?.baseUrl?.trim() ||
    process.env.GOOGLE_GEMINI_BASE_URL?.trim() ||
    '';

  const googleJsonCred = parseGoogleJsonCredential(resolved);
  if (googleJsonCred) {
    const regionMatch = rawBase.match(/^https?:\/\/([a-z0-9-]+)-aiplatform\.googleapis\.com/i);
    const location = regionMatch?.[1] || googleJsonCred.location || 'us-central1';
    const isStandardGoogleHost =
      !rawBase ||
      /^https?:\/\/(generativelanguage|([a-z0-9-]+-)?aiplatform)\.googleapis\.com/i.test(rawBase);
    const parsedProxyBase = isStandardGoogleHost ? {} : parseGeminiBaseUrl(rawBase);

    const httpOptions: {
      baseUrl?: string;
      apiVersion?: string;
      headers: Record<string, string>;
    } = {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    };
    if (parsedProxyBase.baseUrl) {
      httpOptions.baseUrl = parsedProxyBase.baseUrl;
    }
    if (options?.apiVersion || parsedProxyBase.apiVersion) {
      httpOptions.apiVersion = options?.apiVersion || parsedProxyBase.apiVersion;
    }

    return new GoogleGenAI({
      vertexai: true,
      ...(googleJsonCred.projectId ? { project: googleJsonCred.projectId } : {}),
      location,
      googleAuthOptions: {
        credentials: JSON.parse(googleJsonCred.compactedJson) as Record<string, unknown>,
      },
      httpOptions,
    });
  }

  const parsedBase = options?.vertexai ? {} : parseGeminiBaseUrl(rawBase);

  const httpOptions: {
    baseUrl?: string;
    apiVersion?: string;
    headers: Record<string, string>;
  } = {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  };
  if (parsedBase.baseUrl) {
    httpOptions.baseUrl = parsedBase.baseUrl;
  }
  const effectiveVersion = options?.apiVersion || parsedBase.apiVersion;
  if (effectiveVersion) {
    httpOptions.apiVersion = effectiveVersion;
  }

  return new GoogleGenAI({
    apiKey: resolved,
    ...(options?.vertexai ? { vertexai: true } : {}),
    httpOptions,
  });
}

export function getSecretForNode(node: WorkflowNode, settings: AppSettings): string | null {
  const defaultRef = settings.providers[node.data.provider]?.envVarName;
  const customRef = node.data.envSecretRef?.trim();
  if (customRef) {
    const customResolved = resolveServerSecret(customRef).value;
    if (customResolved) return customResolved;
  }
  if (defaultRef && defaultRef !== customRef) {
    return resolveServerSecret(defaultRef).value;
  }
  return null;
}

export function canNodeRunLive(node: WorkflowNode, settings: AppSettings): boolean {
  if (node.data.provider === 'opencode' || node.data.provider === 'ollama') {
    return true;
  }
  if (getSecretForNode(node, settings)) {
    return true;
  }
  return Boolean(getAiClient());
}

export function canWorkflowRunLive(nodes: WorkflowNode[], settings: AppSettings): boolean {
  if (getAiClient()) return true;
  return nodes.length > 0 && nodes.every((n) => canNodeRunLive(n, settings));
}

export function buildGeminiToolDeclarations(node: WorkflowNode): FunctionDeclaration[] {
  const declarations: FunctionDeclaration[] = [];

  if (node.data.tools.readFile) {
    declarations.push({
      name: 'read_file',
      description: 'Read a project file by relative path.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING, description: 'Relative workspace path' },
        },
        required: ['path'],
      },
    });
  }

  if (node.data.tools.writeFile) {
    declarations.push({
      name: 'write_file',
      description: 'Write or update a workspace source/test file.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING, description: 'Relative file path' },
          content: { type: Type.STRING, description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    });
  }

  if (node.data.tools.execBash) {
    declarations.push({
      name: 'exec_bash',
      description: 'Run a shell command in the workspace.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          command: { type: Type.STRING, description: 'Shell command' },
        },
        required: ['command'],
      },
    });
  }

  declarations.push({
    name: 'report_bug',
    description: 'Log a bug or improvement to Bug Tracker.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING, description: 'bug | improvement' },
        severity: { type: Type.STRING, description: 'critical | high | medium | low' },
        title: { type: Type.STRING, description: 'Short title' },
        description: { type: Type.STRING, description: 'Issue details' },
        suggestedFix: { type: Type.STRING, description: 'Actionable fix' },
      },
      required: ['category', 'severity', 'title', 'description'],
    },
  });

  if (isManagerNode(node)) {
    declarations.push({
      name: 'delegate_agent',
      description: 'Delegate an issue or question to a specialist agent so they can respond directly.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          targetRole: {
            type: Type.STRING,
            description: 'backend | frontend | security_qa | executor | custom',
          },
          targetAgent: {
            type: Type.STRING,
            description: 'Optional exact specialist name (useful for custom agents)',
          },
          issue: { type: Type.STRING, description: 'Short issue or question summary' },
          reason: { type: Type.STRING, description: 'Expected fix or answer' },
        },
        required: ['targetRole', 'issue', 'reason'],
      },
    });
  }

  return declarations;
}

function buildOpenAiToolSchemas(node: WorkflowNode) {
  return buildGeminiToolDeclarations(node).map((decl) => ({
    type: 'function' as const,
    function: {
      name: decl.name,
      description: decl.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries((decl.parameters as { properties?: Record<string, { description?: string }> })?.properties ?? {}).map(
            ([k, v]) => [k, { type: 'string', description: v.description || k }],
          ),
        ),
        required: (decl.parameters as { required?: string[] })?.required ?? [],
      },
    },
  }));
}

function normalizeStructuredInvocations(
  calls: Array<{ name?: string; args?: Record<string, unknown> }>,
): StructuredToolInvocation[] {
  const allowed = new Set(['read_file', 'write_file', 'exec_bash', 'report_bug', 'delegate_agent']);
  const out: StructuredToolInvocation[] = [];
  for (const call of calls) {
    if (call.name && allowed.has(call.name) && call.args && typeof call.args === 'object') {
      out.push({
        name: call.name as StructuredToolInvocation['name'],
        args: call.args,
      });
    }
  }
  return out;
}

function resolveGemini4ThinkingLevel(
  powerLevel: WorkflowNode['data']['powerLevel'],
  mode: NonNullable<AppSettings['tokenOptimizationMode']>,
): ThinkingLevel {
  if (powerLevel === 'eco') return ThinkingLevel.LOW;
  if (powerLevel === 'standard') {
    return mode === 'ultra_compact' ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM;
  }
  if (powerLevel === 'pro') {
    return mode === 'ultra_compact' ? ThinkingLevel.MEDIUM : ThinkingLevel.HIGH;
  }
  return ThinkingLevel.HIGH;
}

async function consumeOpenAiCompatibleStream(params: {
  res: Response;
  onChunk?: (accumulatedText: string) => void;
  promptInputText: string;
}): Promise<{
  text: string;
  structuredTools: StructuredToolInvocation[];
  tokenUsage: TokenUsage;
}> {
  const contentType = (params.res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/event-stream') || !params.res.body) {
    const data = (await params.res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const msg = data.choices?.[0]?.message;
    const text = msg?.content || '';
    if (text && params.onChunk) params.onChunk(text);
    const parsedCalls: Array<{ name?: string; args?: Record<string, unknown> }> = [];
    for (const tc of msg?.tool_calls ?? []) {
      try {
        const args = tc.function?.arguments
          ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
          : {};
        parsedCalls.push({ name: tc.function?.name, args });
      } catch {
        // ignore malformed args
      }
    }
    const usage =
      data.usage && typeof data.usage.total_tokens === 'number'
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens,
          }
        : estimateTokenUsage(params.promptInputText, text);
    return {
      text,
      structuredTools: normalizeStructuredInvocations(parsedCalls),
      tokenUsage: usage,
    };
  }

  const reader = params.res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  const toolAccumulators = new Map<number, { name: string; argumentsText: string }>();
  let usageData: TokenUsage | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index?: number;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          accumulated += delta.content;
          params.onChunk?.(accumulated);
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const prev = toolAccumulators.get(idx) ?? { name: '', argumentsText: '' };
            if (tc.function?.name) prev.name = tc.function.name;
            if (tc.function?.arguments) prev.argumentsText += tc.function.arguments;
            toolAccumulators.set(idx, prev);
          }
        }
        if (chunk.usage && typeof chunk.usage.total_tokens === 'number') {
          usageData = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      } catch {
        // ignore partial SSE JSON frames
      }
    }
  }

  const parsedCalls: Array<{ name?: string; args?: Record<string, unknown> }> = [];
  for (const acc of toolAccumulators.values()) {
    try {
      const args = acc.argumentsText
        ? (JSON.parse(acc.argumentsText) as Record<string, unknown>)
        : {};
      parsedCalls.push({ name: acc.name, args });
    } catch {
      // ignore invalid tool arguments
    }
  }

  return {
    text: accumulated,
    structuredTools: normalizeStructuredInvocations(parsedCalls),
    tokenUsage: usageData ?? estimateTokenUsage(params.promptInputText, accumulated),
  };
}

export async function generateLiveAgentReply(params: {
  ai: GoogleGenAI | null;
  node: WorkflowNode;
  history: Array<{ role: string; content: string }>;
  isGroupDiscussion?: boolean;
  teammates?: string[];
  managerName?: string;
  activeAssignment?: ActiveManagerAssignment | null;
  inspectionSnapshot?: string;
  delegationPhase?: 'test' | 'deploy' | 'review';
  signal?: AbortSignal;
  onChunk?: (accumulatedText: string) => void;
}): Promise<{
  text: string;
  structuredTools: StructuredToolInvocation[];
  tokenUsage: TokenUsage;
}> {
  const {
    ai,
    node,
    history,
    isGroupDiscussion,
    teammates,
    managerName,
    activeAssignment = null,
    inspectionSnapshot,
    delegationPhase,
    signal,
    onChunk,
  } = params;

  const settings = getAppSettings();
  const optMode = settings.tokenOptimizationMode ?? 'ultra_compact';
  const nativeToolsEnabled =
    node.data.provider === 'gemini' || node.data.provider === 'openai';

  const systemPromptMeta = buildCompactSystemPrompt({
    node,
    mode: optMode,
    nativeToolsEnabled,
    isManager: isManagerNode(node),
    isGroupDiscussion,
    teammates,
    managerName,
    activeAssignment,
    delegationPhase,
  });
  const systemInstruction = systemPromptMeta.systemPrompt;

  const compactedHistory = compactConversationHistory(history, { mode: optMode });
  const trimmedSnapshot = inspectionSnapshot
    ? optMode === 'off'
      ? inspectionSnapshot
      : truncateMiddle(inspectionSnapshot, optMode === 'ultra_compact' ? 850 : 1300)
    : '';
  const snapshotSavedTokens =
    inspectionSnapshot && trimmedSnapshot.length < inspectionSnapshot.length
      ? Math.ceil((inspectionSnapshot.length - trimmedSnapshot.length) / 4)
      : 0;
  const totalSavedTokens =
    systemPromptMeta.savedTokens + compactedHistory.savedTokens + snapshotSavedTokens;
  const withSavedTokens = (usage: TokenUsage): TokenUsage =>
    totalSavedTokens > 0
      ? { ...usage, savedTokens: (usage.savedTokens ?? 0) + totalSavedTokens }
      : usage;

  const snapshotBlock = trimmedSnapshot ? `\n\n[AUDIT]\n${trimmedSnapshot}` : '';
  const assignmentCue =
    activeAssignment && !isManagerNode(node)
      ? `\n\n[DIRECT MESSAGE FROM MANAGER @${activeAssignment.managerName}]:\n` +
        `Issue/Request: ${activeAssignment.issue}\n` +
        (activeAssignment.reason && activeAssignment.reason !== activeAssignment.issue
          ? `Expected outcome: ${activeAssignment.reason}\n`
          : '') +
        `Address @${activeAssignment.managerName} directly in the conversation's language, answer clearly like a collaborative teammate, apply any required file fixes, and report your exact result.`
      : '';
  const transcript =
    compactedHistory.messages
      .map((m) => `[${m.role.toUpperCase()}]:\n${m.content}`)
      .join('\n\n---\n\n') +
    snapshotBlock +
    assignmentCue;
  const promptInputText = `${systemInstruction}\n${transcript}`;
  const userContent = `${transcript}\n\nReply as ${node.data.label}:`;

  const nodeKey = getSecretForNode(node, settings);
  const powerKey = node.data.powerLevel ?? 'standard';
  const powerMeta = POWER_LEVEL_META[powerKey] ?? POWER_LEVEL_META.standard;
  const maxOutputCap =
    optMode === 'ultra_compact'
      ? Math.min(powerMeta.maxTokens, 1600)
      : powerMeta.maxTokens;

  if (signal?.aborted) {
    throw new Error('Execution cancelled by operator');
  }

  // 1. OpenCode Zen (OpenAI-compatible SSE streaming)
  if (node.data.provider === 'opencode') {
    const baseUrl = (settings.providers.opencode?.baseUrl || 'https://opencode.ai/zen/v1').replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (nodeKey) headers.Authorization = `Bearer ${nodeKey}`;

    const openCodeRes = await fetchWithTransientRetry(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: node.data.model.replace(/^opencode\//, ''),
          temperature: node.data.temperature,
          max_tokens: maxOutputCap,
          stream: true,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userContent },
          ],
        }),
      },
      18000,
      signal,
      2,
    ).catch(() => null);

    if (openCodeRes?.ok) {
      const streamed = await consumeOpenAiCompatibleStream({
        res: openCodeRes,
        onChunk,
        promptInputText,
      });
      if (streamed.text || streamed.structuredTools.length > 0) {
        return { ...streamed, tokenUsage: withSavedTokens(streamed.tokenUsage) };
      }
    }
    if (!ai) {
      const statusText = openCodeRes ? `HTTP ${openCodeRes.status}` : 'network timeout';
      const errBody = openCodeRes ? await openCodeRes.text().catch(() => '') : '';
      throw new Error(
        `OpenCode Zen returned ${statusText}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`,
      );
    }
  }

  // 2. OpenAI (Native Function Calling + SSE Streaming)
  if (node.data.provider === 'openai' && nodeKey) {
    const baseUrl = (settings.providers.openai?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const tools = buildOpenAiToolSchemas(node);
    const openaiRes = await fetchWithTransientRetry(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nodeKey}`,
        },
        body: JSON.stringify({
          model: node.data.model,
          temperature: node.data.temperature,
          max_tokens: maxOutputCap,
          stream: true,
          stream_options: { include_usage: true },
          ...(tools.length > 0 ? { tools } : {}),
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userContent },
          ],
        }),
      },
      30000,
      signal,
      3,
    );
    if (!openaiRes.ok) {
      const errBody = await openaiRes.text().catch(() => '');
      throw new Error(`OpenAI API error HTTP ${openaiRes.status}: ${errBody.slice(0, 200)}`);
    }
    const result = await consumeOpenAiCompatibleStream({
      res: openaiRes,
      onChunk,
      promptInputText,
    });
    if (result.text || result.structuredTools.length > 0) {
      return { ...result, tokenUsage: withSavedTokens(result.tokenUsage) };
    }
    throw new Error('OpenAI returned an empty response.');
  }

  // 3. Anthropic (Native Tool Use + SSE Streaming)
  if (node.data.provider === 'anthropic' && nodeKey) {
    const baseUrl = (settings.providers.anthropic?.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    const antRes = await fetchWithTransientRetry(
      `${baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': nodeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: node.data.model,
          max_tokens: maxOutputCap,
          temperature: node.data.temperature,
          system: systemInstruction,
          stream: true,
          messages: [{ role: 'user', content: userContent }],
        }),
      },
      30000,
      signal,
      3,
    );
    if (!antRes.ok) {
      const errBody = await antRes.text().catch(() => '');
      throw new Error(`Anthropic API error HTTP ${antRes.status}: ${errBody.slice(0, 200)}`);
    }

    const contentType = (antRes.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/event-stream') && antRes.body) {
      const reader = antRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let accumulated = '';
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload) as {
              type?: string;
              message?: { usage?: { input_tokens?: number } };
              usage?: { output_tokens?: number };
              delta?: { type?: string; text?: string };
            };
            if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
              inputTokens = evt.message.usage.input_tokens;
            } else if (evt.type === 'content_block_delta' && evt.delta?.text) {
              accumulated += evt.delta.text;
              onChunk?.(accumulated);
            } else if (evt.type === 'message_delta' && evt.usage?.output_tokens) {
              outputTokens = evt.usage.output_tokens;
            }
          } catch {
            // ignore partial frames
          }
        }
      }
      if (accumulated) {
        const usage =
          inputTokens + outputTokens > 0
            ? {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: inputTokens + outputTokens,
              }
            : estimateTokenUsage(promptInputText, accumulated);
        return { text: accumulated, structuredTools: [], tokenUsage: withSavedTokens(usage) };
      }
    } else {
      const data = (await antRes.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = data.content?.map((c) => c.text ?? '').join('') ?? '';
      if (text) {
        onChunk?.(text);
        const usage =
          data.usage &&
          (typeof data.usage.input_tokens === 'number' || typeof data.usage.output_tokens === 'number')
            ? {
                promptTokens: data.usage.input_tokens ?? 0,
                completionTokens: data.usage.output_tokens ?? 0,
                totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
              }
            : estimateTokenUsage(promptInputText, text);
        return { text, structuredTools: [], tokenUsage: withSavedTokens(usage) };
      }
    }
    throw new Error('Anthropic returned an empty response.');
  }

  // 4. Ollama (NDJSON Streaming)
  if (node.data.provider === 'ollama') {
    const baseUrl = (settings.providers.ollama?.baseUrl || 'http://host.docker.internal:11434').replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (nodeKey) headers.Authorization = `Bearer ${nodeKey}`;

    const ollamaRes = await fetchWithTransientRetry(
      `${baseUrl}/api/chat`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: node.data.model.replace(/^ollama\//, ''),
          stream: true,
          options: {
            temperature: node.data.temperature,
            num_predict: optMode === 'ultra_compact' ? Math.min(powerMeta.maxTokens, 1400) : powerMeta.maxTokens,
          },
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userContent },
          ],
        }),
      },
      12000,
      signal,
      2,
    ).catch(() => null);

    if (ollamaRes?.ok && ollamaRes.body) {
      const reader = ollamaRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let accumulated = '';
      let promptCount = 0;
      let evalCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed) as {
              message?: { content?: string };
              prompt_eval_count?: number;
              eval_count?: number;
            };
            if (chunk.message?.content) {
              accumulated += chunk.message.content;
              onChunk?.(accumulated);
            }
            if (typeof chunk.prompt_eval_count === 'number') promptCount = chunk.prompt_eval_count;
            if (typeof chunk.eval_count === 'number') evalCount = chunk.eval_count;
          } catch {
            // ignore partial NDJSON lines
          }
        }
      }

      if (accumulated) {
        const usage =
          promptCount + evalCount > 0
            ? {
                promptTokens: promptCount,
                completionTokens: evalCount,
                totalTokens: promptCount + evalCount,
              }
            : estimateTokenUsage(promptInputText, accumulated);
        return { text: accumulated, structuredTools: [], tokenUsage: withSavedTokens(usage) };
      }
    }
    if (!ai) {
      const statusText = ollamaRes ? `HTTP ${ollamaRes.status}` : 'endpoint unreachable';
      throw new Error(
        `Local Ollama (${baseUrl}) failed: ${statusText}. Start Ollama or configure a Gemini/OpenAI API key in Settings.`,
      );
    }
  }

  // 5. Gemini (@google/genai Native Function Calling + Real-Time generateContentStream)
  const effectiveGeminiAi =
    node.data.provider === 'gemini' ? getAiClient(node.data.envSecretRef) ?? ai : ai;

  if (!effectiveGeminiAi) {
    throw new Error(
      `API key not configured for ${node.data.provider} (${node.data.envSecretRef || 'GEMINI_API_KEY'}). Add it in Settings.`,
    );
  }

  const preferredModel =
    node.data.provider === 'gemini' && node.data.model.startsWith('gemini-')
      ? node.data.model
      : 'gemini-3.1-flash-lite';

  const candidateModels = Array.from(
    new Set([preferredModel, 'gemini-3.1-flash-lite', 'gemini-4-argon', 'gemini-4-hydrogen']),
  );

  const functionDeclarations = buildGeminiToolDeclarations(node);
  const thinkingLevel = resolveGemini4ThinkingLevel(powerKey, optMode);
  let lastErr: unknown = null;

  for (const modelName of candidateModels) {
    if (signal?.aborted) {
      throw new Error('Execution cancelled by operator');
    }
    try {
      const isGemini4 = /^gemini-4-/i.test(modelName);
      const streamResp = await effectiveGeminiAi.models.generateContentStream({
        model: modelName,
        contents: userContent,
        config: {
          systemInstruction,
          ...(isGemini4
            ? { thinkingConfig: { thinkingLevel } }
            : { temperature: node.data.temperature }),
          ...(functionDeclarations.length > 0
            ? { tools: [{ functionDeclarations }] }
            : {}),
          httpOptions: { timeout: 25000 },
        },
      });

      let accumulated = '';
      const collectedCalls: Array<{ name?: string; args?: Record<string, unknown> }> = [];
      let usageMeta: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      } | undefined;

      for await (const chunk of streamResp) {
        if (signal?.aborted) {
          throw new Error('Execution cancelled by operator');
        }
        const deltaText = chunk.text ?? '';
        if (deltaText) {
          accumulated += deltaText;
          onChunk?.(accumulated);
        }
        if (Array.isArray(chunk.functionCalls)) {
          for (const fc of chunk.functionCalls) {
            collectedCalls.push({
              name: fc.name,
              args: (fc.args as Record<string, unknown> | undefined) ?? {},
            });
          }
        }
        const chunkUsage = (
          chunk as {
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
          }
        ).usageMetadata;
        if (chunkUsage) usageMeta = chunkUsage;
      }

      const usage: TokenUsage =
        usageMeta && typeof usageMeta.totalTokenCount === 'number'
          ? {
              promptTokens: usageMeta.promptTokenCount ?? 0,
              completionTokens: usageMeta.candidatesTokenCount ?? 0,
              totalTokens: usageMeta.totalTokenCount,
            }
          : estimateTokenUsage(promptInputText, accumulated);

      return {
        text: accumulated,
        structuredTools: normalizeStructuredInvocations(collectedCalls),
        tokenUsage: withSavedTokens(usage),
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        msg.includes('503') ||
        msg.includes('504') ||
        msg.includes('429') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('DEADLINE_EXCEEDED') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('abort');
      if (!retryable) {
        const formatted = formatGeminiApiError(err, settings.language);
        throw new Error(formatted.message);
      }
      await sleepWithAbort(300, signal);
    }
  }

  if (lastErr) {
    const formatted = formatGeminiApiError(lastErr, settings.language);
    throw new Error(formatted.message);
  }
  throw new Error('All Gemini fallback models failed');
}
