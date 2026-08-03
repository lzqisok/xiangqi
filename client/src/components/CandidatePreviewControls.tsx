interface Props {
  candidateLabel: string
  notation: string
  stepIndex: number
  stepCount: number
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

export default function CandidatePreviewControls({
  candidateLabel,
  notation,
  stepIndex,
  stepCount,
  onPrevious,
  onNext,
  onClose,
}: Props) {
  return (
    <div className="candidate-preview-controls" aria-live="polite">
      <div className="candidate-preview-summary">
        <strong>候选预览：{candidateLabel}</strong>
        <span>{stepIndex}/{stepCount} · {notation}</span>
      </div>
      <div className="candidate-preview-actions">
        <button onClick={onPrevious} disabled={stepIndex <= 0}>上一步</button>
        <button onClick={onNext} disabled={stepIndex >= stepCount}>下一步</button>
        <button className="candidate-preview-close" onClick={onClose}>退出预览</button>
      </div>
    </div>
  )
}
