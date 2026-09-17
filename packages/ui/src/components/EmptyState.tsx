export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[4px] px-[24px] py-[48px] text-center">
      <div className="text-[13px] text-text3">{message}</div>
      {hint ? <div className="text-[12px] text-text3">{hint}</div> : null}
    </div>
  );
}
