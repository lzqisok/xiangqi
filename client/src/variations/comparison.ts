import { applyMove, parseFen } from '../engine/board'
import { moveToNotation, uciToMove } from '../engine/notation'
import { NodeAnalysis, VariationNode, VariationTree } from '../types'

export interface ComparedAnalysis {
  nodeId: string
  notation: string
  score: number
  redWinRate: number
  depth: number
  recommendedLine: string[]
}

export interface BranchComparisonSummary {
  childId: string
  label: string
  isMain: boolean
  analyzedCount: number
  totalCount: number
  latest?: ComparedAnalysis
}

export interface BranchComparisonPoint {
  offset: number
  scoreDelta: number
  left: ComparedAnalysis
  right: ComparedAnalysis
}

export interface BranchComparison {
  left: BranchComparisonSummary
  right: BranchComparisonSummary
  keyPoints: BranchComparisonPoint[]
}

export function scoreToRedWinRate(score: number): number {
  const clamped = Math.max(-2000, Math.min(2000, score))
  return Math.round((100 / (1 + Math.exp(-clamped / 260))) * 10) / 10
}

function getMainLineFromChild(tree: VariationTree, childId: string): VariationNode[] {
  const nodes: VariationNode[] = []
  const visited = new Set<string>()
  let currentId: string | undefined = childId
  while (currentId && tree.nodes[currentId] && !visited.has(currentId)) {
    visited.add(currentId)
    const node: VariationNode = tree.nodes[currentId]
    nodes.push(node)
    currentId = node.mainChildId
  }
  return nodes
}

function translatePv(fen: string, pv: string[] | undefined): string[] {
  if (!pv?.length) return []
  let { board } = parseFen(fen)
  const line: string[] = []
  for (const uci of pv.slice(0, 5)) {
    try {
      const { from, to } = uciToMove(uci)
      const piece = board[from.row][from.col]
      if (!piece) break
      const move = { from, to, piece, captured: board[to.row][to.col] || undefined }
      line.push(moveToNotation(board, move))
      board = applyMove(board, from, to).newBoard
    } catch {
      break
    }
  }
  return line
}

function toComparedAnalysis(node: VariationNode, analysis: NodeAnalysis): ComparedAnalysis {
  const recommendedLine = translatePv(node.fen, analysis.pv)
  return {
    nodeId: node.id,
    notation: node.move?.notation || '初始局面',
    score: analysis.score,
    redWinRate: scoreToRedWinRate(analysis.score),
    depth: analysis.depth,
    recommendedLine:
      recommendedLine.length > 0 ? recommendedLine : analysis.bestMove ? [analysis.bestMove] : [],
  }
}

function summarizeBranch(
  tree: VariationTree,
  childId: string,
  mainChildId: string | undefined,
): { summary: BranchComparisonSummary; analyzed: ComparedAnalysis[] } | null {
  const line = getMainLineFromChild(tree, childId)
  if (line.length === 0) return null
  const analyzed = line.flatMap((node) =>
    node.analysis ? [toComparedAnalysis(node, node.analysis)] : [],
  )
  return {
    summary: {
      childId,
      label: line[0].move?.notation || '未命名走法',
      isMain: childId === mainChildId,
      analyzedCount: analyzed.length,
      totalCount: line.length,
      latest: analyzed[analyzed.length - 1],
    },
    analyzed: line.map((node) =>
      node.analysis
        ? toComparedAnalysis(node, node.analysis)
        : {
            nodeId: node.id,
            notation: node.move?.notation || '未命名走法',
            score: Number.NaN,
            redWinRate: Number.NaN,
            depth: 0,
            recommendedLine: [],
          },
    ),
  }
}

export function buildBranchComparison(
  tree: VariationTree,
  parentId: string,
  leftChildId: string,
  rightChildId: string,
): BranchComparison | null {
  if (leftChildId === rightChildId) return null
  const parent = tree.nodes[parentId]
  if (!parent?.children.includes(leftChildId) || !parent.children.includes(rightChildId))
    return null
  const left = summarizeBranch(tree, leftChildId, parent.mainChildId)
  const right = summarizeBranch(tree, rightChildId, parent.mainChildId)
  if (!left || !right) return null

  const keyPoints: BranchComparisonPoint[] = []
  const pairedCount = Math.min(left.analyzed.length, right.analyzed.length)
  for (let index = 0; index < pairedCount; index++) {
    const leftPoint = left.analyzed[index]
    const rightPoint = right.analyzed[index]
    if (!Number.isFinite(leftPoint.score) || !Number.isFinite(rightPoint.score)) continue
    keyPoints.push({
      offset: index + 1,
      scoreDelta: leftPoint.score - rightPoint.score,
      left: leftPoint,
      right: rightPoint,
    })
  }
  keyPoints.sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))

  return {
    left: left.summary,
    right: right.summary,
    keyPoints: keyPoints.slice(0, 5),
  }
}
