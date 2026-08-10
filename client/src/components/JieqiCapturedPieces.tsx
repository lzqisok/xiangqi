import { useMemo } from 'react'
import { getJieqiCapturedPieces } from '../engine/jieqi'
import { MoveRecord, PieceColor, PieceType } from '../types'

interface Props {
  records: MoveRecord[]
  viewer: PieceColor
}

const PIECE_CHARS: Record<PieceColor, Record<PieceType, string>> = {
  red: { k: '帅', a: '仕', b: '相', n: '馬', r: '車', c: '炮', p: '兵' },
  black: { k: '将', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' },
}

export default function JieqiCapturedPieces({ records, viewer }: Props) {
  const capturedBy = useMemo(() => getJieqiCapturedPieces(records, viewer), [records, viewer])

  return (
    <div className="jieqi-captured" aria-label="双方已吃棋子">
      {(['red', 'black'] as const).map(capturer => (
        <div className={`jieqi-captured-side ${capturer}`} key={capturer}>
          <span className="jieqi-captured-label">{capturer === 'red' ? '红方已吃' : '黑方已吃'}</span>
          <div className="jieqi-captured-list">
            {capturedBy[capturer].length === 0 && <span className="jieqi-captured-empty">暂无</span>}
            {capturedBy[capturer].map((piece, index) => {
              const identityHidden = piece.type === null
              const pieceChar = piece.type ? PIECE_CHARS[piece.color][piece.type] : '暗'
              return (
                <span
                  className={`jieqi-captured-piece ${piece.color} ${identityHidden ? 'identity-hidden' : ''}`}
                  key={`${capturer}-${index}`}
                  title={identityHidden ? '暗子身份仅捕获方可见' : piece.wasHidden ? '捕获的暗子' : '捕获的明子'}
                >
                  {pieceChar}
                </span>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
