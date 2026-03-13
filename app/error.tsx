 'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // TODO: send to logging service (Sentryなど)
    console.error(error)
  }, [error])

  return (
    <html lang="ja">
      <body className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-4">
          <h1 className="text-xl font-bold">予期しないエラーが発生しました</h1>
          <p className="text-sm text-muted">
            一時的な問題の可能性があります。お手数ですが、再度お試しください。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
            >
              再試行する
            </button>
            <button
              type="button"
              onClick={() => (window.location.href = '/')}
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-white transition-colors"
            >
              トップに戻る
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-black/80 p-3 text-xs text-gray-100">
              {error.message}
              {error.digest ? `\n\nDigest: ${error.digest}` : null}
            </pre>
          )}
        </div>
      </body>
    </html>
  )
}

