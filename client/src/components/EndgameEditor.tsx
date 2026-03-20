import { useMemo, useState } from 'react'
import EndgameBoardEditor from './EndgameBoardEditor'
import { parseFen, findKing } from '../engine/board'

interface Props {
  initialName?: string
  initialDescription?: string
  initialFen?: string
  onSave: (payload: { name: string; description: string; fen: string }) => void
  onCancel: () => void
}

function validateFen(fen: string): string | null {
  try {
    const { board } = parseFen(fen.trim())
    if (board.length !== 10 || board.some(row => row.length !== 9)) {
      return 'FEN 棋盘尺寸不正确'
    }
    if (!findKing(board, 'red') || !findKing(board, 'black')) {
      return '残局必须同时包含红帅和黑将'
    }
    return null
  } catch {
    return 'FEN 格式无效'
  }
}

export default function EndgameEditor({
  initialName = '',
  initialDescription = '',
  initialFen = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
  onSave,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
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
            onClick={() => onSave({ name: name.trim(), description: description.trim(), fen: fen.trim() })}
          >
            保存残局
          </button>
        </div>
      </div>
    </div>
  )
}
