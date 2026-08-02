export function GlobalLoadingOverlay({
  message = '読み込み中',
}: {
  message?: string
}) {
  return (
    <div className="print:hidden" role="status" aria-live="polite" aria-busy="true">
      <div className="fixed inset-x-0 top-0 z-[10000] h-[3px] overflow-hidden bg-primary/10">
        <div className="app-loading-bar h-full w-full origin-left rounded-full bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
      </div>

      <div className="app-loading-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/10 backdrop-blur-[2px]">
        <div className="app-loading-card flex flex-col items-center gap-4 rounded-2xl border border-border/70 bg-white/95 px-10 py-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.25)]">
          <span className="relative flex h-12 w-12 items-center justify-center">
            <span className="absolute inset-0 rounded-full border-[3px] border-slate-200/80" />
            <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-r-primary border-t-primary" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary/60" />
          </span>

          <p className="flex items-center gap-0.5 text-sm font-medium tracking-tight text-foreground">
            {message}
            <span className="app-loading-dot" style={{ animationDelay: '0ms' }}>
              .
            </span>
            <span className="app-loading-dot" style={{ animationDelay: '160ms' }}>
              .
            </span>
            <span className="app-loading-dot" style={{ animationDelay: '320ms' }}>
              .
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
