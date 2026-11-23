/** The same heading block on every screen: title, one line of context, and the screen's main actions. */
export function PageHeader({ title, note, children }: { title: string; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="display text-[30px] sm:text-[36px]">{title}</h1>
        {note && <p className="mt-1.5 max-w-2xl text-sm text-mute sm:text-[15px]">{note}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
