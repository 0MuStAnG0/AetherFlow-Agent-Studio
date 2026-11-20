import type {
  AgentRole,
  BugReportItem,
  ExecutionEvent,
  ExecutionRunSummary,
  FileDiffEntry,
  LLMProvider,
  RunAgentWorkReport,
  RunChangeFileEntry,
  RunChangeReport,
  RunCommandSummary,
  WorkflowNode,
} from '../types/workflow';

const PERSIAN_SCRIPT_REGEX = /[\u0600-\u06FF]/;
const LATIN_LETTER_REGEX = /[A-Za-z]/;

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function extractReadableHighlight(rawContent: string): string {
  const cleaned = (rawContent || '')
    .replace(/WRITE_FILE:[^\n]+\n```[\s\S]*?```/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/(?:READ_FILE|EXEC_BASH|BUG_REPORT|DELEGATE):[^\n]*/g, '')
    .replace(/\bTERMINATE\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > 180 ? `${cleaned.slice(0, 177).trimEnd()}...` : cleaned;
}

export function detectConversationLanguage(params: {
  taskPrompt?: string;
  events?: ExecutionEvent[];
  fallbackLanguage?: 'en' | 'fa';
}): 'en' | 'fa' {
  const { taskPrompt = '', events = [], fallbackLanguage = 'en' } = params;

  const userTexts: string[] = [];
  if (taskPrompt.trim()) {
    userTexts.push(taskPrompt.trim());
  }
  for (const evt of events) {
    if (evt.type === 'user_message' && evt.content?.trim()) {
      userTexts.push(evt.content.trim());
    }
  }

  for (const text of userTexts) {
    if (PERSIAN_SCRIPT_REGEX.test(text)) {
      return 'fa';
    }
  }

  if (userTexts.some((t) => LATIN_LETTER_REGEX.test(t))) {
    // User explicitly wrote in English/Latin — match their conversation language
    // unless all agent replies themselves are predominantly Persian.
    const agentTexts = events
      .filter((e) => e.type === 'agent_message' && e.content?.trim())
      .map((e) => e.content.trim());
    const persianAgents = agentTexts.filter((t) => PERSIAN_SCRIPT_REGEX.test(t)).length;
    if (agentTexts.length > 0 && persianAgents === agentTexts.length) {
      return 'fa';
    }
    return 'en';
  }

  const agentHasPersian = events.some(
    (e) => e.type === 'agent_message' && e.content && PERSIAN_SCRIPT_REGEX.test(e.content),
  );
  if (agentHasPersian) return 'fa';

  const agentHasLatin = events.some(
    (e) => e.type === 'agent_message' && e.content && LATIN_LETTER_REGEX.test(e.content),
  );
  if (agentHasLatin) return 'en';

  return fallbackLanguage;
}

function formatDurationHuman(durationMs: number | undefined, lang: 'en' | 'fa'): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return lang === 'fa' ? 'نامشخص' : 'N/A';
  }
  if (durationMs < 1000) {
    return lang === 'fa' ? `${Math.round(durationMs)} میلی‌ثانیه` : `${Math.round(durationMs)}ms`;
  }
  const secs = durationMs / 1000;
  if (secs < 60) {
    return lang === 'fa' ? `${secs.toFixed(1)} ثانیه` : `${secs.toFixed(1)}s`;
  }
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs % 60);
  return lang === 'fa' ? `${mins} دقیقه و ${rem} ثانیه` : `${mins}m ${rem}s`;
}

