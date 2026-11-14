import { useEffect, useState } from 'react';
import { Briefcase, Layers, Plus, Sparkles, X } from 'lucide-react';
import {
  AGENT_SECTIONS,
  AGENT_SPECIALTY_PRESETS,
  POWER_LEVEL_META,
  type AgentRoleTemplate,
  type AgentSpecialtyPreset,
} from '../data/agentTemplates';
import type {
  AgentNodeData,
  AgentPowerLevel,
  AgentRole,
  AppSettings,
  CustomAgentTemplate,
  LLMProvider,
} from '../types/workflow';
import { getEffectiveProviderModels } from '../utils/catalogUtils';

export interface AgentBuilderSubmitPayload {
  mode: 'add_agents' | 'save_template';
  templateId?: string;
  count: number;
  label: string;
  subtitle: string;
  role: AgentRole;
  section: string;
  positionTitle: string;
  responsibility: string;
  powerLevel: AgentPowerLevel;
  provider: LLMProvider;
  model: string;
  temperature: number;
  systemPrompt: string;
  tools: AgentNodeData['tools'];
  autoConnect: boolean;
  saveAsTemplate: boolean;
}

interface AgentBuilderModalProps {
  isOpen: boolean;
  mode: 'add_agents' | 'edit_template';
  initialTemplate?: AgentRoleTemplate | null;
  lang: 'en' | 'fa';
  appSettings: AppSettings;
  onClose: () => void;
  onSubmit: (payload: AgentBuilderSubmitPayload) => Promise<void> | void;
}

const ROLE_OPTIONS: Array<{ value: AgentRole; en: string; fa: string }> = [
  { value: 'manager', en: 'Manager / Orchestrator', fa: 'مدیر / هماهنگ‌کننده' },
  { value: 'backend', en: 'Backend Engineer', fa: 'مهندس بک‌اند' },
  { value: 'frontend', en: 'Frontend Engineer', fa: 'مهندس فرانت‌اند' },
  { value: 'security_qa', en: 'Security & QA', fa: 'امنیت و تست' },
  { value: 'executor', en: 'DevOps / Executor', fa: 'اجراگر و DevOps' },
  { value: 'custom', en: 'Custom Specialist', fa: 'متخصص سفارشی' },
];

