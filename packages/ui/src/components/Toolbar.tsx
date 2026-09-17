export function Toolbar({
  title = 'DiskWise',
  themeLabel,
  onToggleTheme,
  onStopServer,
}: {
  title?: string;
  themeLabel: string;
  onToggleTheme: () => void;
  onStopServer: () => void;
}) {
  return (
    <div className="flex h-[52px] flex-none items-center gap-[14px] border-b border-border bg-toolbar px-[16px]">
      <div className="flex items-center gap-[8px]">
        <div className="h-[12px] w-[12px] rounded-full bg-[#ff5f57]" />
        <div className="h-[12px] w-[12px] rounded-full bg-[#febc2e]" />
        <div className="h-[12px] w-[12px] rounded-full bg-[#28c840]" />
      </div>
      <div className="ml-[6px] text-[13px] [font-weight:600] tracking-[-0.01em]">{title}</div>
      <div className="flex-1" />
      <div className="flex items-center gap-[6px] rounded-[6px] border border-card-line bg-card px-[9px] py-[4px] text-[11.5px] text-text2">
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--t0-dot)' }} />
        <span className="font-mono">Local · {window.location.host}</span>
      </div>
      <button
        type="button"
        onClick={onToggleTheme}
        className="cursor-pointer rounded-[6px] border border-card-line bg-card px-[10px] py-[5px] text-[11.5px] text-text2"
      >
        {themeLabel}
      </button>
      <button
        type="button"
        onClick={onStopServer}
        className="cursor-pointer rounded-[6px] border border-card-line bg-card px-[10px] py-[5px] text-[11.5px] text-text2"
      >
        Stop server
      </button>
    </div>
  );
}
