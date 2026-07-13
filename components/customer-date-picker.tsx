'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const y = Number.parseInt(match[1]!, 10)
  const m = Number.parseInt(match[2]!, 10)
  const d = Number.parseInt(match[3]!, 10)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

function toIsoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function formatJa(iso: string): string {
  const parsed = parseIsoDate(iso)
  if (!parsed) return ''
  const dt = new Date(parsed.y, parsed.m - 1, parsed.d)
  return dt.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function monthLabelJa(year: number, month: number): string {
  return `${year}年${month}月`
}

export function CustomerDatePicker({
  value,
  onChange,
  plain = false,
}: {
  value: string
  onChange: (iso: string) => void
  plain?: boolean
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const today = useMemo(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
  }, [])

  const initialView = parseIsoDate(value) ?? today
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(initialView.y)
  const [viewMonth, setViewMonth] = useState(initialView.m)

  useEffect(() => {
    if (!open) return
    const parsed = parseIsoDate(value)
    if (parsed) {
      setViewYear(parsed.y)
      setViewMonth(parsed.m)
    }
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const cells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()
    const grid: ({ day: number; iso: string } | null)[] = []
    for (let i = 0; i < firstWeekday; i++) grid.push(null)
    for (let day = 1; day <= daysInMonth; day++) {
      grid.push({ day, iso: toIsoDate(viewYear, viewMonth, day) })
    }
    return grid
  }, [viewMonth, viewYear])

  function shiftMonth(delta: number) {
    let y = viewYear
    let m = viewMonth + delta
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setViewYear(y)
    setViewMonth(m)
  }

  const displayText = value
    ? plain
      ? value
      : formatJa(value)
    : plain
      ? '—'
      : '日付を選択'

  return (
    <div ref={rootRef} className={plain ? 'relative' : 'relative mt-1'}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((v) => !v)}
        className={
          plain
            ? 'inline-flex border-0 bg-transparent p-0 text-sm font-normal text-muted outline-none hover:text-foreground print:border-transparent print:bg-transparent'
            : 'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left text-sm font-medium text-foreground outline-none hover:border-primary/40 focus:border-primary print:border-transparent print:bg-transparent print:px-0'
        }
      >
        <span className={value || plain ? 'text-inherit' : 'text-muted/70'}>
          {displayText}
        </span>
        {!plain && (
        <svg
          className="h-4 w-4 shrink-0 text-muted/80 print:hidden"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <rect x="3" y="4" width="14" height="13" rx="1.5" />
          <path d="M3 8h14M7 2v3M13 2v3" strokeLinecap="round" />
        </svg>
        )}
      </button>

      {open && (
        <div
          id={listboxId}
          role="dialog"
          aria-label="日付を選択"
          className={`absolute top-[calc(100%+6px)] z-50 w-[min(100%,280px)] rounded-lg border border-border bg-white p-3 shadow-lg shadow-slate-900/10 print:hidden ${plain ? 'right-0' : 'left-0'}`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="前の月"
              onClick={() => shiftMonth(-1)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-muted/40"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-foreground">
              {monthLabelJa(viewYear, viewMonth)}
            </span>
            <button
              type="button"
              aria-label="次の月"
              onClick={() => shiftMonth(1)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-muted/40"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">
            {WEEKDAYS_JA.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, idx) =>
              cell ? (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => {
                    onChange(cell.iso)
                    setOpen(false)
                  }}
                  className={[
                    'rounded-md py-1.5 text-xs font-medium tabular-nums transition-colors',
                    value === cell.iso
                      ? 'bg-primary text-white'
                      : cell.iso === toIsoDate(today.y, today.m, today.d)
                        ? 'border border-primary/30 text-primary hover:bg-primary/10'
                        : 'text-foreground hover:bg-muted/50',
                  ].join(' ')}
                >
                  {cell.day}
                </button>
              ) : (
                <span key={`empty-${idx}`} />
              ),
            )}
          </div>

          <div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => {
                onChange(toIsoDate(today.y, today.m, today.d))
                setViewYear(today.y)
                setViewMonth(today.m)
                setOpen(false)
              }}
              className="rounded-md px-2 py-1 text-xs text-muted hover:bg-muted/40"
            >
              今日
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="rounded-md px-2 py-1 text-xs text-muted hover:bg-muted/40"
              >
                クリア
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
