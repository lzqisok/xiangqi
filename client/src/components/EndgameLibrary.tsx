import { useMemo, useState } from 'react'
import { Difficulty, EndgameDefinition, EndgameStartConfig, PlayerConfig } from '../types'

interface Props {
  builtinEndgames: EndgameDefinition[]
  customEndgames: EndgameDefinition[]
  favoriteIds: string[]
  onStart: (endgame: EndgameDefinition, config: EndgameStartConfig) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onEdit: (endgame: EndgameDefinition) => void
  onDuplicate: (endgame: EndgameDefinition) => void
  onToggleFavorite: (id: string) => void
  onImportJson: (file: File) => void
  onExportJson: () => void
  onBack: () => void
}

const DEFAULT_PLAYER_CONFIG: PlayerConfig = { type: 'human' }

const TARGET_LABELS: Record<string, string> = {
  'red-win': '红胜',
  'black-win': '黑胜',
  draw: '守和',
  survive: '坚持',
}

export default function EndgameLibrary({
  builtinEndgames,
  customEndgames,
  favoriteIds,
  onStart,
  onCreate,
  onDelete,
  onEdit,
  onDuplicate,
  onToggleFavorite,
  onImportJson,
  onExportJson,
  onBack,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    builtinEndgames[0]?.id ?? customEndgames[0]?.id ?? null,
  )
  const [redConfig, setRedConfig] = useState<PlayerConfig>(DEFAULT_PLAYER_CONFIG)
  const [blackConfig, setBlackConfig] = useState<PlayerConfig>({
    type: 'ai',
    difficulty: 'medium',
  })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'builtin' | 'custom' | 'favorite'>('all')

  const allEndgames = useMemo(
    () => [...builtinEndgames, ...customEndgames],
    [builtinEndgames, customEndgames],
  )

  const visibleEndgames = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return allEndgames.filter((item) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'builtin' && item.source === 'builtin') ||
        (filter === 'custom' && item.source === 'custom') ||
        (filter === 'favorite' && favoriteIds.includes(item.id))
      const matchesQuery =
        !keyword ||
        item.name.toLowerCase().includes(keyword) ||
        item.fen.toLowerCase().includes(keyword) ||
        item.description?.toLowerCase().includes(keyword) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(keyword))
      return matchesFilter && matchesQuery
    })
  }, [allEndgames, query, filter, favoriteIds])

  const selectedEndgame =
    visibleEndgames.find((item) => item.id === selectedId) ??
    allEndgames.find((item) => item.id === selectedId) ??
    null

  const updatePlayer = (
    setter: (config: PlayerConfig) => void,
    nextType: PlayerConfig['type'],
    nextDifficulty?: Difficulty,
  ) => {
    setter(
      nextType === 'human'
        ? { type: 'human' }
        : { type: 'ai', difficulty: nextDifficulty || 'medium' },
    )
  }

  return (
    <div className="start-screen">
      <div className="start-card endgame-library-card">
        <h1>残局库</h1>
        <p className="subtitle">选择内置残局或创建自己的残局</p>

        <div className="endgame-library-actions">
          <button onClick={onBack}>返回</button>
          <div className="endgame-library-action-group">
            <button onClick={onCreate}>新建残局</button>
            <button onClick={onExportJson} disabled={customEndgames.length === 0}>
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
        </div>

        <div className="endgame-library-toolbar">
          <input
            className="endgame-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索残局名称、描述或 FEN..."
          />
          <div className="btn-group endgame-filter-group">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              全部
            </button>
            <button
              className={filter === 'builtin' ? 'active' : ''}
              onClick={() => setFilter('builtin')}
            >
              内置
            </button>
            <button
              className={filter === 'custom' ? 'active' : ''}
              onClick={() => setFilter('custom')}
            >
              自定义
            </button>
            <button
              className={filter === 'favorite' ? 'active' : ''}
              onClick={() => setFilter('favorite')}
            >
              收藏
            </button>
          </div>
        </div>

        <div className="endgame-library-list">
          {visibleEndgames.map((item) => (
            <div
              key={item.id}
              className={`endgame-card ${item.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="endgame-card-header">
                <strong>{item.name}</strong>
                <div className="endgame-card-badges">
                  <button
                    className={`endgame-favorite-btn ${favoriteIds.includes(item.id) ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleFavorite(item.id)
                    }}
                    title={favoriteIds.includes(item.id) ? '取消收藏' : '收藏残局'}
                  >
                    {favoriteIds.includes(item.id) ? '★' : '☆'}
                  </button>
                  <span className={`endgame-source ${item.source}`}>
                    {item.source === 'builtin' ? '内置' : '自定义'}
                  </span>
                </div>
              </div>
              {item.description && <p>{item.description}</p>}
              {item.tags && item.tags.length > 0 && (
                <div className="endgame-tags">
                  {item.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
              {(item.target || item.solution?.length) && (
                <div className="endgame-tags">
                  {item.target && <span>{TARGET_LABELS[item.target]}</span>}
                  {item.maxMoves && <span>{item.maxMoves} 手目标</span>}
                  {item.solution?.length ? <span>解法 {item.solution.length} 手</span> : null}
                </div>
              )}
              <div className="endgame-fen-preview">{item.fen}</div>
              {item.source === 'custom' && (
                <div className="endgame-card-actions">
                  <button
                    className="endgame-copy-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDuplicate(item)
                    }}
                  >
                    复制
                  </button>
                  <button
                    className="endgame-edit-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(item)
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="endgame-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(item.id)
                      if (selectedId === item.id) {
                        setSelectedId(allEndgames.find((other) => other.id !== item.id)?.id ?? null)
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          ))}
          {visibleEndgames.length === 0 && (
            <div className="endgame-empty">没有符合条件的残局，请调整筛选或新建一个残局。</div>
          )}
        </div>

        {selectedEndgame && (
          <div className="endgame-start-config">
            <h3>开始配置</h3>

            <PlayerConfigSection
              label="红方"
              value={redConfig}
              onChange={setRedConfig}
              updatePlayer={updatePlayer}
            />

            <PlayerConfigSection
              label="黑方"
              value={blackConfig}
              onChange={setBlackConfig}
              updatePlayer={updatePlayer}
            />

            <button
              className="start-btn"
              onClick={() => onStart(selectedEndgame, { red: redConfig, black: blackConfig })}
            >
              开始残局
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PlayerConfigSection({
  label,
  value,
  onChange,
  updatePlayer,
}: {
  label: string
  value: PlayerConfig
  onChange: (config: PlayerConfig) => void
  updatePlayer: (
    setter: (config: PlayerConfig) => void,
    nextType: PlayerConfig['type'],
    nextDifficulty?: Difficulty,
  ) => void
}) {
  return (
    <div className="option-group">
      <label>{label}</label>
      <div className="btn-group">
        <button
          className={value.type === 'human' ? 'active' : ''}
          onClick={() => updatePlayer(onChange, 'human')}
        >
          人类
        </button>
        <button
          className={value.type === 'ai' ? 'active' : ''}
          onClick={() => updatePlayer(onChange, 'ai', value.difficulty)}
        >
          AI
        </button>
      </div>

      {value.type === 'ai' && (
        <div className="btn-group endgame-difficulty-group">
          {(['easy', 'medium', 'hard', 'master'] as const).map((diff) => (
            <button
              key={diff}
              className={value.difficulty === diff ? 'active' : ''}
              onClick={() => updatePlayer(onChange, 'ai', diff)}
            >
              {diff === 'easy'
                ? '初级 · D8'
                : diff === 'medium'
                  ? '中级 · D14'
                  : diff === 'hard'
                    ? '高级 · D20'
                    : '大师 · D26'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
