import { useEffect, useState } from 'react';
import { copyText } from '../lib/clipboard';

export type SessionVariant = 'stopped' | 'invalid-link' | 'reconnecting';

export function Session({
  variant,
  onNavigate,
}: {
  variant: SessionVariant;
  onNavigate: (hash: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [variant]);

  const copy = () => {
    void copyText('diskwise ui').then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }
    });
  };

  if (variant === 'reconnecting') {
    return (
      <div className="flex flex-1 items-center justify-center bg-content p-[40px]">
        <div className="w-full max-w-[420px] text-center">
          <div
            className="mx-auto h-[22px] w-[22px] rounded-full border-[2.5px] border-border"
            style={{ borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }}
          />
          <div className="mt-[16px] text-[20px] [font-weight:640]">Reconnecting…</div>
          <div className="mt-[8px] text-[13px] text-text2">
            The progress stream dropped. DiskWise is trying to reconnect to the local server.
          </div>
          <button
            type="button"
            onClick={() => onNavigate('#/overview')}
            className="mt-[20px] cursor-pointer border-none bg-transparent text-[12.5px] text-accent"
          >
            Back to Overview
          </button>
        </div>
      </div>
    );
  }

  if (variant === 'invalid-link') {
    return (
      <div className="flex flex-1 items-center justify-center bg-content p-[40px]">
        <div className="w-full max-w-[420px] text-center">
          <div className="text-[22px] [font-weight:640]">This link isn't valid any more.</div>
          <div className="mt-[8px] text-[13px] text-text2">
            Open DiskWise from your terminal: run the command below.
          </div>
          <div className="mt-[18px] flex items-center gap-[10px] rounded-[8px] border border-card-line bg-card px-[14px] py-[11px]">
            <span className="flex-1 text-left font-mono text-[13px]">diskwise ui</span>
            <button
              type="button"
              onClick={copy}
              className="cursor-pointer rounded-[5px] border-none bg-accent px-[12px] py-[5px] text-[11.5px] text-white"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-content p-[40px]">
      <div className="w-full max-w-[420px] text-center">
        <div className="text-[22px] [font-weight:640]">DiskWise has stopped.</div>
        <div className="mt-[8px] text-[13px] text-text2">
          Run the command below in your terminal to start it again.
        </div>
        <div className="mt-[18px] flex items-center gap-[10px] rounded-[8px] border border-card-line bg-card px-[14px] py-[11px]">
          <span className="flex-1 text-left font-mono text-[13px]">diskwise ui</span>
          <button
            type="button"
            onClick={copy}
            className="cursor-pointer rounded-[5px] border-none bg-accent px-[12px] py-[5px] text-[11.5px] text-white"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('#/onboarding')}
          className="mt-[20px] cursor-pointer border-none bg-transparent text-[12.5px] text-accent"
        >
          Start again
        </button>
      </div>
    </div>
  );
}