function translateStatus(
  status: ExecutionRunSummary['status'],
  lang: 'en' | 'fa',
): string {
  if (lang === 'fa') {
    switch (status) {
      case 'completed':
        return 'تکمیل‌شده';
      case 'running':
        return 'در حال اجرا';
      case 'awaiting_approval':
        return 'در انتظار تایید اپراتور';
      case 'cancelled':
        return 'متوقف‌شده توسط کاربر';
      case 'failed':
        return 'ناموفق / دارای خطا';
      default:
        return status;
    }
  }
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'running':
      return 'Running';
    case 'awaiting_approval':
      return 'Awaiting Approval';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

interface MutableAgentAcc {
  agentId: string;
  agentName: string;
  role: AgentRole;
  section?: string;
  positionTitle?: string;
  provider?: LLMProvider;
  model?: string;
  roundsSpoken: number;
  durationMs: number;
  delegationsIssued: number;
  delegationsReceived: number;
  repliedToManager: boolean;
  filesModified: Set<string>;
  commandsExecuted: number;
  bugsLogged: number;
  errors: string[];
  highlights: string[];
}

function buildAgentWorkSummary(acc: MutableAgentAcc, lang: 'en' | 'fa'): string {
  const parts: string[] = [];
  if (lang === 'fa') {
    if (acc.roundsSpoken > 0) {
      parts.push(`${acc.roundsSpoken} نوبت مشارکت`);
    }
    if (acc.filesModified.size > 0) {
      parts.push(`ویرایش ${acc.filesModified.size} فایل (${Array.from(acc.filesModified).slice(0, 3).join('، ')})`);
    }
    if (acc.commandsExecuted > 0) {
      parts.push(`اجرای ${acc.commandsExecuted} دستور سندباکس`);
    }
    if (acc.delegationsIssued > 0) {
      parts.push(`ارجاع ${acc.delegationsIssued} وظیفه به متخصصان`);
    }
    if (acc.delegationsReceived > 0 && acc.repliedToManager) {
      parts.push(`دریافت وظیفه از مدیر و پاسخ‌گویی مستقیم به مدیر`);
    } else if (acc.repliedToManager) {
      parts.push(`پاسخ‌گویی مستقیم به مدیر`);
    } else if (acc.delegationsReceived > 0) {
      parts.push(`دریافت ${acc.delegationsReceived} ارجاع از مدیر`);
    }
    if (acc.bugsLogged > 0) {
      parts.push(`ثبت ${acc.bugsLogged} باگ/پیشنهاد`);
    }
    if (acc.errors.length > 0) {
      parts.push(`${acc.errors.length} خطا ثبت شد`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'مشارکت در تحلیل و هماهنگی تیم';
  }

  if (acc.roundsSpoken > 0) {
    parts.push(`${acc.roundsSpoken} turn${acc.roundsSpoken > 1 ? 's' : ''}`);
  }
  if (acc.filesModified.size > 0) {
    parts.push(
      `modified ${acc.filesModified.size} file${acc.filesModified.size > 1 ? 's' : ''} (${Array.from(acc.filesModified).slice(0, 3).join(', ')})`,
    );
  }
  if (acc.commandsExecuted > 0) {
    parts.push(`ran ${acc.commandsExecuted} sandbox command${acc.commandsExecuted > 1 ? 's' : ''}`);
  }
  if (acc.delegationsIssued > 0) {
    parts.push(`delegated ${acc.delegationsIssued} task${acc.delegationsIssued > 1 ? 's' : ''}`);
  }
  if (acc.delegationsReceived > 0 && acc.repliedToManager) {
    parts.push('answered Manager delegation directly');
  } else if (acc.repliedToManager) {
    parts.push('replied directly to Manager');
  } else if (acc.delegationsReceived > 0) {
    parts.push(`received ${acc.delegationsReceived} delegation${acc.delegationsReceived > 1 ? 's' : ''}`);
  }
  if (acc.bugsLogged > 0) {
    parts.push(`logged ${acc.bugsLogged} issue${acc.bugsLogged > 1 ? 's' : ''}`);
  }
  if (acc.errors.length > 0) {
    parts.push(`${acc.errors.length} error${acc.errors.length > 1 ? 's' : ''} encountered`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Participated in team analysis and coordination';
}

export function buildRunChangeReport(params: {
  runId: string;
  workflowName: string;
  taskPrompt: string;
  status: ExecutionRunSummary['status'];
  roundsExecuted: number;
  durationMs?: number;
  events: ExecutionEvent[];
  diffs: FileDiffEntry[];
  bugReports?: BugReportItem[];
  workflowNodes?: WorkflowNode[];
  fallbackLanguage?: 'en' | 'fa';
}): RunChangeReport {
  const {
    runId,
    workflowName,
    taskPrompt,
    status,
    roundsExecuted,
    durationMs,
    events,
    diffs,
    bugReports = [],
    workflowNodes = [],
    fallbackLanguage = 'en',
  } = params;

  const language = detectConversationLanguage({
    taskPrompt,
    events,
    fallbackLanguage,
  });

  const nodeById = new Map<string, WorkflowNode>(workflowNodes.map((n) => [n.id, n]));
  const nodeByName = new Map<string, WorkflowNode>(
    workflowNodes.map((n) => [n.data.label.trim().toLowerCase(), n]),
  );

  const agentAccMap = new Map<string, MutableAgentAcc>();
  const ensureAgentAcc = (info: {
    agentId?: string;
    agentName?: string;
    role?: AgentRole;
    provider?: LLMProvider;
    model?: string;
  }): MutableAgentAcc => {
    const matchedNode =
      (info.agentId ? nodeById.get(info.agentId) : undefined) ??
      (info.agentName ? nodeByName.get(info.agentName.trim().toLowerCase()) : undefined);
    const key =
      info.agentId ||
      matchedNode?.id ||
      (info.agentName ? `name:${info.agentName.trim().toLowerCase()}` : 'team-agent');
    const existing = agentAccMap.get(key);
    if (existing) {
      if (!existing.provider && (info.provider || matchedNode?.data.provider)) {
        existing.provider = info.provider ?? matchedNode?.data.provider;
      }
      if (!existing.model && (info.model || matchedNode?.data.model)) {
        existing.model = info.model ?? matchedNode?.data.model;
      }
      return existing;
    }
    const created: MutableAgentAcc = {
      agentId: info.agentId || matchedNode?.id || key,
      agentName:
        info.agentName ||
        matchedNode?.data.label ||
        (language === 'fa' ? 'ایجنت تیم' : 'Team Agent'),
      role: info.role ?? matchedNode?.data.role ?? 'custom',
      section: matchedNode?.data.section,
      positionTitle: matchedNode?.data.positionTitle,
      provider: info.provider ?? matchedNode?.data.provider,
      model: info.model ?? matchedNode?.data.model,
      roundsSpoken: 0,
      durationMs: 0,
      delegationsIssued: 0,
      delegationsReceived: 0,
      repliedToManager: false,
      filesModified: new Set<string>(),
      commandsExecuted: 0,
      bugsLogged: 0,
      errors: [],
      highlights: [],
    };
    agentAccMap.set(key, created);
    return created;
  };

  // Attribute write_file tool calls, commands, errors, delegations, and highlights per agent
  const fileAgentsMap = new Map<string, Set<string>>();
  const commands: RunCommandSummary[] = [];
  let totalErrors = 0;

  for (const evt of events) {
    if (evt.type === 'agent_message') {
      const acc = ensureAgentAcc({
        agentId: evt.agentId,
        agentName: evt.agentName,
        role: evt.role,
        provider: evt.provider,
        model: evt.model,
      });
      acc.roundsSpoken += 1;
      if (typeof evt.durationMs === 'number' && Number.isFinite(evt.durationMs)) {
        acc.durationMs += Math.max(0, Math.round(evt.durationMs));
      }
      if (evt.replyingToManager) {
        acc.repliedToManager = true;
      }
      const highlight = extractReadableHighlight(evt.content);
      if (highlight && acc.highlights.length < 3 && !acc.highlights.includes(highlight)) {
        acc.highlights.push(highlight);
      }

      if (evt.toolCalls && evt.toolCalls.length > 0) {
        const actorName = acc.agentName;
        for (const tc of evt.toolCalls) {
          if (tc.tool === 'write_file' && (tc.exitCode ?? 0) === 0) {
            const cleanPath = normalizeRelPath(tc.target);
            if (!cleanPath) continue;
            if (!fileAgentsMap.has(cleanPath)) {
              fileAgentsMap.set(cleanPath, new Set());
            }
            fileAgentsMap.get(cleanPath)!.add(actorName);
            acc.filesModified.add(cleanPath);
          } else if (tc.tool === 'exec_bash') {
            acc.commandsExecuted += 1;
            commands.push({
              command: tc.target,
              agentName: actorName,
              exitCode: tc.exitCode,
              approved: tc.approved,
              outputPreview: tc.result ? tc.result.slice(0, 260) : undefined,
            });
            if (typeof tc.exitCode === 'number' && tc.exitCode !== 0) {
              totalErrors += 1;
              const toolErr = `${tc.target} (exit ${tc.exitCode}): ${(tc.result || '').slice(0, 140)}`;
              if (!acc.errors.includes(toolErr)) acc.errors.push(toolErr);
            }
          } else if ((tc.exitCode ?? 0) !== 0) {
            totalErrors += 1;
            const toolErr = `${tc.tool}(${tc.target}): ${(tc.result || '').slice(0, 140)}`;
            if (!acc.errors.includes(toolErr)) acc.errors.push(toolErr);
          }
        }
      }
    } else if (evt.type === 'agent_error' || (evt.type === 'run_error' && (evt.agentId || evt.agentName))) {
      totalErrors += 1;
      const acc = ensureAgentAcc({
        agentId: evt.agentId,
        agentName: evt.agentName,
        role: evt.role,
        provider: evt.provider,
        model: evt.model,
      });
      const errText = (evt.content || '').trim().slice(0, 240);
      if (errText && !acc.errors.includes(errText)) {
        acc.errors.push(errText);
      }
    } else if (evt.type === 'run_error') {
      totalErrors += 1;
    } else if (evt.type === 'manager_delegation' && evt.delegation) {
      const mgrAcc = ensureAgentAcc({
        agentId: evt.delegation.managerId,
        agentName: evt.delegation.managerName,
        role: 'manager',
      });
      mgrAcc.delegationsIssued += 1;

      const targetAcc = ensureAgentAcc({
        agentId: evt.delegation.targetAgentId,
        agentName: evt.delegation.targetAgentName,
        role: evt.delegation.targetRole,
      });
      targetAcc.delegationsReceived += 1;
    } else if (evt.toolCalls && evt.toolCalls.length > 0) {
      const actorName = evt.agentName || (language === 'fa' ? 'ایجنت تیم' : 'Team Agent');
      for (const tc of evt.toolCalls) {
        if (tc.tool === 'write_file' && (tc.exitCode ?? 0) === 0) {
          const cleanPath = normalizeRelPath(tc.target);
          if (!cleanPath) continue;
          if (!fileAgentsMap.has(cleanPath)) {
            fileAgentsMap.set(cleanPath, new Set());
          }
          fileAgentsMap.get(cleanPath)!.add(actorName);
        } else if (tc.tool === 'exec_bash') {
          commands.push({
            command: tc.target,
            agentName: actorName,
            exitCode: tc.exitCode,
            approved: tc.approved,
            outputPreview: tc.result ? tc.result.slice(0, 260) : undefined,
          });
        }
      }
    }
  }

  const fileChanges: RunChangeFileEntry[] = diffs.map((d) => {
    const cleanPath = normalizeRelPath(d.path);
    const attributed = Array.from(fileAgentsMap.get(cleanPath) ?? []);
    return {
      path: cleanPath,
      status: d.status,
      additions: d.additions,
      deletions: d.deletions,
      agents: attributed,
      lines: d.lines,
      ...(d.truncated ? { truncated: true } : {}),
    };
  });

  let addedFiles = 0;
  let modifiedFiles = 0;
  let deletedFiles = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const fc of fileChanges) {
    if (fc.status === 'added') addedFiles += 1;
    else if (fc.status === 'modified') modifiedFiles += 1;
    else if (fc.status === 'deleted') deletedFiles += 1;
    totalAdditions += fc.additions;
    totalDeletions += fc.deletions;
  }

  // Merge bugs passed directly plus any bug_reported events inside the transcript
  const bugMap = new Map<
    string,
    {
      id: string;
      title: string;
      category: 'bug' | 'improvement';
      severity: 'critical' | 'high' | 'medium' | 'low';
      status: 'open' | 'acknowledged' | 'resolved';
      agentName: string;
      agentId?: string;
      role?: AgentRole;
    }
  >();

  for (const b of bugReports) {
    bugMap.set(b.id, {
      id: b.id,
      title: b.title,
      category: b.category,
      severity: b.severity,
      status: b.status,
      agentName: b.agentName,
      agentId: b.agentId,
      role: b.role,
    });
  }
  for (const evt of events) {
    if (evt.type === 'bug_reported' && evt.bugReport) {
      const b = evt.bugReport;
      if (!bugMap.has(b.id)) {
        bugMap.set(b.id, {
          id: b.id,
          title: b.title,
          category: b.category,
          severity: b.severity,
          status: b.status,
          agentName: b.agentName,
          agentId: b.agentId,
          role: b.role,
        });
      }
    }
  }

  for (const b of bugMap.values()) {
    const acc = ensureAgentAcc({
      agentId: b.agentId,
      agentName: b.agentName,
      role: b.role,
    });
    acc.bugsLogged += 1;
  }

  const bugs = Array.from(bugMap.values()).map(({ agentId: _aid, role: _r, ...rest }) => rest);

  const agentReports: RunAgentWorkReport[] = Array.from(agentAccMap.values()).map((acc) => {
    const agentStatus: RunAgentWorkReport['status'] =
      acc.errors.length > 0 ? (acc.roundsSpoken > 0 ? 'warning' : 'error') : 'completed';
    return {
      agentId: acc.agentId,
      agentName: acc.agentName,
      role: acc.role,
      ...(acc.section ? { section: acc.section } : {}),
      ...(acc.positionTitle ? { positionTitle: acc.positionTitle } : {}),
      ...(acc.provider ? { provider: acc.provider } : {}),
      ...(acc.model ? { model: acc.model } : {}),
      status: agentStatus,
      roundsSpoken: acc.roundsSpoken,
      durationMs: acc.durationMs,
      delegationsIssued: acc.delegationsIssued,
      delegationsReceived: acc.delegationsReceived,
      repliedToManager: acc.repliedToManager,
      filesModified: Array.from(acc.filesModified),
      commandsExecuted: acc.commandsExecuted,
      bugsLogged: acc.bugsLogged,
      errors: acc.errors,
      highlights: acc.highlights,
      workSummary: buildAgentWorkSummary(acc, language),
    };
  });

  const participatingAgents = Array.from(
    new Set(
      agentReports.map((a) => a.agentName),
    ),
  );

  const summaryLines: string[] = [];
  const promptPreview = taskPrompt.trim().slice(0, 180) + (taskPrompt.trim().length > 180 ? '...' : '');
  const durationLabel = formatDurationHuman(durationMs, language);
  const statusLabel = translateStatus(status, language);

  if (language === 'fa') {
    summaryLines.push(`گزارش کامل تغییرات اعمال‌شده — ${workflowName}`);
    summaryLines.push(`وضعیت اجرا: ${statusLabel} · راندها: ${roundsExecuted} · مدت‌زمان: ${durationLabel}`);
    if (promptPreview) {
      summaryLines.push(`درخواست کاربر: «${promptPreview}»`);
    }
    if (participatingAgents.length > 0) {
      summaryLines.push(`ایجنت‌های مشارکت‌کننده: ${participatingAgents.join('، ')}`);
    }
    summaryLines.push('');
    summaryLines.push(
      `خلاصه تغییرات فایل‌ها: ${addedFiles} فایل جدید، ${modifiedFiles} فایل ویرایش‌شده، ${deletedFiles} فایل حذف‌شده (+${totalAdditions} خط افزوده / -${totalDeletions} خط حذف‌شده).`,
    );

    if (fileChanges.length === 0) {
      summaryLines.push('• در این اجرا تغییری روی فایل‌های پروژه یا سندباکس اعمال نشد.');
    } else {
      for (const fc of fileChanges) {
        const actionWord =
          fc.status === 'added'
            ? 'افزوده‌شده'
            : fc.status === 'modified'
              ? 'ویرایش‌شده'
              : 'حذف‌شده';
        const byAgent = fc.agents.length > 0 ? ` توسط ${fc.agents.join('، ')}` : '';
        summaryLines.push(
          `• [${actionWord}] ${fc.path}${byAgent} (+${fc.additions} / -${fc.deletions})`,
        );
      }
    }

    if (agentReports.length > 0) {
      summaryLines.push('');
      summaryLines.push(`گزارش کار هر ایجنت (${agentReports.length}):`);
      for (const ar of agentReports) {
        const stFa = ar.status === 'error' ? 'خطا' : ar.status === 'warning' ? 'هشدار' : 'موفق';
        summaryLines.push(`• ${ar.agentName} [${stFa}]: ${ar.workSummary}`);
      }
    }

    if (commands.length > 0) {
      summaryLines.push('');
      summaryLines.push(`دستورات اجراشده در سندباکس (${commands.length}):`);
      for (const cmd of commands) {
        const codeLabel =
          typeof cmd.exitCode === 'number' ? `کد خروج ${cmd.exitCode}` : 'اجراشد';
        summaryLines.push(`• ${cmd.command} (${cmd.agentName} · ${codeLabel})`);
      }
    }

    if (bugs.length > 0) {
      summaryLines.push('');
      summaryLines.push(`گزارش‌های باگ و بهبود ثبت‌شده (${bugs.length}):`);
      for (const b of bugs) {
        const cat = b.category === 'bug' ? 'باگ' : 'بهبود';
        summaryLines.push(`• [${cat} · ${b.severity}] ${b.title} (${b.agentName})`);
      }
    }
  } else {
    summaryLines.push(`Complete Applied Changes Report — ${workflowName}`);
    summaryLines.push(`Status: ${statusLabel} · Rounds: ${roundsExecuted} · Duration: ${durationLabel}`);
    if (promptPreview) {
      summaryLines.push(`User Prompt: "${promptPreview}"`);
    }
    if (participatingAgents.length > 0) {
      summaryLines.push(`Participating Agents: ${participatingAgents.join(', ')}`);
    }
    summaryLines.push('');
    summaryLines.push(
      `File Changes Summary: ${addedFiles} added, ${modifiedFiles} modified, ${deletedFiles} deleted (+${totalAdditions} / -${totalDeletions} lines).`,
    );

    if (fileChanges.length === 0) {
      summaryLines.push('• No project or sandbox file modifications were applied during this run.');
    } else {
      for (const fc of fileChanges) {
        const byAgent = fc.agents.length > 0 ? ` by ${fc.agents.join(', ')}` : '';
        summaryLines.push(
          `• [${fc.status.toUpperCase()}] ${fc.path}${byAgent} (+${fc.additions} / -${fc.deletions})`,
        );
      }
    }

    if (agentReports.length > 0) {
      summaryLines.push('');
      summaryLines.push(`Per-Agent Work Reports (${agentReports.length}):`);
      for (const ar of agentReports) {
        summaryLines.push(`• ${ar.agentName} [${ar.status.toUpperCase()}]: ${ar.workSummary}`);
      }
    }

    if (commands.length > 0) {
      summaryLines.push('');
      summaryLines.push(`Executed Sandbox Commands (${commands.length}):`);
      for (const cmd of commands) {
        const codeLabel =
          typeof cmd.exitCode === 'number' ? `exit ${cmd.exitCode}` : 'executed';
        summaryLines.push(`• ${cmd.command} (${cmd.agentName} · ${codeLabel})`);
      }
    }

    if (bugs.length > 0) {
      summaryLines.push('');
      summaryLines.push(`Logged Bugs & Improvements (${bugs.length}):`);
      for (const b of bugs) {
        summaryLines.push(`• [${b.category.toUpperCase()} · ${b.severity}] ${b.title} (${b.agentName})`);
      }
    }
  }

  return {
    runId,
    workflowName,
    language,
    status,
    roundsExecuted,
    durationMs,
    summaryText: summaryLines.join('\n'),
    stats: {
      addedFiles,
      modifiedFiles,
      deletedFiles,
      totalAdditions,
      totalDeletions,
      totalCommands: commands.length,
      totalBugs: bugs.length,
      totalErrors,
    },
    fileChanges,
    commands,
    bugs,
    agentReports,
    generatedAt: new Date().toISOString(),
  };
}
