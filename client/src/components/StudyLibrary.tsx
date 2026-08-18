import { useEffect, useMemo, useState } from 'react'
import { StudyPosition } from '../types'
import { countVariationBranches } from '../variations/tree'
import ProductDialog, { ProductDialogRequest } from './ProductDialog'

interface Props {
  studies: StudyPosition[]
  onBack: () => void
  onStart: (study: StudyPosition) => void
  onDelete: (id: string) => void
  onDeleteMany: (ids: string[]) => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onExportJson: () => void
  onImportJson: (file: File) => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function countMarked(study: StudyPosition): number {
  return study.moves.filter((move) => Boolean(move?.marked)).length
}

function countNotes(study: StudyPosition): number {
  return study.moves.filter((move) => typeof move?.note === 'string' && move.note).length
}

function includesKeyword(value: unknown, keyword: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(keyword)
}

export default function StudyLibrary({
  studies,
  onBack,
  onStart,
  onDelete,
  onDeleteMany,
  onRename,
  onDuplicate,
  onExportJson,
  onImportJson,
}: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'marked' | 'notes' | 'recent'>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [dialog, setDialog] = useState<
    | (ProductDialogRequest & {
        action: 'rename' | 'delete'
        targetIds?: string[]
      })
    | null
  >(null)

  const visibleStudies = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return studies
      .filter((study) => {
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
          study.moves.some(
            (move) =>
              includesKeyword(move?.notation, keyword) || includesKeyword(move?.note, keyword),
          )
        return matchesFilter && matchesQuery
      })
      .sort((a, b) => (filter === 'recent' ? b.updatedAt - a.updatedAt : 0))
  }, [filter, query, studies])

  const visibleIds = visibleStudies.map((study) => study.id)
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length
  const singleSelectedStudy =
    selectedIds.length === 1 ? studies.find((study) => study.id === selectedIds[0]) : null

  useEffect(() => {
    const validIds = new Set(studies.map((study) => study.id))
    setSelectedIds((prev) => prev.filter((id) => validIds.has(id)))
  }, [studies])

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  function toggleVisibleSelected() {
    if (visibleIds.length === 0) return
    if (visibleSelectedCount === visibleIds.length) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
      return
    }
    setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])))
  }

  function deleteSelected() {
    if (selectedIds.length === 0) return
    setDialog({
      action: 'delete',
      title: '删除研究',
      description: `确定删除选中的 ${selectedIds.length} 项研究吗？删除后无法恢复。`,
      confirmLabel: '确认删除',
      dangerous: true,
      targetIds: selectedIds,
    })
  }

  function renameSelected() {
    if (!singleSelectedStudy) return
    setDialog({
      action: 'rename',
      title: '重命名研究',
      confirmLabel: '保存',
      fields: [
        {
          name: 'name',
          label: '研究名称',
          initialValue: singleSelectedStudy.name,
          required: true,
          maxLength: 80,
        },
      ],
    })
  }

  function duplicateSelected() {
    if (!singleSelectedStudy) return
    onDuplicate(singleSelectedStudy.id)
    setSelectedIds([])
  }

  return (
    <div className="start-screen">
      <section className="start-card study-library-card">
        <header className="study-library-header">
          <button className="study-library-back" onClick={onBack}>
            <span aria-hidden="true">←</span>返回训练中心
          </button>
          <div className="study-library-heading">
            <div>
              <small>STUDY LIBRARY</small>
              <h1>研究局面</h1>
              <p>保存完整走法、节点标注、备注与分析曲线，随时继续推演。</p>
            </div>
            <span className="study-library-count">{studies.length} 份研究</span>
          </div>
          <div className="study-library-actions">
            <button onClick={onExportJson} disabled={studies.length === 0}>
              导出 JSON
            </button>
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
        </header>

        {studies.length > 0 && (
          <div className="study-library-toolbar">
            <div className="study-library-search-row">
              <label className="study-library-search">
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索名称、说明、备注、走法或 FEN..."
                />
              </label>
              <div className="study-library-filters" aria-label="研究筛选">
                <button
                  className={filter === 'all' ? 'active' : ''}
                  onClick={() => setFilter('all')}
                >
                  全部
                </button>
                <button
                  className={filter === 'marked' ? 'active' : ''}
                  onClick={() => setFilter('marked')}
                >
                  有标记
                </button>
                <button
                  className={filter === 'notes' ? 'active' : ''}
                  onClick={() => setFilter('notes')}
                >
                  有备注
                </button>
                <button
                  className={filter === 'recent' ? 'active' : ''}
                  onClick={() => setFilter('recent')}
                >
                  最近
                </button>
              </div>
            </div>
            <div className="study-bulk-toolbar">
              <label>
                <input
                  type="checkbox"
                  checked={visibleIds.length > 0 && visibleSelectedCount === visibleIds.length}
                  onChange={toggleVisibleSelected}
                />
                选择当前列表
              </label>
              <span>已选 {selectedIds.length}</span>
              <button onClick={renameSelected} disabled={selectedIds.length !== 1}>
                重命名
              </button>
              <button onClick={duplicateSelected} disabled={selectedIds.length !== 1}>
                复制
              </button>
              <button
                className="endgame-delete-btn"
                onClick={deleteSelected}
                disabled={selectedIds.length === 0}
              >
                批量删除
              </button>
            </div>
          </div>
        )}

        <div className="study-list">
          {visibleStudies.map((study) => (
            <div key={study.id} className="study-card">
              <label className="study-select">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(study.id)}
                  onChange={() => toggleSelected(study.id)}
                  aria-label={`选择 ${study.name}`}
                />
              </label>
              <div>
                <strong>{study.name}</strong>
                {study.description && <p>{study.description}</p>}
                <code>{study.initialFen}</code>
                <span>
                  {study.moves.length} 手 · 当前第 {study.currentMoveIndex + 1} 手 · 标记{' '}
                  {countMarked(study)} · 备注 {countNotes(study)} · 支线{' '}
                  {study.variationTree ? countVariationBranches(study.variationTree) : 0} ·{' '}
                  {formatTime(study.updatedAt)}
                </span>
              </div>
              <div className="study-card-actions">
                <button onClick={() => onStart(study)}>打开</button>
                <button onClick={() => onDuplicate(study.id)}>复制</button>
                <button
                  className="endgame-delete-btn"
                  onClick={() =>
                    setDialog({
                      action: 'delete',
                      targetIds: [study.id],
                      title: '删除研究',
                      description: `确定删除“${study.name}”吗？删除后无法恢复。`,
                      confirmLabel: '确认删除',
                      dangerous: true,
                    })
                  }
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          {studies.length === 0 ? (
            <div className="study-empty-state">
              <span aria-hidden="true">研</span>
              <h2>还没有研究局面</h2>
              <p>开始一盘对局或打开棋谱后，可以从侧栏保存当前局面、完整走法和标注。</p>
              <button onClick={onBack}>返回训练中心</button>
            </div>
          ) : (
            visibleStudies.length === 0 && (
              <div className="study-empty-state compact">
                <span aria-hidden="true">筛</span>
                <h2>没有符合条件的研究</h2>
                <p>尝试切换筛选条件，或清空当前搜索词。</p>
                <button
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                >
                  清空筛选
                </button>
              </div>
            )
          )}
        </div>
      </section>
      {dialog && (
        <ProductDialog
          {...dialog}
          onCancel={() => setDialog(null)}
          onConfirm={(values) => {
            if (dialog.action === 'rename' && singleSelectedStudy)
              onRename(singleSelectedStudy.id, values.name.trim())
            if (dialog.action === 'delete') {
              const ids = dialog.targetIds || selectedIds
              if (ids.length === 1) onDelete(ids[0])
              else onDeleteMany(ids)
              setSelectedIds([])
            }
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}
