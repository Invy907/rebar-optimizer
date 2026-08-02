export function GlobalLoadingOverlay({
  message = '読み込み中...',
}: {
  message?: string
}) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/70 backdrop-blur-[1px] print:hidden"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-white px-8 py-6 shadow-lg">
        <span className="inline-block h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-foreground">{message}</p>
      </div>
    </div>
  )
}
