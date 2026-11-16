import type {
  BugReportItem,
  ExecutionEvent,
  ExecutionRunSummary,
  FileDiffEntry,
  RunChangeFileEntry,
  RunChangeReport,
  RunCommandSummary,
} from '../types/workflow';

const PERSIAN_SCRIPT_REGEX = /[\u0600-\u06FF]/;
const LATIN_LETTER_REGEX = /[A-Za-z]/;

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').trim();
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
    fallbackLanguage = 'en',
  } = params;

  const language = detectConversationLanguage({
    taskPrompt,
    events,
    fallbackLanguage,
  });

  // Attribute write_file tool calls to responsible agent names
  const fileAgentsMap = new Map<string, Set<string>>();
  const commands: RunCommandSummary[] = [];

  for (const evt of events) {
    if (!evt.toolCalls || evt.toolCalls.length === 0) continue;
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
        });
      }
    }
  }
  const bugs = Array.from(bugMap.values());

  const participatingAgents = Array.from(
    new Set(
      events
        .filter((e) => e.type === 'agent_message' && e.agentName)
        .map((e) => e.agentName as string),
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
    },
    fileChanges,
    commands,
    bugs,
    generatedAt: new Date().toISOString(),
  };
}
