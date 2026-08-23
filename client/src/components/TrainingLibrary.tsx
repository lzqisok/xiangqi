import { useEffect, useMemo, useState } from 'react'
import { TrainingTask, TrainingTaskStatus } from '../types'
import { TRAINING_STATUS_LABELS } from '../training/tasks'
import ProductDialog from './ProductDialog'

interface TrainingLibraryProps {
  tasks: TrainingTask[]
  onBack: () => void
  onStart: (task: TrainingTask) => void
  onOpenSource: (task: TrainingTask) => void
  onDeleteMany: (ids: string[]) => void
  onExportJson: () => void
  onImportJson: (file: File) => void
}

type TrainingFilter = 'all' | TrainingTaskStatus

const STATUS_ORDER: Record<TrainingTaskStatus, number> = { unseen: 0, review: 1, mastered: 2 }

export default function TrainingLibrary({
  tasks,
  onBack,
  onStart,
  onOpenSource,
  onDeleteMany,
  onExportJson,
  onImportJson,
}: TrainingLibraryProps) {
  const [filter, setFilter] = useState<TrainingFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)

  const visibleTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return tasks
      .filter((task) => {
        const matchesFilter = filter === 'all' || task.status === filter
        const matchesQuery =
          !keyword ||
          task.playedNotation.toLowerCase().includes(keyword) ||
          task.source.name.toLowerCase().includes(keyword) ||
          task.positionFen.toLowerCase().includes(keyword)
        return matchesFilter && matchesQuery
      })
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          (a.lastPracticedAt || a.updatedAt) - (b.lastPracticedAt || b.updatedAt),
      )
  }, [filter, query, tasks])

  useEffect(() => {
    const validIds = new Set(tasks.map((task) => task.id))
    setSelectedIds((current) => current.filter((id) => validIds.has(id)))
  }, [tasks])

  const visibleIds = visibleTasks.map((task) => task.id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))

  const toggleVisible = () => {
    setSelectedIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds])),
    )
  }

  return (
    <div className="start-screen">
      <section className="start-card study-library-card training-library-card">
        <header className="study-library-header">
          <button className="study-library-back" onClick={onBack}>
            <span aria-hidden="true">←</span>返回训练中心
          </button>
          <div className="study-library-heading">
            <div>
              <small>REVIEW TRAINING</small>
              <h1>错着训练</h1>
              <p>从复盘中反复练习关键局面，先独立思考，再按需查看分层提示。</p>
            </div>
            <span className="study-library-count">{tasks.length} 道训练题</span>
          </div>
          <div className="study-library-actions">
            <button onClick={onExportJson} disabled={tasks.length === 0}>
              导出 JSON
            </button>
            <label className="endgame-import-btn">
              导入 JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onImportJson(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          </div>
        </header>

        {tasks.length > 0 && (
          <div className="study-library-toolbar">
            <div className="study-library-search-row">
              <label className="study-library-search">
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索来源、实战着或 FEN..."
                />
              </label>
              <div className="study-library-filters" aria-label="训练状态筛选">
                {(['all', 'unseen', 'review', 'mastered'] as const).map((value) => (
                  <button
                    key={value}
                    className={filter === value ? 'active' : ''}
                    onClick={() => setFilter(value)}
                  >
                    {value === 'all' ? '全部' : TRAINING_STATUS_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>
            <div className="study-bulk-toolbar">
              <label>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} />
                选择当前列表
              </label>
              <span>已选 {selectedIds.length}</span>
              <button
                className="endgame-delete-btn"
                disabled={selectedIds.length === 0}
                onClick={() => setDeleteIds(selectedIds)}
              >
                批量删除
              </button>
            </div>
          </div>
        )}

        <div className="study-list training-task-list">
          {visibleTasks.map((task) => (
            <article className={`study-card training-task-card ${task.status}`} key={task.id}>
              <label className="study-select">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(task.id)}
                  onChange={() =>
                    setSelectedIds((current) =>
                      current.includes(task.id)
                        ? current.filter((id) => id !== task.id)
                        : [...current, task.id],
                    )
                  }
                  aria-label={`选择 ${task.source.name} 的训练题`}
                />
              </label>
              <div>
                <div className="training-task-title">
                  <strong>{task.playedNotation}</strong>
                  <span>{TRAINING_STATUS_LABELS[task.status]}</span>
                  <b>{task.category === 'blunder' ? '严重失误' : '错着'}</b>
                </div>
                <p>来源：{task.source.name}</p>
                <code>{task.positionFen}</code>
                <span>
                  已练 {task.attempts} 次
                  {task.lastResult
                    ? ` · 上次${task.lastResult === 'passed' ? '通过' : '未通过'}`
                    : ''}
                  {task.lastPracticedAt
                    ? ` · 最近 ${new Date(task.lastPracticedAt).toLocaleString()}`
                    : ' · 尚未练习'}
                </span>
              </div>
              <div className="study-card-actions">
                <button onClick={() => onStart(task)}>
                  {task.attempts > 0 ? '再练一次' : '开始训练'}
                </button>
                <button
                  disabled={task.source.type === 'snapshot' || !task.source.id}
                  onClick={() => onOpenSource(task)}
                >
                  查看来源
                </button>
                <button className="endgame-delete-btn" onClick={() => setDeleteIds([task.id])}>
                  删除
                </button>
              </div>
            </article>
          ))}
          {tasks.length === 0 ? (
            <div className="study-empty-state">
              <span aria-hidden="true">练</span>
              <h2>还没有训练题</h2>
              <p>完成一盘棋或打开研究棋谱，在复盘的错着与严重失误卡片中加入训练。</p>
              <button onClick={onBack}>返回训练中心</button>
            </div>
          ) : (
            visibleTasks.length === 0 && (
              <div className="study-empty-state compact">
                <span aria-hidden="true">筛</span>
                <h2>没有符合条件的训练题</h2>
                <button
                  onClick={() => {
                    setFilter('all')
                    setQuery('')
                  }}
                >
                  清空筛选
                </button>
              </div>
            )
          )}
        </div>
      </section>

      {deleteIds && (
        <ProductDialog
          title="删除训练题"
          description={`确定删除选中的 ${deleteIds.length} 道训练题吗？练习记录也会一并删除。`}
          confirmLabel="确认删除"
          dangerous
          onCancel={() => setDeleteIds(null)}
          onConfirm={() => {
            onDeleteMany(deleteIds)
            setSelectedIds([])
            setDeleteIds(null)
          }}
        />
      )}
    </div>
  )
}
