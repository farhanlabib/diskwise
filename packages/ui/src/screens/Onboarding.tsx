import { useState } from 'react';
import { copyText } from '../lib/clipboard';
import { usePermissions } from '../api/hooks';

export function Onboarding({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [copied, setCopied] = useState(false);
  const permissions = usePermissions();
  const hostApp = permissions?.hostApp ?? 'Terminal';
  const granted = permissions?.fullDiskAccess === 'granted';

  return (
    <div className="flex flex-1 items-center justify-center bg-content p-[40px]">
      <div className="w-full max-w-[520px]">
        <div className="flex h-[48px] w-[48px] items-center justify-center rounded-[12px] bg-accent text-[18px] [font-weight:700] tracking-[-0.02em] text-white">
          MS
        </div>
        <div className="mt-[20px] text-[26px] [font-weight:660] tracking-[-0.02em]">
          Grant Full Disk Access to {hostApp}
        </div>
        <div className="mt-[8px] text-[13.5px] leading-[1.6] text-text2">
          MacSweep runs inside your terminal, so access is granted to the terminal app that
          launched it. Without it, parts of Mail, Messages and Safari are unreadable and get
          reported as "Unreadable".
        </div>
        <div className="mt-[20px] rounded-[10px] border border-card-line bg-card p-[18px]">
          <div className="text-[12.5px] leading-[1.9] text-text">
            1. Open System Settings → Privacy &amp; Security → Full Disk Access
            <br />
            2. Enable <b>{hostApp}</b>
            <br />
            3. Quit and re-run the command below
          </div>
          <div className="mt-[14px] flex items-center gap-[10px] rounded-[7px] border border-border bg-win px-[12px] py-[9px]">
            <span className="flex-1 font-mono text-[12.5px]">macsweep ui</span>
            <button
              type="button"
              onClick={() => {
                void copyText('macsweep ui').then((ok) => {
                  if (ok) {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  }
                });
              }}
              className="cursor-pointer rounded-[5px] border-none bg-accent px-[11px] py-[5px] text-[11.5px] text-white"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="mt-[16px] flex items-center gap-[8px] text-[12.5px] text-text2">
          <span
            className="h-[8px] w-[8px] rounded-full"
            style={{ background: 'var(--t2-dot)' }}
          />
          Status: {granted ? 'Full access' : 'Limited access'}
        </div>
        <div className="mt-[16px] text-[12px] leading-[1.6] text-text3">
          Runs only on this Mac. No outbound network. No telemetry. Nothing is deleted without your
          confirmation.
        </div>
        <div className="mt-[22px] flex gap-[12px]">
          <button
            type="button"
            onClick={() => onNavigate('#/scanning')}
            className="cursor-pointer rounded-[8px] border-none bg-accent px-[20px] py-[11px] text-[13.5px] [font-weight:600] text-white"
          >
            Continue with limited access
          </button>
        </div>
      </div>
    </div>
  );
}
