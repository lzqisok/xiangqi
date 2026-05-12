import { StudyPosition } from '../types'

interface Props {
  studies: StudyPosition[]
  onBack: () => void
  onStart: (study: StudyPosition) => void
  onDelete: (id: string) => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

export default function StudyLibrary({ studies, onBack, onStart, onDelete }: Props) {
  return (
    <div className="start-screen">
      <div className="start-card endgame-library-card">
        <h1>研究局面</h1>
        <p className="subtitle">保存完整走法、标记、备注和分析曲线</p>

        <div className="endgame-library-actions">
          <button onClick={onBack}>返回</button>
        </div>

        <div className="study-list">
          {studies.map(study => (
            <div key={study.id} className="study-card">
              <div>
                <strong>{study.name}</strong>
                {study.description && <p>{study.description}</p>}
                <code>{study.initialFen}</code>
                <span>{study.moves.length} 手 · 当前第 {study.currentMoveIndex + 1} 手 · {formatTime(study.updatedAt)}</span>
              </div>
              <div className="study-card-actions">
                <button onClick={() => onStart(study)}>打开</button>
                <button className="endgame-delete-btn" onClick={() => onDelete(study.id)}>删除</button>
              </div>
            </div>
          ))}
          {studies.length === 0 && (
            <div className="endgame-empty">暂无研究局面。进入对局后可从侧栏保存当前研究。</div>
          )}
        </div>
      </div>
    </div>
  )
}
