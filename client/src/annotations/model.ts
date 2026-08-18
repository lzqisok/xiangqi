import { BoardAnnotation, BoardAnnotationColor, BoardAnnotationType, Position } from '../types'

export const MAX_NODE_ANNOTATIONS = 64

export const ANNOTATION_COLOR_LABELS: Record<BoardAnnotationColor, string> = {
  red: '红色',
  green: '绿色',
  blue: '蓝色',
}

export const ANNOTATION_TYPE_LABELS: Record<BoardAnnotationType, string> = {
  arrow: '箭头',
  circle: '圈点',
}

export function isBoardPosition(position: Position): boolean {
  return (
    Number.isInteger(position.row) &&
    Number.isInteger(position.col) &&
    position.row >= 0 &&
    position.row < 10 &&
    position.col >= 0 &&
    position.col < 9
  )
}

export function createBoardAnnotation(
  type: BoardAnnotationType,
  color: BoardAnnotationColor,
  from: Position,
  to?: Position,
  id = `annotation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): BoardAnnotation | null {
  if (!isBoardPosition(from)) return null
  if (type === 'arrow') {
    if (!to || !isBoardPosition(to) || (from.row === to.row && from.col === to.col)) return null
    return { id, type, color, from: { ...from }, to: { ...to } }
  }
  return { id, type, color, from: { ...from } }
}

export function formatAnnotation(annotation: BoardAnnotation): string {
  const start = `${annotation.from.row + 1} 行 ${annotation.from.col + 1} 列`
  const target = annotation.to ? `至 ${annotation.to.row + 1} 行 ${annotation.to.col + 1} 列` : ''
  return `${ANNOTATION_COLOR_LABELS[annotation.color]}${ANNOTATION_TYPE_LABELS[annotation.type]}，${start}${target}`
}
