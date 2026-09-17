import { useState } from 'react';
import { copyText } from '../lib/clipboard';

export function CopyCommandCard({
  command,
  note = 'Needs root — run this yourself:',
  buttonLabel = 'Copy command',
}: {
  command: string;
  note?: string;
  buttonLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-[16px] rounded-[8px] border border-border bg-win p-[12px]">
      <div className="mb-[6px] text-[11px] text-text3">{note}</div>
      <div className="font-mono text-[11.5px] break-all text-text">{command}</div>
      <button
        type="button"
        onClick={() => {
          void copyText(command).then((ok) => {
            if (ok) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }
          });
        }}
        className="mt-[10px] cursor-pointer rounded-[6px] border-none bg-accent px-[12px] py-[6px] text-[11.5px] text-accent-fg"
      >
        {copied ? 'Copied' : buttonLabel}
      </button>
    </div>
  );
}
