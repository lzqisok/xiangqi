/// <reference lib="webworker" />
import { findBestMoveScored } from './search'
import { analyzeGameReview } from './review'
import type { WorkerRequest, WorkerResponse } from './types'

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  const { id } = message

  if (message.type === 'compute') {
    const payload = message.payload
    const result = findBestMoveScored(
      payload.board,
      payload.currentPlayer,
      payload.aiPlayer,
      payload.forbiddenEnabled,
      payload.difficulty,
      {
        partitionModulo: payload.partitionModulo,
        partitionIndex: payload.partitionIndex,
      },
    )

    const response: WorkerResponse = {
      id,
      type: 'best-move',
      move: result.move,
      score: result.score,
    }
    self.postMessage(response)
    return
  }

  if (message.type === 'review') {
    const response: WorkerResponse = {
      id,
      type: 'review-result',
      review: analyzeGameReview(message.payload, (completed, total) => {
        self.postMessage({ id, type: 'review-progress', completed, total } satisfies WorkerResponse)
      }),
    }
    self.postMessage(response)
  }
}

export {}
