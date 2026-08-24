import { useMemo, useState } from 'react'
import type { JieqiPublicMoveEvent, JieqiSeatProjection } from '../jieqi-record/types'
import ProductDialog from './ProductDialog'

export interface JieqiRecordLibraryProps {
  records: JieqiSeatProjection[]
  onBack: () => void
  onOpen: (record: JieqiSeatProjection) => void
  onDelete: (recordId: string) => void
  onExportPublic: (record: JieqiSeatProjection) => void
  onBackupPrivate: (record: JieqiSeatProjection) => void
  onImportPrivate: (file: File) => void
}

type PendingAction =
  | { kind: 'delete'; record: JieqiSeatProjection }
  | { kind: 'private-backup'; record: JieqiSeatProjection }

function copyPublicEvent(event: JieqiPublicMoveEvent): JieqiPublicMoveEvent {
  const capture = event.capture
    ? event.capture.state === 'covered'
      ? { state: 'covered' as const, color: event.capture.color }
      : { state: 'revealed' as const, color: event.capture.color, type: event.capture.type }
    : undefined

  return {
    kind: 'move',
    ply: event.ply,
    color: event.color,
    from: { row: event.from.row, col: event.from.col },
    to: { row: event.to.row, col: event.to.col },
    revealed: event.revealed,
    capture,
    elapsedMs: event.elapsedMs,
  }
}

/** Whitelists the seat fields so imported objects cannot smuggle referee data into the UI. */
function copySeatProjection(record: JieqiSeatProjection): JieqiSeatProjection | null {
  if (record.audience !== 'red' && record.audience !== 'black') return null
  return {
    kind: 'jieqi-record-projection',
    schemaVersion: 1,
    recordId: record.recordId,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startingTurn: record.startingTurn,
    audience: record.audience,
    initialBoard: record.initialBoard.map((row) =>
      row.map((piece) => {
        if (!piece) return null
        return piece.state === 'covered'
          ? {
              state: 'covered' as const,
              color: piece.color,
              movementType: piece.movementType,
            }
          : { state: 'revealed' as const, color: piece.color, type: piece.type }
      }),
    ),
    events: record.events.map(copyPublicEvent),
    privateEvents: record.privateEvents.map((event) => ({
      kind: 'hidden-capture',
      ply: event.ply,
      capturedBy: event.capturedBy,
      capturedColor: event.capturedColor,
      capturedType: event.capturedType,
    })),
  }
}

function audienceLabel(record: JieqiSeatProjection): string {
  return `本人视角 · ${record.audience === 'red' ? '红方' : '黑方'}`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export default function JieqiRecordLibrary({
  records,
  onBack,
  onOpen,
  onDelete,
  onExportPublic,
  onBackupPrivate,
  onImportPrivate,
}: JieqiRecordLibraryProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const safeRecords = useMemo(
    () =>
      records
        .map(copySeatProjection)
        .filter((record): record is JieqiSeatProjection => record !== null)
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [records],
  )
  const hiddenRecordCount = records.length - safeRecords.length

  return (
    <main className="jieqi-record-library">
      <section className="jieqi-record-library-card">
        <header className="jieqi-record-library-header">
          <button className="jieqi-record-back" type="button" onClick={onBack}>
            <span aria-hidden="true">←</span>返回训练中心
          </button>
          <div className="jieqi-record-library-heading">
            <div>
              <small>JIEQI RECORDS</small>
              <h1>揭棋记录</h1>
              <p>独立保存本人座位可见的回放，不会进入普通研究、分析或错着训练。</p>
            </div>
            <span className="jieqi-record-library-count">{safeRecords.length} 盘记录</span>
          </div>
          <div className="jieqi-record-library-actions">
            <label className="jieqi-record-private-import">
              导入私有备份
              <input
                type="file"
                accept=".jqseat,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onImportPrivate(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          </div>
        </header>

        <aside className="jieqi-record-privacy-note" aria-label="揭棋记录隐私说明">
          <strong>隐私边界</strong>
          <span>公开导出会移除本人私有的暗子吃子身份；私有备份仅供本人保存，请勿公开分享。</span>
        </aside>

        {hiddenRecordCount > 0 && (
          <p className="jieqi-record-hidden-warning" role="status">
            已隐藏 {hiddenRecordCount} 条不属于红方或黑方本人视角的记录。
          </p>
        )}

        <div className="jieqi-record-list">
          {safeRecords.map((record) => (
            <article className="jieqi-record-item" key={record.recordId}>
              <div className="jieqi-record-item-main">
                <div className="jieqi-record-item-title">
                  <h2>{record.name}</h2>
                  <span className={`jieqi-record-view-badge ${record.audience}`}>
                    {audienceLabel(record)}
                  </span>
                </div>
                <p>
                  {record.events.length} 手 · 更新于{' '}
                  <time dateTime={new Date(record.updatedAt).toISOString()}>
                    {formatTime(record.updatedAt)}
                  </time>
                </p>
                <small>只读前向回放 · 不含裁判视角</small>
              </div>
              <div className="jieqi-record-item-actions">
                <button type="button" onClick={() => onOpen(record)}>
                  打开回放
                </button>
                <button type="button" onClick={() => onExportPublic(record)}>
                  公开导出
                </button>
                <button
                  className="jieqi-record-private-action"
                  type="button"
                  onClick={() => setPendingAction({ kind: 'private-backup', record })}
                >
                  私有备份
                </button>
                <button
                  className="jieqi-record-delete-action"
                  type="button"
                  onClick={() => setPendingAction({ kind: 'delete', record })}
                >
                  删除
                </button>
              </div>
            </article>
          ))}

          {safeRecords.length === 0 && (
            <div className="jieqi-record-empty-state">
              <span aria-hidden="true">揭</span>
              <h2>还没有揭棋记录</h2>
              <p>完成一盘本地揭棋后，会按你的座位视角独立保存只读回放。</p>
              <button type="button" onClick={onBack}>
                返回训练中心
              </button>
            </div>
          )}
        </div>
      </section>

      {pendingAction?.kind === 'private-backup' && (
        <ProductDialog
          title="确认导出私有揭棋备份"
          description={`“${pendingAction.record.name}”的私有备份包含仅本人获知的暗子吃子身份。文件会与公开棋谱明确区分，请勿上传或转发给其他座位、观战者。`}
          confirmLabel="确认私有备份"
          dangerous
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            onBackupPrivate(pendingAction.record)
            setPendingAction(null)
          }}
        />
      )}

      {pendingAction?.kind === 'delete' && (
        <ProductDialog
          title="删除揭棋记录"
          description={`确定删除“${pendingAction.record.name}”吗？删除后只能通过此前导出的私有备份恢复。`}
          confirmLabel="确认删除"
          dangerous
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            onDelete(pendingAction.record.recordId)
            setPendingAction(null)
          }}
        />
      )}
    </main>
  )
}
