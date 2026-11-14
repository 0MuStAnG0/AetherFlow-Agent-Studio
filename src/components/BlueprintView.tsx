import { useEffect, useState } from 'react';
import { Check, Copy, FileCode2, FolderTree, ShieldCheck } from 'lucide-react';
import type { BlueprintFile } from '../types/workflow';

interface BlueprintViewProps {
  lang?: 'en' | 'fa';
  onRunDeployAudit?: () => void;
}

const DIRECTORY_TREE = `aetherflow-agent-studio/
├── install-linux.sh             # One-command Linux setup (--docker / --native / --systemd)
├── Dockerfile                   # Production Linux image (Node 22 + Python 3 + Vite dist)
├── docker-compose.yml           # Persistent SQLite + Sandbox + Host Ollama networking
├── .env.example                 # Linux runtime & LLM provider environment template
├── README.md                    # Step-by-step Linux install & systemd guide
├── server.ts                    # Express + WebSocket + SQLite production server
├── deploy/
│   ├── systemd/
│   │   └── aetherflow-studio.service
│   ├── docker-compose.yml       # Optional Python FastAPI + Sandbox compose stack
│   ├── backend/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── main.py              # FastAPI REST + WebSocket (/ws/run/{run_id})
│   │   ├── agent_engine.py      # LiteLLM (Gemini/OpenAI/Claude/Ollama) + GroupChat
│   │   ├── sandbox.py           # Docker SDK for Python isolated Linux execution
│   │   ├── database.py          # SQLite persistence for workflows & transcripts
│   │   └── models.py            # Pydantic v2 schemas
│   ├── sandbox/
│   │   └── Dockerfile.sandbox   # Non-root hardened Linux container (pytest, ruff)
│   └── frontend/
│       ├── Dockerfile           # Multi-stage Vite + Nginx static bundle
│       └── nginx.conf           # SPA + /api/* & /ws reverse proxy config
└── src/
    ├── components/
    │   ├── WorkflowCanvas.tsx   # React Flow v12 n8n-style graph canvas
    │   ├── AgentNode.tsx        # Custom node renderer with handles & status
    │   ├── AgentInspector.tsx   # Provider, model, temperature & prompt editor
    │   └── ExecutionConsole.tsx # WebSocket live stream + HITL approval gate
    └── utils/
        └── workflowEngine.ts    # Speaker routing, max_rounds & HITL guard`;

export function BlueprintView({ lang = 'en', onRunDeployAudit }: BlueprintViewProps) {
  const [files, setFiles] = useState<BlueprintFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('install-linux.sh');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/blueprint')
      .then((res) => res.json())
      .then((data: { files?: BlueprintFile[] }) => {
        if (!active) return;
        const list = data.files ?? [];
        setFiles(list);
        if (list.length > 0) {
          setSelectedPath(list[0].path);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const currentFile = files.find((f) => f.path === selectedPath) ?? files[0] ?? null;

  const handleCopy = async () => {
    if (!currentFile) return;
    await navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="mx-auto flex h-full w-full max-w-[1360px] flex-col gap-5 overflow-hidden p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
            {lang === 'fa'
              ? 'نصب و راه‌اندازی لینوکس و کدهای استقرار (Linux Deploy)'
              : 'Linux Installer & Deployment Blueprint (Phases 1–5)'}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {lang === 'fa'
              ? 'اسکریپت نصب خودکار لینوکس، Dockerfile، docker-compose.yml، سرویس systemd و ماژول‌های کامل استقرار.'
              : 'Ready-to-run Linux installer, production Dockerfile, docker-compose.yml, systemd service unit, and full-stack source files.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onRunDeployAudit && (
            <button
              type="button"
              data-testid="blueprint-deploy-audit-btn"
              onClick={onRunDeployAudit}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
            >
              <ShieldCheck className="h-4 w-4" />
              {lang === 'fa'
                ? 'تست خودکار و بررسی مدیر پیش از دپلوی'
                : 'Auto Test & Manager Audit before Deploy'}
            </button>
          )}
          <div
            dir="ltr"
            data-testid="linux-quickstart-cmd"
            className="rounded-lg border border-slate-200 bg-slate-900 px-3.5 py-2 font-mono text-xs text-slate-100 dark:border-slate-700"
          >
            chmod +x install-linux.sh &amp;&amp; ./install-linux.sh --check &amp;&amp; ./install-linux.sh
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-12">
        <aside className="flex flex-col gap-4 overflow-y-auto lg:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <FolderTree className="h-4 w-4 text-blue-600" />
              <span>Phase 1 · Linux Project Structure</span>
            </div>
            <pre
              dir="ltr"
              className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200"
            >
              {DIRECTORY_TREE}
            </pre>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="px-2 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {lang === 'fa' ? 'فایل‌های نصب لینوکس و معماری سیستم' : 'Linux Installer & Source Files'}
            </h2>
            {loading ? (
              <div className="space-y-2 p-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : (
              <div className="mt-1 space-y-1">
                {files.map((file) => {
                  const active = currentFile?.path === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                        active
                          ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <FileCode2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs font-medium">{file.path}</div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {file.phase}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-8">
          {currentFile ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div>
                  <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {currentFile.path}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {currentFile.phase} · {currentFile.summary}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy Code'}
                </button>
              </div>
              <pre
                dir="ltr"
                className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100"
              >
                <code>{currentFile.content}</code>
              </pre>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
              Loading blueprint source files...
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