export function AgentBuilderModal({
  isOpen,
  mode,
  initialTemplate,
  lang,
  appSettings,
  onClose,
  onSubmit,
}: AgentBuilderModalProps) {
  const isFa = lang === 'fa';

  const [count, setCount] = useState(1);
  const [label, setLabel] = useState('Specialist Agent');
  const [role, setRole] = useState<AgentRole>('custom');
  const [section, setSection] = useState('Backend & API');
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState<string>('');
  const [positionTitle, setPositionTitle] = useState('Senior Specialist');
  const [responsibility, setResponsibility] = useState(
    'Deliver production-grade code, validation, and tests for the assigned module.',
  );
  const [powerLevel, setPowerLevel] = useState<AgentPowerLevel>('pro');
  const [provider, setProvider] = useState<LLMProvider>('gemini');
  const [model, setModel] = useState('gemini-4-hydrogen');
  const [temperature, setTemperature] = useState(0.2);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [tools, setTools] = useState<AgentNodeData['tools']>({
    readFile: true,
    writeFile: true,
    execBash: false,
  });
  const [autoConnect, setAutoConnect] = useState(true);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initialTemplate) {
      setCount(1);
      setLabel(initialTemplate.title);
      setRole(initialTemplate.role);
      setSection(initialTemplate.section);
      setSelectedSpecialtyId('');
      setPositionTitle(initialTemplate.positionTitle);
      setResponsibility(initialTemplate.responsibility || initialTemplate.subtitle);
      setPowerLevel(initialTemplate.powerLevel);
      setProvider(initialTemplate.defaultProvider);
      setModel(initialTemplate.defaultModel);
      setTemperature(initialTemplate.defaultTemperature);
      setSystemPrompt(initialTemplate.systemPrompt);
      setTools({ ...initialTemplate.defaultTools });
      setSaveAsTemplate(false);
    } else {
      const defProv: LLMProvider = 'gemini';
      const provModels = getEffectiveProviderModels(defProv, appSettings.providers[defProv]);
      setCount(1);
      setLabel(isFa ? 'ایجنت متخصص جدید' : 'Custom Specialist');
      setRole('custom');
      setSection('Backend & API');
      setSelectedSpecialtyId('');
      setPositionTitle(isFa ? 'متخصص بخش پروژه' : 'Domain Specialist');
      setResponsibility(
        isFa
          ? 'توسعه، بررسی خطاها و هماهنگی با تیم در بخش محول‌شده.'
          : 'Design, implement, and verify features in the assigned project domain.',
      );
      setPowerLevel('pro');
      setProvider(defProv);
      setModel(appSettings.providers[defProv]?.defaultModel || provModels[0]?.id || 'gemini-4-hydrogen');
      setTemperature(0.2);
      setSystemPrompt('');
      setTools({
        readFile: appSettings.allowReadFile,
        writeFile: appSettings.allowWriteFile,
        execBash: false,
      });
      setAutoConnect(true);
      setSaveAsTemplate(false);
    }
  }, [isOpen, initialTemplate, appSettings, isFa]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const effectiveModels = getEffectiveProviderModels(provider, appSettings.providers[provider]);
  const isPredefinedSection = AGENT_SECTIONS.some((s) => s.id === section);
  const sectionSpecialties = AGENT_SPECIALTY_PRESETS.filter((sp) => sp.section === section);

  const applySpecialtyPreset = (preset: AgentSpecialtyPreset) => {
    setSelectedSpecialtyId(preset.id);
    setSection(preset.section);
    setRole(preset.role);
    setLabel(isFa ? preset.faTitle : preset.enTitle);
    setPositionTitle(isFa ? preset.faPosition : preset.enPosition);
    setResponsibility(isFa ? preset.faResponsibility : preset.enResponsibility);
    setPowerLevel(preset.powerLevel);
    setTemperature(POWER_LEVEL_META[preset.powerLevel].defaultTemp);
    setSystemPrompt(preset.systemPrompt);
    setTools({
      readFile: preset.defaultTools.readFile && appSettings.allowReadFile,
      writeFile: preset.defaultTools.writeFile && appSettings.allowWriteFile,
      execBash: preset.defaultTools.execBash && appSettings.allowExecBash,
    });
  };

  const handleProviderChange = (nextProv: LLMProvider) => {
    setProvider(nextProv);
    const list = getEffectiveProviderModels(nextProv, appSettings.providers[nextProv]);
    setModel(appSettings.providers[nextProv]?.defaultModel || list[0]?.id || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        mode: mode === 'edit_template' ? 'save_template' : 'add_agents',
        templateId: initialTemplate?.id,
        count: mode === 'edit_template' ? 1 : count,
        label: label.trim(),
        subtitle: responsibility.trim() || positionTitle.trim(),
        role,
        section: section.trim() || 'General',
        positionTitle: positionTitle.trim() || label.trim(),
        responsibility: responsibility.trim(),
        powerLevel,
        provider,
        model: model.trim() || effectiveModels[0]?.id || 'gemini-4-hydrogen',
        temperature,
        systemPrompt:
          systemPrompt.trim() ||
          `You are ${positionTitle.trim() || label.trim()} in the ${section.trim() || 'General'} section. Responsibility: ${responsibility.trim()}.`,
        tools,
        autoConnect,
        saveAsTemplate,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-builder-title"
        data-testid="agent-builder-modal"
        dir={isFa ? 'rtl' : 'ltr'}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2
              id="agent-builder-title"
              className="flex items-center gap-2 font-display text-base font-bold text-slate-900 dark:text-slate-100"
            >
              <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>
                {mode === 'edit_template'
                  ? isFa
                    ? 'ویرایش قالب نقش ایجنت'
                    : 'Edit Agent Role Template'
                  : isFa
                    ? 'ساخت و افزودن ایجنت دلخواه برای پروژه'
                    : 'Build & Add Project Agents'}
              </span>
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isFa
                ? 'بخش، تخصص، پست، مسئولیت، سطح قدرت، مدل هوش مصنوعی و تعداد ایجنت مورد نیاز پروژه را تعیین کنید.'
                : 'Configure department, specialty preset, position, responsibility, power tier, AI model, and agent count.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isFa ? 'بستن فرم ساخت ایجنت' : 'Close agent builder'}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Department & Specialty Preset Quick Selector */}
          <div className="rounded-xl border border-blue-200/80 bg-blue-50/50 p-3.5 dark:border-blue-900/60 dark:bg-blue-950/25">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="builder-section-select"
                  className="block text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  {isFa
                    ? `بخش / دپارتمان پروژه (${AGENT_SECTIONS.length} دپارتمان تخصصی)`
                    : `Project Section / Department (${AGENT_SECTIONS.length} Departments)`}
                </label>
                <select
                  id="builder-section-select"
                  data-testid="builder-section-select"
                  value={isPredefinedSection ? section : '__custom__'}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__custom__') {
                      setSection('');
                      setSelectedSpecialtyId('');
                    } else {
                      setSection(val);
                      setSelectedSpecialtyId('');
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {AGENT_SECTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {isFa ? `${s.fa} (${s.en})` : `${s.en} — ${s.fa}`}
                    </option>
                  ))}
                  <option value="__custom__">
                    {isFa ? 'سایر / دپارتمان سفارشی...' : 'Custom Department...'}
                  </option>
                </select>
                <input
                  id="builder-section-input"
                  data-testid="builder-section-input"
                  list="builder-section-options"
                  type="text"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  placeholder={
                    isFa
                      ? 'نام دپارتمان یا بخش دلخواه را بنویسید...'
                      : 'Or type custom department / section name...'
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                />
                <datalist id="builder-section-options">
                  {AGENT_SECTIONS.map((s) => (
                    <option key={s.id} value={s.id} />
                  ))}
                </datalist>
              </div>

              <div>
                <label
                  htmlFor="builder-specialty-select"
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  <Briefcase className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>
                    {isFa
                      ? `تخصص و پست آماده (${AGENT_SPECIALTY_PRESETS.length} تخصص)`
                      : `Specialty & Role Preset (${AGENT_SPECIALTY_PRESETS.length} Specialties)`}
                  </span>
                </label>
                <select
                  id="builder-specialty-select"
                  data-testid="builder-specialty-select"
                  value={selectedSpecialtyId}
                  onChange={(e) => {
                    const spec = AGENT_SPECIALTY_PRESETS.find((sp) => sp.id === e.target.value);
                    if (spec) {
                      applySpecialtyPreset(spec);
                    } else {
                      setSelectedSpecialtyId('');
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">
                    {isFa
                      ? 'انتخاب تخصص آماده برای پر شدن خودکار فرم...'
                      : 'Select a specialty preset to auto-fill fields...'}
                  </option>
                  {sectionSpecialties.length > 0 && (
                    <optgroup
                      label={
                        isFa
                          ? `تخصص‌های بخش انتخاب‌شده (${section})`
                          : `Specialties in ${section}`
                      }
                    >
                      {sectionSpecialties.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {isFa
                            ? `${sp.faTitle} — ${sp.faPosition}`
                            : `${sp.enTitle} — ${sp.enPosition}`}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup
                    label={
                      isFa ? 'همه تخصص‌های مهندسی نرم‌افزار' : 'All Engineering Specialties'
                    }
                  >
                    {AGENT_SPECIALTY_PRESETS.map((sp) => (
                      <option key={`all-${sp.id}`} value={sp.id}>
                        {isFa
                          ? `[${sp.section}] ${sp.faTitle}`
                          : `[${sp.section}] ${sp.enTitle}`}
                      </option>
                    ))}
                  </optgroup>
                </select>

                {sectionSpecialties.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="builder-specialty-chips">
                    {sectionSpecialties.map((sp) => {
                      const active = selectedSpecialtyId === sp.id;
                      return (
                        <button
                          key={sp.id}
                          type="button"
                          data-testid={`specialty-chip-${sp.id}`}
                          onClick={() => applySpecialtyPreset(sp)}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                            active
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-blue-200 bg-white text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-200 dark:hover:bg-blue-950'
                          }`}
                        >
                          {isFa ? sp.faTitle : sp.enTitle}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className={mode === 'edit_template' ? 'sm:col-span-7' : 'sm:col-span-5'}>
              <label
                htmlFor="builder-agent-label"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'نام ایجنت / عنوان' : 'Agent Name'}
              </label>
              <input
                id="builder-agent-label"
                data-testid="builder-label-input"
                type="text"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-5">
              <label
                htmlFor="builder-role-select"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'نقش سیستمی' : 'System Role'}
              </label>
              <select
                id="builder-role-select"
                data-testid="builder-role-select"
                value={role}
                onChange={(e) => setRole(e.target.value as AgentRole)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {isFa ? opt.fa : opt.en}
                  </option>
                ))}
              </select>
            </div>

            {mode === 'add_agents' && (
              <div className="sm:col-span-2">
                <label
                  htmlFor="builder-count-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  {isFa ? 'تعداد' : 'Count'}
                </label>
                <input
                  id="builder-count-input"
                  data-testid="builder-count-input"
                  type="number"
                  min={1}
                  max={10}
                  value={count}
                  onChange={(e) =>
                    setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-center font-mono text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="builder-position-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'پست و عنوان شغلی' : 'Position / Post'}
              </label>
              <input
                id="builder-position-input"
                data-testid="builder-position-input"
                type="text"
                value={positionTitle}
                onChange={(e) => setPositionTitle(e.target.value)}
                placeholder={isFa ? 'مثلاً معمار ارشد دیتابیس' : 'e.g. Principal Schema Architect'}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="builder-responsibility-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isFa ? 'مسئولیت دقیق در پروژه' : 'Specific Responsibility'}
              </label>
              <input
                id="builder-responsibility-input"
                data-testid="builder-responsibility-input"
                type="text"
                value={responsibility}
                onChange={(e) => setResponsibility(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Power Level Selector */}
          <div>
            <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isFa ? 'قدرت و سطح استدلال ایجنت' : 'Agent Power Level'}
            </span>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['eco', 'standard', 'pro', 'ultra'] as AgentPowerLevel[]).map((lvl) => {
                const info = POWER_LEVEL_META[lvl];
                const active = powerLevel === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    data-testid={`builder-power-${lvl}`}
                    onClick={() => {
                      setPowerLevel(lvl);
                      setTemperature(info.defaultTemp);
                    }}
                    className={`rounded-lg border px-2.5 py-2 text-start transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-200'
                        : 'border-slate-200 bg-slate-50/60 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span>{info.short}</span>
                      <Sparkles className="h-3 w-3 opacity-70" />
                    </div>
                    <div className="mt-0.5 text-[10px] opacity-80">
                      {isFa ? info.fa : info.en}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider & Model */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" dir="ltr">
            <div>
              <label
                htmlFor="builder-provider-select"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                LLM Provider
              </label>
              <select
                id="builder-provider-select"
                data-testid="builder-provider-select"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="gemini">Google Gemini</option>
                <option value="opencode">OpenCode Zen (Free)</option>
                <option value="openai">OpenAI ChatGPT</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="ollama">Local Ollama</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="builder-model-select"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                AI Model
              </label>
              <select
                id="builder-model-select"
                data-testid="builder-model-select"
                value={effectiveModels.some((m) => m.id === model) ? model : '__custom__'}
                onChange={(e) => {
                  if (e.target.value !== '__custom__') {
                    setModel(e.target.value);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {effectiveModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName ? `${m.displayName} (${m.id})` : m.id} ·{' '}
                    {POWER_LEVEL_META[m.power].short}
                  </option>
                ))}
                <option value="__custom__">Custom Model ID...</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="builder-prompt-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {isFa ? 'دستورالعمل سیستمی (اختیاری)' : 'System Prompt (optional — auto-generated if blank)'}
            </label>
            <textarea
              id="builder-prompt-input"
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={
                isFa
                  ? 'در صورت خالی بودن بر اساس بخش، پست و مسئولیت به‌صورت خودکار ساخته می‌شود...'
                  : 'Leave blank to auto-generate from section, position, responsibility, and power...'
              }
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
            <label className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={tools.readFile}
                onChange={(e) => setTools({ ...tools, readFile: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>READ_FILE</span>
            </label>
            <label className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={tools.writeFile}
                onChange={(e) => setTools({ ...tools, writeFile: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>WRITE_FILE</span>
            </label>
            <label className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={tools.execBash}
                onChange={(e) => setTools({ ...tools, execBash: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>EXEC_BASH</span>
            </label>
          </div>

          {mode === 'add_agents' && (
            <div className="flex flex-wrap items-center gap-5 text-xs">
              <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={autoConnect}
                  onChange={(e) => setAutoConnect(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                <span>
                  {isFa
                    ? 'اتصال خودکار به ایجنت مدیر (در صورت وجود)'
                    : 'Auto-connect from Manager Agent'}
                </span>
              </label>

              <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  data-testid="builder-save-template-checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                <span>
                  {isFa ? 'ذخیره در لیست قالب‌های نقش' : 'Save also as reusable Role Template'}
                </span>
              </label>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {isFa ? 'انصراف' : 'Cancel'}
            </button>
            <button
              type="submit"
              data-testid="builder-submit-btn"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>
                {mode === 'edit_template'
                  ? isFa
                    ? 'ذخیره تغییرات قالب'
                    : 'Save Template'
                  : isFa
                    ? `افزودن ${count} ایجنت به پروژه`
                    : `Add ${count} Agent${count > 1 ? 's' : ''} to Canvas`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function payloadToCustomTemplate(
  payload: AgentBuilderSubmitPayload,
  existingId?: string,
): CustomAgentTemplate {
  return {
    id: existingId || `tpl-custom-${Date.now().toString(36)}`,
    role: payload.role,
    title: payload.label,
    subtitle: payload.subtitle || payload.responsibility,
    section: payload.section,
    positionTitle: payload.positionTitle,
    responsibility: payload.responsibility,
    powerLevel: payload.powerLevel,
    defaultProvider: payload.provider,
    defaultModel: payload.model,
    defaultTemperature: payload.temperature,
    defaultTools: { ...payload.tools },
    systemPrompt: payload.systemPrompt,
  };
}
