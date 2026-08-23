import {
  AnalysisPoint,
  BoardAnnotation,
  EngineSearchLimit,
  MoveRecord,
  NodeAnalysis,
  VariationNode,
  VariationTree,
} from '../types'
import { moveToUci } from '../engine/notation'

export interface VariationLine {
  nodeIds: string[]
  records: MoveRecord[]
  currentMoveIndex: number
}

function moveKey(record: MoveRecord): string {
  return moveToUci(record.move.from, record.move.to)
}

function makeNodeId(): string {
  return `variation-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createVariationTree(
  initialFen: string,
  records: MoveRecord[],
  currentMoveIndex = records.length - 1,
  now = Date.now(),
): VariationTree {
  const rootId = 'variation-root'
  const nodes: Record<string, VariationNode> = {
    [rootId]: {
      id: rootId,
      parentId: null,
      fen: initialFen,
      children: [],
      createdAt: now,
      updatedAt: now,
    },
  }
  let parentId = rootId
  let currentNodeId = rootId

  records.forEach((record, index) => {
    const id = `variation-node-${index + 1}`
    nodes[id] = {
      id,
      parentId,
      move: record,
      fen: record.fen,
      children: [],
      createdAt: now,
      updatedAt: now,
    }
    nodes[parentId].children.push(id)
    nodes[parentId].mainChildId = id
    if (index <= currentMoveIndex) currentNodeId = id
    parentId = id
  })

  return { rootId, nodes, currentNodeId }
}

export function getPathNodeIds(tree: VariationTree, nodeId: string): string[] {
  const reversed: string[] = []
  const visited = new Set<string>()
  let current: VariationNode | undefined = tree.nodes[nodeId]

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    reversed.push(current.id)
    current = current.parentId ? tree.nodes[current.parentId] : undefined
  }

  const path = reversed.reverse()
  return path[0] === tree.rootId ? path : [tree.rootId]
}

export function getVariationLine(
  tree: VariationTree,
  currentNodeId = tree.currentNodeId,
): VariationLine {
  const path = getPathNodeIds(tree, currentNodeId)
  const nodeIds = path.slice(1)
  const visited = new Set(path)
  let nextId = tree.nodes[currentNodeId]?.mainChildId

  while (nextId && tree.nodes[nextId] && !visited.has(nextId)) {
    visited.add(nextId)
    nodeIds.push(nextId)
    nextId = tree.nodes[nextId].mainChildId
  }

  return {
    nodeIds,
    records: nodeIds.flatMap((id) => (tree.nodes[id]?.move ? [tree.nodes[id].move] : [])),
    currentMoveIndex: path.length - 2,
  }
}

export function addVariationMove(
  tree: VariationTree,
  parentId: string,
  record: MoveRecord,
  now = Date.now(),
): { tree: VariationTree; nodeId: string; created: boolean } {
  const parent = tree.nodes[parentId]
  if (!parent) return { tree, nodeId: tree.currentNodeId, created: false }

  const existingId = parent.children.find((id) => {
    const move = tree.nodes[id]?.move
    return move ? moveKey(move) === moveKey(record) : false
  })
  if (existingId) {
    return {
      tree: { ...tree, currentNodeId: existingId },
      nodeId: existingId,
      created: false,
    }
  }

  const nodeId = makeNodeId()
  const node: VariationNode = {
    id: nodeId,
    parentId,
    move: record,
    fen: record.fen,
    children: [],
    createdAt: now,
    updatedAt: now,
  }
  const nextParent = {
    ...parent,
    children: [...parent.children, nodeId],
    mainChildId: parent.mainChildId || nodeId,
    updatedAt: now,
  }
  return {
    tree: {
      ...tree,
      nodes: { ...tree.nodes, [parentId]: nextParent, [nodeId]: node },
      currentNodeId: nodeId,
    },
    nodeId,
    created: true,
  }
}

export function selectVariationNode(tree: VariationTree, nodeId: string): VariationTree {
  return tree.nodes[nodeId] ? { ...tree, currentNodeId: nodeId } : tree
}

export function setMainVariation(
  tree: VariationTree,
  parentId: string,
  childId: string,
  now = Date.now(),
): VariationTree {
  const parent = tree.nodes[parentId]
  if (!parent || !parent.children.includes(childId)) return tree
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [parentId]: { ...parent, mainChildId: childId, updatedAt: now },
    },
  }
}

/**
 * 删除以 `nodeId` 为根的整条支线。节点上的标注和分析随节点一并删除，
 * 因而不会留下与已删除分支脱离的评估数据。
 */
export function deleteVariationBranch(
  tree: VariationTree,
  nodeId: string,
  now = Date.now(),
): VariationTree {
  const node = tree.nodes[nodeId]
  if (!node?.parentId || nodeId === tree.rootId) return tree

  const removedIds = new Set<string>()
  const pending = [nodeId]
  while (pending.length > 0) {
    const currentId = pending.pop()!
    if (removedIds.has(currentId)) continue
    const current = tree.nodes[currentId]
    if (!current) continue
    removedIds.add(currentId)
    pending.push(...current.children)
  }

  const parent = tree.nodes[node.parentId]
  if (!parent) return tree
  const children = parent.children.filter((childId) => !removedIds.has(childId))
  const nodes = { ...tree.nodes }
  removedIds.forEach((removedId) => delete nodes[removedId])
  nodes[parent.id] = {
    ...parent,
    children,
    mainChildId:
      parent.mainChildId && !removedIds.has(parent.mainChildId) ? parent.mainChildId : children[0],
    updatedAt: now,
  }

  return {
    ...tree,
    nodes,
    currentNodeId: removedIds.has(tree.currentNodeId) ? parent.id : tree.currentNodeId,
  }
}

export function updateVariationMove(
  tree: VariationTree,
  nodeId: string,
  record: MoveRecord,
  now = Date.now(),
): VariationTree {
  const node = tree.nodes[nodeId]
  if (!node?.move) return tree
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [nodeId]: { ...node, move: record, fen: record.fen, updatedAt: now },
    },
  }
}

export function updateVariationAnnotations(
  tree: VariationTree,
  nodeId: string,
  annotations: BoardAnnotation[],
  now = Date.now(),
): VariationTree {
  const node = tree.nodes[nodeId]
  if (!node) return tree
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [nodeId]: {
        ...node,
        annotations: annotations.length > 0 ? annotations : undefined,
        updatedAt: now,
      },
    },
  }
}

export function countVariationBranches(tree: VariationTree): number {
  return Object.values(tree.nodes).reduce(
    (count, node) => count + Math.max(0, node.children.length - 1),
    0,
  )
}

/**
 * 把活动线步索引映射到变招节点 id。
 * 只接受 `-1`(根节点)或 `>= 0`(活动线节点);其他值(非法负数、越界)返回 null。
 * 请求定位、迁移和曲线派生统一使用该规则,避免各处索引语义不一致。
 */
export function getNodeIdAtMoveIndex(
  tree: VariationTree,
  activeNodeIds: string[],
  moveIndex: number,
): string | null {
  if (moveIndex === -1) return tree.rootId
  if (moveIndex < 0) return null
  return activeNodeIds[moveIndex] || null
}

/**
 * 分析请求目标快照,用于判定迟到的 info 是否仍属于当前请求与局面。
 */
export interface AnalysisRequestTarget {
  id: string
  movesKey: string
}

/**
 * 判定一条 info 响应是否应当被接受:
 * 目标存在、`requestId` 严格匹配,且响应对应的走法签名与当前局面一致。
 * 缺少 `requestId` 的响应同样拒绝,避免无法归属的 info 污染当前节点。
 */
export function shouldAcceptAnalysisInfo(
  target: AnalysisRequestTarget | null,
  requestId: string | undefined,
  currentMovesKey: string,
): boolean {
  if (!target) return false
  if (requestId !== target.id) return false
  return target.movesKey === currentMovesKey
}

/**
 * 生成节点分析的引擎配置签名,用于判断缓存分析是否仍可复用。
 * 同一搜索限制与引擎配置下,节点评估可以直接复用。
 */
export function nodeAnalysisSignature(
  searchLimit: EngineSearchLimit | undefined,
  engineThreads: number | 'auto' | undefined,
  engineHashMb: number | undefined,
): string {
  const searchMode = searchLimit?.searchMode || 'depth'
  const searchValue =
    searchMode === 'time' ? (searchLimit?.searchTimeMs ?? '') : (searchLimit?.searchDepth ?? '')
  return [searchMode, searchValue, engineThreads ?? '', engineHashMb ?? ''].join('|')
}

export function hasReusableNodeAnalysis(
  analysis: NodeAnalysis | undefined,
  searchLimit: EngineSearchLimit | undefined,
  engineThreads: number | 'auto' | undefined,
  engineHashMb: number | undefined,
): boolean {
  return (
    !!analysis &&
    analysis.complete === true &&
    nodeAnalysisSignature(analysis.searchLimit, analysis.engineThreads, analysis.engineHashMb) ===
      nodeAnalysisSignature(searchLimit, engineThreads, engineHashMb)
  )
}

export interface NodeAnalysisTaskEntry {
  nodeId: string
  moveIndex: number
  movesKey: string
}

/**
 * 为有限分析任务建立不可变的节点/历史签名快照。后续响应只按该快照写回，
 * 即使用户切换了当前分支，也不会把相同步数的结果写到另一节点。
 */
export function buildNodeAnalysisTaskEntries(
  tree: VariationTree,
  nodeIds: string[],
): NodeAnalysisTaskEntry[] {
  const moves: string[] = []
  return nodeIds.flatMap((nodeId, index) => {
    if (index === 0 && nodeId === tree.rootId) {
      return [{ nodeId, moveIndex: -1, movesKey: '' }]
    }
    const node = tree.nodes[nodeId]
    if (!node?.move) return []
    moves.push(moveKey(node.move))
    return [{ nodeId, moveIndex: index - 1, movesKey: moves.join(' ') }]
  })
}

export function shouldAcceptNodeAnalysisTaskEntry(
  tree: VariationTree,
  entry: NodeAnalysisTaskEntry,
): boolean {
  const path = getPathNodeIds(tree, entry.nodeId)
  if (path[0] !== tree.rootId || path[path.length - 1] !== entry.nodeId) return false
  const movesKey = path
    .slice(1)
    .flatMap((nodeId) => (tree.nodes[nodeId]?.move ? [moveKey(tree.nodes[nodeId].move!)] : []))
    .join(' ')
  return movesKey === entry.movesKey
}

export function setVariationAnalysis(
  tree: VariationTree,
  nodeId: string,
  analysis: NodeAnalysis,
  now = Date.now(),
): VariationTree {
  const node = tree.nodes[nodeId]
  if (!node) return tree
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [nodeId]: { ...node, analysis, updatedAt: now },
    },
  }
}

export function clearVariationAnalysis(
  tree: VariationTree,
  nodeId: string,
  now = Date.now(),
): VariationTree {
  const node = tree.nodes[nodeId]
  if (!node?.analysis) return tree
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [nodeId]: { ...node, analysis: undefined, updatedAt: now },
    },
  }
}

/**
 * 从活动线的节点分析结果派生分析曲线。
 * 根节点(初始局面)作为 `moveIndex: -1` 排在首位;其余节点按活动线顺序排列,
 * 节点没有分析时跳过。
 */
export function deriveAnalysisPoints(
  tree: VariationTree,
  activeNodeIds: string[],
): AnalysisPoint[] {
  const points: AnalysisPoint[] = []
  const rootAnalysis = tree.nodes[tree.rootId]?.analysis
  if (rootAnalysis) {
    points.push({ moveIndex: -1, evaluation: rootAnalysis.score, depth: rootAnalysis.depth })
  }
  activeNodeIds.forEach((nodeId, index) => {
    const analysis = tree.nodes[nodeId]?.analysis
    if (analysis) {
      points.push({ moveIndex: index, evaluation: analysis.score, depth: analysis.depth })
    }
  })
  return points
}

/**
 * 把旧版按活动线步索引保存的分析点迁移到对应节点。
 * `moveIndex: -1` 写入根节点,其余按活动线索引写入。
 * 仅当节点尚无分析时写入;迁移数据没有配置信息,缓存签名不会命中,首次打开会重新分析。
 */
export function migrateAnalysisPointsToTree(
  tree: VariationTree,
  points: AnalysisPoint[],
): VariationTree {
  if (points.length === 0) return tree
  const line = getVariationLine(tree)
  let nodes = tree.nodes
  let changed = false
  points.forEach((point) => {
    const nodeId = getNodeIdAtMoveIndex(tree, line.nodeIds, point.moveIndex)
    if (!nodeId) return
    const node = nodes[nodeId]
    if (!node || node.analysis) return
    nodes = {
      ...nodes,
      [nodeId]: {
        ...node,
        analysis: { score: point.evaluation, depth: point.depth, updatedAt: 0 },
      },
    }
    changed = true
  })
  return changed ? { ...tree, nodes } : tree
}
