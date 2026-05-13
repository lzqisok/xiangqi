import { useMemo, useState } from 'react'
import { StudyPosition } from '../types'

interface Props {
  studies: StudyPosition[]
  onBack: () => void
  onStart: (study: StudyPosition) => void
  onDelete: (id: string) => void
  onExportJson: () => void
  onImportJson: (file: File) => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function countMarked(study: StudyPosition): number {
  return study.moves.filter(move => Boolean(move?.marked)).length
}

function countNotes(study: StudyPosition): number {
  return study.moves.filter(move => typeof move?.note === 'string' && move.note).length
}

function includesKeyword(value: unknown, keyword: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(keyword)
}

export default function StudyLibrary({ studies, onBack, onStart, onDelete, onExportJson, onImportJson }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'marked' | 'notes' | 'recent'>('all')

  const visibleStudies = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return studies
      .filter(study => {
        const matchesFilter =
          filter === 'all' ||
          (filter === 'marked' && countMarked(study) > 0) ||
          (filter === 'notes' && countNotes(study) > 0) ||
          filter === 'recent'
        const matchesQuery =
          !keyword ||
          includesKeyword(study.name, keyword) ||
          includesKeyword(study.description, keyword) ||
          includesKeyword(study.initialFen, keyword) ||
          study.moves.some(move => (
            includesKeyword(move?.notation, keyword) ||
            includesKeyword(move?.note, keyword)
          ))
        return matchesFilter && matchesQuery
      })
      .sort((a, b) => filter === 'recent' ? b.updatedAt - a.updatedAt : 0)
  }, [filter, query, studies])

  return (
    <div className="start-screen">
      <div className="start-card endgame-library-card">
        <h1>研究局面</h1>
        <p className="subtitle">保存完整走法、标记、备注和分析曲线</p>

        <div className="endgame-library-actions">
          <button onClick={onBack}>返回</button>
          <div className="endgame-library-action-group">
            <button onClick={onExportJson} disabled={studies.length === 0}>导出 JSON</button>
            <label className="endgame-import-btn">
              导入 JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onImportJson(file)
                  e.currentTarget.value = ''
                }}
              />
            </label>
          </div>
        </div>

        <div className="endgame-library-toolbar">
          <input
            className="endgame-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索名称、说明、备注、走法或 FEN..."
          />
          <div className="btn-group endgame-filter-group">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button>
            <button className={filter === 'marked' ? 'active' : ''} onClick={() => setFilter('marked')}>有标记</button>
            <button className={filter === 'notes' ? 'active' : ''} onClick={() => setFilter('notes')}>有备注</button>
            <button className={filter === 'recent' ? 'active' : ''} onClick={() => setFilter('recent')}>最近</button>
          </div>
        </div>

        <div className="study-list">
          {visibleStudies.map(study => (
            <div key={study.id} className="study-card">
              <div>
                <strong>{study.name}</strong>
                {study.description && <p>{study.description}</p>}
                <code>{study.initialFen}</code>
                <span>
                  {study.moves.length} 手 · 当前第 {study.currentMoveIndex + 1} 手 ·
                  标记 {countMarked(study)} · 备注 {countNotes(study)} · {formatTime(study.updatedAt)}
                </span>
              </div>
              <div className="study-card-actions">
                <button onClick={() => onStart(study)}>打开</button>
                <button className="endgame-delete-btn" onClick={() => onDelete(study.id)}>删除</button>
              </div>
            </div>
          ))}
          {studies.length === 0 ? (
            <div className="endgame-empty">暂无研究局面。进入对局后可从侧栏保存当前研究。</div>
          ) : visibleStudies.length === 0 && (
            <div className="endgame-empty">没有符合条件的研究局面，请调整筛选或搜索词。</div>
          )}
        </div>
      </div>
    </div>
  )
}
