import { useState } from 'react';
import type { AuditResult } from '@diskwise/core/types';
import { serverInfo } from '../mock/data';
import { useMock } from '../api/client';
import { auditMarkdown, downloadMarkdown } from '../lib/markdown';
import {
  loadSettings,
  saveSettings,
  type Settings as SettingsValues,
  type ThemePreference,
} from '../lib/settings';
import { setThemePreference } from '../lib/theme';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Settings({
  onStopServer,
  audit,
}: {
  onStopServer: () => void;
  audit?: AuditResult;
}) {
  const [values, setValues] = useState<SettingsValues>(() => loadSettings());

  const update = (patch: Partial<SettingsValues>) => {
    setValues(saveSettings(patch));
  };

  const setTheme = (theme: ThemePreference) => {
    setValues((current) => ({ ...current, theme }));
    setThemePreference(theme);
  };

  const exportMarkdown = () => {
    if (!audit) return;
    const markdown = auditMarkdown(audit, { redact: values.redact });
    downloadMarkdown(`diskwise-report-${audit.generatedAt.slice(0, 10)}.md`, markdown);
  };

  return (
    <div className="max-w-[640px] flex-1 overflow-y-auto px-[36px] py-[32px]">
      <div className="text-[22px] [font-weight:640] tracking-[-0.02em]">Settings</div>
      <div className="mt-[22px] flex flex-col gap-[18px]">
        <div className="rounded-[10px] border border-card-line bg-card p-[18px]">
          <div className="mb-[12px] text-[13px] [font-weight:600]">Appearance</div>
          <div className="flex items-center justify-between py-[8px] text-[13px]">
            <span>Theme</span>
            <div className="flex gap-[6px]">
              {THEME_OPTIONS.map((option) => {
                const active = values.theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-testid={`theme-${option.value}`}
                    onClick={() => setTheme(option.value)}
                    className="cursor-pointer rounded-[7px] border border-card-line px-[12px] py-[5px] text-[12px]"
                    style={{
                      background: active ? 'var(--accent)' : 'var(--card)',
                      color: active ? 'var(--accent-fg)' : 'var(--text2)',
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-[10px] border border-card-line bg-card p-[18px]">
          <div className="mb-[12px] text-[13px] [font-weight:600]">Scan</div>
          <Row label="Scan scope" value="Home only" mono />
          <div className="flex items-center justify-between border-t border-border2 py-[8px] text-[13px]">
            <span>node_modules age threshold</span>
            <div className="flex items-center gap-[8px]">
              <input
                type="number"
                min={1}
                value={values.nodeModulesAgeDays}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  update({ nodeModulesAgeDays: Number.isFinite(next) ? next : 14 });
                }}
                className="w-[64px] rounded-[6px] border border-card-line bg-win px-[8px] py-[4px] text-right font-mono text-[12px] text-text outline-none"
              />
              <span className="text-[12px] text-text2">days</span>
            </div>
          </div>
          <div className="pb-[8px] text-[11px] text-text3">Used by the next CLI release</div>
          <div className="flex items-center justify-between border-t border-border2 py-[8px] text-[13px]">
            <span>Redact usernames in exported reports</span>
            <button
              type="button"
              role="switch"
              aria-checked={values.redact}
              onClick={() => update({ redact: !values.redact })}
              className="relative h-[20px] w-[34px] cursor-pointer rounded-[10px] border-none p-0"
              style={{ background: values.redact ? 'var(--t0-dot)' : 'var(--border)' }}
            >
              <span
                className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white"
                style={{ right: values.redact ? '2px' : '16px' }}
              />
            </button>
          </div>
        </div>

        <div className="rounded-[10px] border border-card-line bg-card p-[18px]">
          <div className="mb-[12px] text-[13px] [font-weight:600]">Local server</div>
          <Row label="Address" value={window.location.host} mono />
          <Row label="Uptime" value={useMock ? serverInfo.uptime : '—'} mono />
          <button
            type="button"
            onClick={onStopServer}
            className="mt-[12px] cursor-pointer rounded-[7px] border border-card-line bg-transparent px-[14px] py-[7px] text-[12.5px] text-[#d9544f]"
          >
            Stop server
          </button>
        </div>

        <div className="rounded-[10px] border border-card-line bg-card p-[18px]">
          <div className="mb-[8px] text-[13px] [font-weight:600]">About</div>
          <div className="text-[12.5px] leading-[1.6] text-text2">
            DiskWise v1.0 · Open source, MIT ·{' '}
            <span className="text-text">No outbound network. No telemetry.</span>
          </div>
          <div className="mt-[12px] flex gap-[10px]">
            <button
              type="button"
              onClick={exportMarkdown}
              disabled={!audit}
              className="cursor-pointer rounded-[6px] border border-card-line bg-win px-[13px] py-[7px] text-[12px] text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export Markdown
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-[6px] border border-card-line bg-win px-[13px] py-[7px] text-[12px] text-text"
            >
              Export JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  divider = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-[8px] text-[13px] ${
        divider ? 'border-t border-border2' : ''
      }`}
    >
      <span>{label}</span>
      <span className={mono ? 'font-mono text-text2' : 'text-text2'}>{value}</span>
    </div>
  );
}
