'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { DrawingSegment, OptimizationRun } from '@/lib/types/database'
import { optimize, type PieceInput, type OptimizationOutput, type AlgorithmType } from '@/lib/optimizer'
import { OptimizationResultView } from '@/components/optimization-result-view'

export function OptimizeClient({
  projectId,
  segments,
  pastRuns,
}: {
  projectId: string
  segments: DrawingSegment[]
  pastRuns: OptimizationRun[]
}) {
  const [stockLength, setStockLength] = useState(6000)
  const [algorithm, setAlgorithm] = useState<AlgorithmType>('first-fit')
  const [cuttingLossMm, setCuttingLossMm] = useState(0)
  const [result, setResult] = useState<OptimizationOutput | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  function handleCalculate() {
    const pieces: PieceInput[] = []
    for (const seg of segments) {
      for (let i = 0; i < seg.quantity; i++) {
        pieces.push({
          segmentId: seg.id,
          lengthMm: seg.length_mm,
          barType: seg.bar_type,
        })
      }
    }

    if (pieces.length === 0) {
      alert('計算対象の線分データがありません。先に図面上に線分を追加してください。')
      return
    }

    const output = optimize(pieces, stockLength, {
      algorithm,
      cuttingLossMm: cuttingLossMm || 0,
    })
    setResult(output)
    setSaved(false)
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)

    const { data: run, error: runError } = await supabase
      .from('optimization_runs')
      .insert({
        project_id: projectId,
        stock_length_mm: stockLength,
        status: 'completed',
        total_stock_count: result.totalStockCount,
        total_waste_mm: result.totalWasteMm,
        waste_ratio: result.wasteRatio,
      })
      .select()
      .single()

    if (runError || !run) {
      alert('保存に失敗しました: ' + runError?.message)
      setSaving(false)
      return
    }

    for (const stock of result.stocks) {
      const { data: resultRow } = await supabase
        .from('optimization_results')
        .insert({
          run_id: run.id,
          bar_type: stock.barType,
          stock_index: stock.stockIndex,
          used_length_mm: stock.usedLengthMm,
          waste_mm: stock.wasteMm,
        })
        .select()
        .single()

      if (resultRow) {
        const piecesToInsert = stock.pieces.map((p) => ({
          result_id: resultRow.id,
          source_segment_id: p.segmentId,
          piece_length_mm: p.lengthMm,
          sequence_no: p.sequenceNo,
        }))

        await supabase.from('optimization_result_pieces').insert(piecesToInsert)
      }
    }

    setSaving(false)
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* 入力サマリ */}
      <section className="rounded-lg border border-border bg-white p-5">
        <h2 className="text-base font-semibold mb-3">入力データ</h2>
        {segments.length === 0 ? (
          <p className="text-sm text-muted">線分データがありません。</p>
        ) : (
          <div className="space-y-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="pb-2 font-medium">ラベル</th>
                  <th className="pb-2 font-medium">長さ (mm)</th>
                  <th className="pb-2 font-medium">数量</th>
                  <th className="pb-2 font-medium">鉄筋種別</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {segments.map((seg) => (
                  <tr key={seg.id}>
                    <td className="py-2">{seg.label || '-'}</td>
                    <td className="py-2 font-mono">{seg.length_mm.toLocaleString()}</td>
                    <td className="py-2">{seg.quantity}</td>
                    <td className="py-2 font-mono">{seg.bar_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted">
              合計 {segments.reduce((s, seg) => s + seg.quantity, 0)} 本の部材
            </p>
          </div>
        )}
      </section>

      {/* 計算設定 */}
      <section className="rounded-lg border border-border bg-white p-5">
        <h2 className="text-base font-semibold mb-3">計算設定</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm text-muted mb-1">
              元材長さ (mm)
            </label>
            <input
              type="number"
              value={stockLength}
              onChange={(e) => setStockLength(parseInt(e.target.value) || 6000)}
              className="w-40 rounded-lg border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">
              配置アルゴリズム
            </label>
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as AlgorithmType)}
              className="w-40 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary bg-white"
            >
              <option value="first-fit">First Fit（最初に空く場所）</option>
              <option value="best-fit">Best Fit（残りが最小になる場所）</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">
              1カットあたりの切断損失 (mm)
            </label>
            <input
              type="number"
              min={0}
              value={cuttingLossMm}
              onChange={(e) => setCuttingLossMm(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-40 rounded-lg border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={handleCalculate}
            disabled={segments.length === 0}
            className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            計算を実行
          </button>
        </div>
      </section>

      {/* 結果 */}
      {result && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">計算結果</h2>
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {saved ? '保存済み' : saving ? '保存中...' : '結果を保存'}
            </button>
          </div>
          <OptimizationResultView result={result} stockLengthMm={stockLength} />
        </section>
      )}

      {/* 過去の結果 */}
      {pastRuns.length > 0 && (
        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="text-base font-semibold mb-3">過去の計算履歴</h2>
          <ul className="divide-y divide-border">
            {pastRuns.map((run) => (
              <li key={run.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-mono">{run.stock_length_mm}mm</span>
                  <span className="text-muted ml-2">
                    {new Date(run.created_at).toLocaleString('ja-JP')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span>{run.total_stock_count}本</span>
                  <span className="text-muted">
                    廃棄率 {((run.waste_ratio ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
