export interface NavItem {
  key: string;
  label: string;
  icon: string;
  hash: string;
  badge?: string;
}

export function Sidebar({
  items,
  active,
  collapsed,
  fdaLabel,
  onNavigate,
}: {
  items: NavItem[];
  active: string;
  collapsed: boolean;
  fdaLabel: string;
  onNavigate: (hash: string) => void;
}) {
  return (
    <div
      className="flex flex-none flex-col gap-[2px] border-r border-border bg-sidebar py-[12px] px-[10px]"
      style={{ width: collapsed ? 56 : 216 }}
    >
      {collapsed ? null : (
        <div className="px-[8px] pt-[6px] pb-[4px] text-[11px] [font-weight:600] uppercase tracking-[0.05em] text-text3">
          DiskWise
        </div>
      )}
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            title={item.label}
            onClick={() => onNavigate(item.hash)}
            className={`flex cursor-pointer items-center gap-[10px] rounded-[7px] py-[7px] px-[8px] text-[13px] text-text ${
              collapsed ? 'justify-center' : ''
            } ${isActive ? 'bg-active [font-weight:600]' : 'bg-transparent [font-weight:450]'}`}
          >
            <span className="w-[18px] flex-none text-center text-[13px]">{item.icon}</span>
            {collapsed ? null : (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge ? (
                  <span className="font-mono text-[10.5px] text-text3">{item.badge}</span>
                ) : null}
              </>
            )}
          </button>
        );
      })}
      <div className="flex-1" />
      <div
        className="flex items-center gap-[8px] border-t border-border2 py-[10px] px-[8px] text-[11.5px] text-text2"
        title={`Full Disk Access: ${fdaLabel}`}
      >
        <span
          className="h-[8px] w-[8px] flex-none rounded-full"
          style={{ background: fdaLabel === 'Granted' ? 'var(--t0-dot)' : 'var(--t2-dot)' }}
        />
        {collapsed ? null : <span>Full Disk Access: {fdaLabel}</span>}
      </div>
    </div>
  );
}
