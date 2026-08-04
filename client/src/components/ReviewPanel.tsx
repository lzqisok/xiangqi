import { MOVE_REVIEW_LABELS, MoveReview, MoveReviewCategory } from '../analysis/moveReview'

interface ReviewPanelProps {
  moveCount: number
  reviews: MoveReview[]
  thinking: boolean
  progress: { completed: number; total: number }
  canRequest: boolean
  onRequest: () => void
  onCancel: () => void
  onJumpToPosition: (moveIndex: number) => void
}

const DISPLAY_CATEGORIES = new Set<MoveReviewCategory>(['inaccuracy', 'mistake', 'blunder'])

export default function ReviewPanel({
  moveCount,
  reviews,
  thinking,
  progress,
  canRequest,
  onRequest,
  onCancel,
  onJumpToPosition,
}: ReviewPanelProps) {
  const issues = reviews.filter(review => DISPLAY_CATEGORIES.has(review.category))
  const counts = reviews.reduce<Partial<Record<MoveReviewCategory, number>>>((result, review) => {
    result[review.category] = (result[review.category] || 0) + 1
    return result
  }, {})
  const percent = progress.total > 0 ? Math.round(progress.completed / progress.total * 100) : 0

  return (
    <section className="review-panel">
      <div className="review-header">
        <div>
          <h3>棋局复盘</h3>
          <span>固定深度 12 · 最多 120 步</span>
        </div>
        <button disabled={!thinking && !canRequest} onClick={thinking ? onCancel : onRequest}>
          {thinking ? `取消 ${percent}%` : reviews.length > 0 ? '重新复盘' : '生成复盘'}
        </button>
      </div>

      {thinking && (
        <div className="review-progress" aria-live="polite">
          <span style={{ width: `${percent}%` }} />
          <small>{progress.completed} / {progress.total} 个局面</small>
        </div>
      )}

      {!thinking && reviews.length > 0 && (
        <>
          <div className="review-summary">
            <span>最佳 {counts.best || 0}</span>
            <span>疑问 {counts.inaccuracy || 0}</span>
            <span>错着 {counts.mistake || 0}</span>
            <span>严重 {counts.blunder || 0}</span>
          </div>
          {issues.length === 0 ? (
            <div className="review-empty">本局未发现明显失误。</div>
          ) : (
            <div className="review-issues">
              {issues.map(review => (
                <button
                  key={review.moveIndex}
                  className={`review-item ${review.category}`}
                  onClick={() => onJumpToPosition(review.moveIndex - 1)}
                >
                  <span className="review-move-number">{Math.floor(review.moveIndex / 2) + 1}.{review.mover === 'red' ? '红' : '黑'}</span>
                  <strong>{review.playedNotation}</strong>
                  <span className="review-category">{MOVE_REVIEW_LABELS[review.category]}</span>
                  <small>损失 {review.loss / 100} 子</small>
                  <span className="review-recommendation">推荐：{review.recommendedNotation}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!thinking && reviews.length === 0 && moveCount > 120 && (
        <div className="review-empty">当前棋谱超过 120 步，请缩短后再复盘。</div>
      )}
      {moveCount === 0 && (
        <div className="review-empty">完成走棋后，可在这里生成逐步复盘。</div>
      )}
    </section>
  )
}
