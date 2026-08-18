import { useEffect, useState } from 'react'
import { BLACK } from '../core/types'
import { useGameStore } from '../store/gameStore'
import type { ReviewReport, ReviewStep } from '../ai/types'

function gradeText(grade: 'best' | 'inaccuracy' | 'mistake' | 'blunder'): string {
  if (grade === 'best') return '最佳'
  if (grade === 'inaccuracy') return '可改进'
  if (grade === 'mistake') return '失误'
  return '严重失误'
}

interface ReviewContentProps {
  review: ReviewReport
  step: ReviewStep
  reviewCursor: number
  setReviewCursor: (cursor: number) => void
  expanded?: boolean
}

function ReviewContent({
  review,
  step,
  reviewCursor,
  setReviewCursor,
  expanded = false,
}: ReviewContentProps) {
  return (
    <div className={`gomoku-review-content ${expanded ? 'gomoku-review-content--expanded' : ''}`}>
      <div className="gomoku-review-nav">
        <button
          className="gomoku-btn-secondary"
          disabled={reviewCursor <= 0}
          onClick={() => setReviewCursor(reviewCursor - 1)}
        >
          上一步
        </button>
        <span>
          第 {step.ply} 手 / 共 {review.steps.length} 手
        </span>
        <button
          className="gomoku-btn-secondary"
          disabled={reviewCursor >= review.steps.length - 1}
          onClick={() => setReviewCursor(reviewCursor + 1)}
        >
          下一步
        </button>
      </div>

      <div className="gomoku-review-details">
        <div className="gomoku-review-step">
          <strong>本手评价</strong>
          <p>
            实战着法：{step.player === BLACK ? '黑' : '白'}方（
            {step.playedMove.row + 1}，{step.playedMove.col + 1}）
          </p>
          <p>
            评估偏差：{Math.round(step.delta)}（{gradeText(step.grade)}）
          </p>
          <p>
            黑方局势值：{Math.round(step.evalBlackBefore)} → {Math.round(step.evalBlackAfter)}
          </p>
        </div>

        <div className="gomoku-review-suggestions">
          <strong>推荐着法 Top 3</strong>
          <ol>
            {step.suggestions.map((suggestion, index) => (
              <li key={`${suggestion.row}-${suggestion.col}-${index}`}>
                （{suggestion.row + 1}，{suggestion.col + 1}），评分 {Math.round(suggestion.score)}
              </li>
            ))}
          </ol>
        </div>

        <div className="gomoku-review-summary">
          <strong>全局总结</strong>
          <p>
            关键转折手：
            {review.summary.keyTurns.length ? review.summary.keyTurns.join('、') : '无'}
          </p>
          <p>{review.summary.text}</p>
        </div>
      </div>
    </div>
  )
}

export function ReviewPanel() {
  const [expanded, setExpanded] = useState(false)
  const moveHistory = useGameStore((s) => s.moveHistory)
  const review = useGameStore((s) => s.review)
  const reviewLoading = useGameStore((s) => s.reviewLoading)
  const reviewProgress = useGameStore((s) => s.reviewProgress)
  const reviewError = useGameStore((s) => s.reviewError)
  const reviewCursor = useGameStore((s) => s.reviewCursor)
  const runReviewAnalysis = useGameStore((s) => s.runReviewAnalysis)
  const stopReviewAnalysis = useGameStore((s) => s.stopReviewAnalysis)
  const setReviewCursor = useGameStore((s) => s.setReviewCursor)

  const step = review?.steps[reviewCursor]

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  useEffect(() => {
    if (!review) setExpanded(false)
  }, [review])

  return (
    <>
      <section className="gomoku-panel gomoku-review-panel">
        <div className="gomoku-review-header">
          <div>
            <h3>局后复盘</h3>
            <span className="gomoku-review-source">内置 AI 分析</span>
          </div>
          <div className="gomoku-review-header-actions">
            {reviewLoading && (
              <button className="gomoku-btn-secondary" onClick={stopReviewAnalysis}>
                停止
              </button>
            )}
            {review && step && (
              <button className="gomoku-btn-primary" onClick={() => setExpanded(true)}>
                完整查看
              </button>
            )}
            <button
              className="gomoku-btn-secondary"
              disabled={reviewLoading || moveHistory.length === 0}
              onClick={runReviewAnalysis}
            >
              {reviewLoading && reviewProgress
                ? `分析 ${reviewProgress.completed}/${reviewProgress.total}`
                : reviewLoading
                  ? '分析中...'
                  : '重新分析'}
            </button>
          </div>
        </div>

        {reviewError && <p className="gomoku-review-error">{reviewError}</p>}

        {!review && !reviewLoading && (
          <p className="gomoku-review-empty">
            对局结束后会自动生成复盘；你也可以手动点击“重新分析”。
          </p>
        )}

        {reviewLoading && (
          <div className="gomoku-review-progress" aria-live="polite">
            <div>
              <span>正在逐手分析</span>
              <strong>
                {reviewProgress ? `${reviewProgress.completed}/${reviewProgress.total}` : '准备中'}
              </strong>
            </div>
            <progress value={reviewProgress?.completed ?? 0} max={reviewProgress?.total ?? 1} />
            <p>长局会自动降低候选规模，超过 20 秒将停止并提示重试。</p>
          </div>
        )}

        {review && step && (
          <ReviewContent
            review={review}
            step={step}
            reviewCursor={reviewCursor}
            setReviewCursor={setReviewCursor}
          />
        )}
      </section>

      {expanded && review && step && (
        <div
          className="gomoku-review-overlay"
          role="presentation"
          onMouseDown={() => setExpanded(false)}
        >
          <section
            className="gomoku-review-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gomoku-review-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="gomoku-review-dialog-title">完整复盘</h2>
                <p>内置 AI 逐手评估 · 支持前后手查看</p>
              </div>
              <button className="gomoku-btn-secondary" onClick={() => setExpanded(false)}>
                关闭
              </button>
            </header>
            <ReviewContent
              review={review}
              step={step}
              reviewCursor={reviewCursor}
              setReviewCursor={setReviewCursor}
              expanded
            />
          </section>
        </div>
      )}
    </>
  )
}
