import { MoveRecord, VariationNode, VariationTree } from '../types'
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

export function getVariationLine(tree: VariationTree, currentNodeId = tree.currentNodeId): VariationLine {
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
    records: nodeIds.flatMap(id => tree.nodes[id]?.move ? [tree.nodes[id].move] : []),
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

  const existingId = parent.children.find(id => {
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

export function setMainVariation(tree: VariationTree, parentId: string, childId: string, now = Date.now()): VariationTree {
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

export function updateVariationMove(tree: VariationTree, nodeId: string, record: MoveRecord, now = Date.now()): VariationTree {
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

export function countVariationBranches(tree: VariationTree): number {
  return Object.values(tree.nodes).reduce((count, node) => count + Math.max(0, node.children.length - 1), 0)
}
