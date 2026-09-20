import { useState } from 'react';

// Shared failure note. "detail" is raw server text that may contain
// filesystem paths, so it stays hidden until the user opens it.
export function ErrorNote({
  message,
  detail,
  hint,
  onRetry,
  onDismiss,
}: {
  message: string;
  detail?: string;
  hint?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <div className="text-[12.5px] text-t2-fg">{message}</div>
      {hint ? <div className="text-[11.5px] text-text3">{hint}</div> : null}
      {detail ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="cursor-pointer border-none bg-transparent p-0 text-[11.5px] text-accent"
          >
            {open ? 'Hide details' : 'Show details'}
          </button>
          {open ? (
            <div className="break-words font-mono text-[11px] text-text3">{detail}</div>
          ) : null}
        </>
      ) : null}
      {onRetry || onDismiss ? (
        <div className="flex items-center gap-[12px]">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="cursor-pointer rounded-[6px] border border-card-line bg-transparent px-[12px] py-[6px] text-[12px] text-accent"
            >
              Try again
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-text3"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
