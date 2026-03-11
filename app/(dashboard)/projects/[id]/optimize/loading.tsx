export default function Loading() {
  return (
    <div className="rounded-lg border border-border bg-white p-8 text-center">
      <div className="flex flex-col items-center gap-3 text-muted">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm font-medium">ローディング中です...</p>
        <p className="text-xs">切断計算画面を準備しています</p>
      </div>
    </div>
  )
}

