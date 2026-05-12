import { useMemo, useState } from 'react'
import EndgameBoardEditor from './EndgameBoardEditor'
import { validateFenPosition } from '../engine/validation'
import { parseTags } from '../endgames/storage'
import { EndgameTarget } from '../types'

interface Props {
  initialName?: string
  initialDescription?: string
  initialFen?: string
  initialTags?: string[]
  initialTarget?: EndgameTarget
  initialMaxMoves?: number
  initialSolution?: string[]
  onSave: (payload: { name: string; description: string; fen: string; tags: string[]; target?: EndgameTarget; maxMoves?: number; solution: string[] }) => void
  onCancel: () => void
}

function validateFen(fen: string): string | null {
  const result = validateFenPosition(fen)
  return result.ok ? null : result.errors[0] || 'FEN 格式无效'
}

export default function EndgameEditor({
  initialName = '',
  initialDescription = '',
  initialFen = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
  initialTags = [],
  initialTarget,
  initialMaxMoves,
  initialSolution = [],
  onSave,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [tags, setTags] = useState(initialTags.join('，'))
  const [target, setTarget] = useState<EndgameTarget | ''>(initialTarget || '')
  const [maxMoves, setMaxMoves] = useState(initialMaxMoves ? String(initialMaxMoves) : '')
  const [solution, setSolution] = useState(initialSolution.join(' '))
  const [fen, setFen] = useState(initialFen)

  const error = useMemo(() => {
    if (!name.trim()) return '请输入残局名称'
    if (!fen.trim()) return '请输入残局 FEN'
    return validateFen(fen)
  }, [name, fen])

  return (
    <div className="start-screen">
      <div className="start-card endgame-editor-card">
        <h1>残局制作</h1>
        <p className="subtitle">创建并保存你自己的残局</p>

        <div className="option-group">
          <label>残局名称</label>
          <input
            className="endgame-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：单车巧胜"
          />
        </div>

        <div className="option-group">
          <label>残局描述</label>
          <textarea
            className="endgame-textarea"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="可选，简单说明残局目的或思路"
            rows={3}
          />
        </div>

        <div className="option-group">
          <label>残局标签</label>
          <input
            className="endgame-input"
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="例如：车炮兵、三步杀、守和"
          />
        </div>

        <div className="option-group">
          <label>训练目标</label>
          <div className="btn-group">
            {[
              ['', '无'],
              ['red-win', '红胜'],
              ['black-win', '黑胜'],
              ['draw', '守和'],
              ['survive', '坚持'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={target === value ? 'active' : ''}
                onClick={() => setTarget(value as EndgameTarget | '')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="option-group">
          <label>目标步数</label>
          <input
            className="endgame-input"
            value={maxMoves}
            onChange={e => setMaxMoves(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="可选，例如 6"
          />
        </div>

        <div className="option-group">
          <label>标准解法</label>
          <textarea
            className="endgame-textarea fen-field"
            value={solution}
            onChange={e => setSolution(e.target.value)}
            placeholder="可选，输入 UCI 走法，如 h2e2 h9g7"
            rows={2}
          />
        </div>

        <div className="option-group">
          <label>可视化摆子</label>
          <EndgameBoardEditor fen={fen} onChange={setFen} />
        </div>

        <div className="option-group">
          <label>残局 FEN</label>
          <textarea
            className="endgame-textarea fen-field"
            value={fen}
            onChange={e => setFen(e.target.value)}
            placeholder="输入完整 FEN，例如：4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1"
            rows={4}
          />
        </div>

        {error && <div className="endgame-error">{error}</div>}

        <div className="endgame-editor-actions">
          <button className="cancel" onClick={onCancel}>取消</button>
          <button
            className="start-btn"
            disabled={Boolean(error)}
            onClick={() => onSave({
              name: name.trim(),
              description: description.trim(),
              fen: fen.trim(),
              tags: parseTags(tags),
              target: target || undefined,
              maxMoves: maxMoves ? Number(maxMoves) : undefined,
              solution: solution.split(/[\s,，、]+/).map(item => item.trim()).filter(Boolean),
            })}
          >
            保存残局
          </button>
        </div>
      </div>
    </div>
  )
}
