import assert from 'node:assert/strict'
import test from 'node:test'
import { getManualDrawStatus, getRedoTargetIndex, getResignationStatus, getUndoTargetIndex, sendStopForActiveEngineRequests, shouldAutoRequestAiMove } from './gameFlow'

const human = { type: 'human' as const }
const ai = { type: 'ai' as const, difficulty: 'medium' as const }

test('human-vs-ai undo and redo move in paired turns', () => {
  const players = { red: human, black: ai }

  assert.equal(getUndoTargetIndex(3, 'human-vs-ai', players), 1)
  assert.equal(getUndoTargetIndex(1, 'human-vs-ai', players), -1)
  assert.equal(getRedoTargetIndex(-1, 4, 'human-vs-ai', players), 1)
  assert.equal(getRedoTargetIndex(1, 4, 'human-vs-ai', players), 3)
})

test('human-vs-human undo and redo move one ply at a time', () => {
  const players = { red: human, black: human }

  assert.equal(getUndoTargetIndex(3, 'human-vs-human', players), 2)
  assert.equal(getRedoTargetIndex(1, 4, 'human-vs-human', players), 2)
})

test('endgame single AI side follows paired undo flow', () => {
  assert.equal(getUndoTargetIndex(4, 'endgame', { red: human, black: ai }), 2)
  assert.equal(getRedoTargetIndex(0, 5, 'endgame', { red: ai, black: human }), 2)
})

test('AI move auto trigger excludes ai-vs-ai and blocked states', () => {
  assert.equal(shouldAutoRequestAiMove({
    gameStatus: 'playing',
    aiThinking: false,
    gameMode: 'human-vs-ai',
    currentPlayer: ai,
    connected: true,
  }), true)

  assert.equal(shouldAutoRequestAiMove({
    gameStatus: 'playing',
    aiThinking: false,
    gameMode: 'ai-vs-ai',
    currentPlayer: ai,
    connected: true,
  }), false)

  assert.equal(shouldAutoRequestAiMove({
    gameStatus: 'playing',
    aiThinking: true,
    gameMode: 'human-vs-ai',
    currentPlayer: ai,
    connected: true,
  }), false)
})

test('manual draw and resignation produce manual game-over states', () => {
  assert.deepEqual(getManualDrawStatus(), {
    status: 'draw',
    reason: 'manual',
  })
  assert.deepEqual(getResignationStatus('red'), {
    status: 'black-wins',
    reason: 'resignation',
  })
  assert.deepEqual(getResignationStatus('black'), {
    status: 'red-wins',
    reason: 'resignation',
  })
})

test('local request cleanup sends stop only when websocket is connected', () => {
  const sent: unknown[] = []
  const send = (message: unknown) => {
    sent.push(message)
    return true
  }

  sendStopForActiveEngineRequests(true, send)
  sendStopForActiveEngineRequests(false, send)

  assert.deepEqual(sent, [{ type: 'stop' }])
})

test('local request cleanup can be reused by every board reset path', () => {
  const sent: unknown[] = []
  const send = (message: unknown) => {
    sent.push(message)
    return true
  }

  for (const _ of ['undo', 'redo', 'jump', 'load-fen', 'manual-end']) {
    sendStopForActiveEngineRequests(true, send)
  }

  assert.deepEqual(sent, [
    { type: 'stop' },
    { type: 'stop' },
    { type: 'stop' },
    { type: 'stop' },
    { type: 'stop' },
  ])
})
