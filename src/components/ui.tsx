/** Page frame. `app` screens use the full window width on desktop (lg and up). */
export function Shell({ children, wide, app }: { children: React.ReactNode; wide?: boolean; app?: boolean }) {
  const width = app ? 'max-w-xl lg:max-w-none' : wide ? 'max-w-3xl' : 'max-w-xl';
  return <main className={`mx-auto flex min-h-dvh w-full flex-col bg-white text-ink ${width}`}>{children}</main>;
}

export function Header({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white px-5 lg:px-8">
      {left}
      <span className="flex items-center gap-1.5" aria-label="wienerberger">
        <img src="/w-symbol.png" alt="" className="h-7 w-7" />
        <img src="/wienerberger-logo.svg" alt="wienerberger" className="h-[17px] w-auto" />
      </span>
      <span className="flex-1" />
      {right}
    </header>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-block rounded-wb bg-brand px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">{children}</span>;
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function PrimaryButton({ className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`flex w-full items-center justify-center gap-2 rounded-wb bg-brand py-4 text-[15px] font-bold uppercase tracking-wide text-white transition hover:bg-brand-dark disabled:bg-line disabled:text-muted ${className}`}
    />
  );
}

export function SecondaryButton({ className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`flex w-full items-center justify-center gap-2 rounded-wb border-2 border-brand bg-white py-[14px] text-[15px] font-bold uppercase tracking-wide text-brand transition hover:bg-brand hover:text-white disabled:border-line disabled:text-muted disabled:hover:bg-white ${className}`}
    />
  );
}
