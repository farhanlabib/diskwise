export function TypedConfirmField({
  expected,
  value,
  onChange,
  prompt = 'to confirm the Tier 2 deletion:',
}: {
  expected: string;
  value: string;
  onChange: (value: string) => void;
  prompt?: string;
}) {
  return (
    <div>
      <div className="mb-[8px] text-[12.5px] text-text">
        Type{' '}
        <span className="rounded-[4px] bg-card px-[6px] py-[1px] font-mono">{expected}</span>{' '}
        {prompt}
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={expected}
        aria-label={`Type ${expected} ${prompt.replace(/:$/, '')}`}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-[7px] border border-border bg-content px-[12px] py-[9px] font-mono text-[13px] text-text outline-none"
      />
    </div>
  );
}
