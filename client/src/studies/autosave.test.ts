import assert from 'node:assert/strict'
import test from 'node:test'
import { createStudyContentSignature, createStudySaveInput, StudyContentSnapshot } from './autosave'
import { StudyPosition } from '../types'

const CONTENT: StudyContentSnapshot = {
  initialFen: '9/9/9/9/9/9/9/9/4K4/4k4 w - - 0 1',
  moves: [],
  currentMoveIndex: -1,
  analysisPoints: [],
}

const STUDY: StudyPosition = {
  id: 'study-1',
  name: '测试研究',
  description: '保留元数据',
  ...CONTENT,
  createdAt: 1,
  updatedAt: 2,
}

test('createStudyContentSignature changes with editable study content', () => {
  assert.notEqual(
    createStudyContentSignature(CONTENT),
    createStudyContentSignature({ ...CONTENT, currentMoveIndex: 0 }),
  )
})

test('createStudySaveInput preserves study metadata and replaces content', () => {
  const input = createStudySaveInput(STUDY, {
    ...CONTENT,
    currentMoveIndex: 0,
  })

  assert.equal(input.id, 'study-1')
  assert.equal(input.name, '测试研究')
  assert.equal(input.description, '保留元数据')
  assert.equal(input.currentMoveIndex, 0)
})
