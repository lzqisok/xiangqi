import { TrainingTask } from '../types'
import { TrainingEvaluation, getTrainingHint } from '../training/tasks'

interface TrainingSessionPanelProps {
  task: TrainingTask
  hintLevel: number
  attemptedNotation: string
  evaluation: TrainingEvaluation | null
  evaluating: boolean
  hasNext: boolean
  canOpenSource: boolean
  onRevealHint: () => void
  onRetry: () => void
  onNext: () => void
  onBack: () => void
  onOpenSource: () => void
}

export default function TrainingSessionPanel({
  task,
  hintLevel,
  attemptedNotation,
  evaluation,
  evaluating,
  hasNext,
  canOpenSource,
  onRevealHint,
  onRetry,
  onNext,
  onBack,
  onOpenSource,
}: TrainingSessionPanelProps) {
  const hint = getTrainingHint(task, hintLevel)
  const resultText = evaluation
    ? evaluation.passed
      ? evaluation.method === 'recommended'
        ? '通过：你走出了推荐着。'
        : `通过：这步评估损失 ${((evaluation.loss || 0) / 100).toFixed(2)} 子，在允许范围内。`
      : evaluation.method === 'fallback'
        ? '未通过：引擎当前不可用，本次按推荐着精确匹配。'
        : `未通过：这步评估损失 ${((evaluation.loss || 0) / 100).toFixed(2)} 子。`
    : ''

  return (
    <section className="training-session-panel">
      <header>
        <div>
          <small>错着训练</small>
          <h3>{task.source.name}</h3>
        </div>
        <span>{task.mover === 'red' ? '红方走棋' : '黑方走棋'}</span>
      </header>

      {!attemptedNotation && (
        <div className="training-session-prompt">
          <strong>请先独立走出你认为最好的着法</strong>
          <p>答案默认隐藏。需要时可依次查看方向、候选棋子和推荐变化。</p>
        </div>
      )}

      {hint && !evaluation && <div className="training-session-hint">{hint}</div>}

      {!attemptedNotation && (
        <button className="training-hint-action" onClick={onRevealHint} disabled={hintLevel >= 3}>
          {hintLevel === 0
            ? '查看方向提示'
            : hintLevel === 1
              ? '查看候选棋子'
              : hintLevel === 2
                ? '查看推荐变化'
                : '提示已全部展示'}
        </button>
      )}

      {attemptedNotation && (
        <div className={`training-attempt-result ${evaluation?.passed ? 'passed' : 'failed'}`}>
          <span>你的着法</span>
          <strong>{attemptedNotation}</strong>
          {evaluating ? <p>正在评估这步棋…</p> : <p>{resultText}</p>}
          {evaluation && (
            <small>推荐：{task.recommendedLine.join(' ') || task.recommendedNotation}</small>
          )}
        </div>
      )}

      <div className="training-session-actions">
        {evaluation && <button onClick={onRetry}>再练一次</button>}
        {evaluation && hasNext && <button onClick={onNext}>下一题</button>}
        <button onClick={onOpenSource} disabled={!canOpenSource}>
          返回来源节点
        </button>
        <button onClick={onBack}>返回训练队列</button>
      </div>
    </section>
  )
}
