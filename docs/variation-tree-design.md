# 变招树数据模型设计

## 目标

变招树用于在同一局面下保留多条后续走法。它主要服务研究局面：

- 悔棋后走新棋不覆盖旧线。
- 支持主线与支线切换。
- 每个节点可保留备注、星标和引擎评估。
- 后续可与候选走法、回放分享和研究导入导出组合。

当前第一阶段已经落地，同时保留线性 `moveRecords` 作为活动分支的派生结果。

## 实施状态

- 已完成旧线性棋谱到变招树的自动迁移。
- 已完成悔棋后创建支线、分支切换和设为主线。
- 已完成研究本地存储、自动保存、复制与 JSON v2 导入导出。
- 回放链接仍只分享当前活动线；节点独立评估留待后续阶段。

## 当前约束

当前核心历史结构是 `MoveRecord[]`：

- `useGame` 以数组和 `currentMoveIndex` 管理悔棋、重做、跳转。
- `MoveHistory` 按数组顺序展示走棋记录。
- 研究局面存储 `initialFen + moves + currentMoveIndex + analysisPoints`。
- 导入导出 JSON 依赖现有线性结构。

因此变招树不能一次性替换历史模型，应先兼容线性主线。

## 建议模型

```ts
export interface VariationNode {
  id: string
  parentId: string | null
  move?: MoveRecord
  fen: string
  children: string[]
  mainChildId?: string
  marked?: boolean
  note?: string
  evaluation?: {
    score: number
    depth: number
  }
  createdAt: number
  updatedAt: number
}

export interface VariationTree {
  rootId: string
  nodes: Record<string, VariationNode>
  currentNodeId: string
}
```

约定：

- 根节点没有 `move`，`fen` 是研究起始局面。
- 子节点的 `move` 表示从父节点走到该节点的走法。
- `children` 保存所有后续分支。
- `mainChildId` 表示主线，每个节点最多一个主线子节点。
- `marked`、`note` 可先保留在 `MoveRecord` 中，迁移后再逐步提升到节点字段。
- `evaluation` 保存该节点局面的引擎评估，不保存完整 PV，避免第一阶段存储膨胀。

## 线性记录迁移

从当前 `MoveRecord[]` 迁移到树：

1. 创建根节点：
   - `parentId: null`
   - `fen: initialFen`
   - `children: []`
2. 按数组顺序遍历 `moves`。
3. 每个 `MoveRecord` 创建一个子节点。
4. 父节点的 `children` 追加该子节点。
5. 父节点的 `mainChildId` 指向该子节点。
6. 最后一个已播放索引对应的节点作为 `currentNodeId`。

`currentMoveIndex === -1` 时，`currentNodeId = rootId`。

## 主线规则

- 每个节点最多一个 `mainChildId`。
- 新分支创建时不自动抢主线，除非当前节点没有主线。
- 用户可以手动“设为主线”。
- 导出线性棋谱时，默认沿 `mainChildId` 输出。

## 受影响模块

- `client/src/hooks/useGame.ts`
  - 当前历史状态、悔棋、重做、跳转、新走法追加逻辑。
  - 第一阶段建议保留线性派生结果，避免所有调用方同时迁移。
- `client/src/components/MoveHistory.tsx`
  - 需要从线性列表升级为树形或主线 + 支线混合展示。
- `client/src/studies/storage.ts`
  - 需要支持 `variationTree` 字段，同时继续读取旧版 `moves`。
- `client/src/types.ts`
  - 新增 `VariationNode`、`VariationTree`，并扩展 `StudyPosition`。
- 导入导出
  - JSON 需要版本化，旧数据导入时自动迁移。
- 测试
  - 历史跳转、悔棋后新分支、主线切换、旧研究导入兼容。

## 分阶段落地

### 阶段 1：只读模型与迁移

- 新增类型与转换函数。
- 旧 `MoveRecord[]` 可转换为 `VariationTree`。
- UI 仍显示线性主线。
- 研究导入导出保留旧格式，不改变行为。

验收：

- 旧研究数据可以无损转换为树。
- 主线导出后与原 `moves` 顺序一致。

### 阶段 2：保留分支

- 在非末尾节点走新棋时，不截断原后续。
- 新走法成为当前节点的新 child。
- 如果父节点没有主线，则新 child 设为主线；否则作为支线。

验收：

- 悔棋后走新棋，旧线仍可找回。
- 当前线性回放不丢失。

### 阶段 3：分支切换与主线设置

- 走棋记录 UI 展示节点分支。
- 支持切换到任意子分支。
- 支持“设为主线”。

验收：

- 同一局面多个后续走法可切换。
- 主线变化后，复制棋谱和回放默认走新主线。

### 阶段 4：研究存储升级

- `StudyPosition` 增加 `variationTree?: VariationTree`。
- 保存新研究时写入树结构。
- 导入旧研究时自动迁移。
- 导出时保留版本号。

验收：

- 旧 JSON 可导入。
- 新 JSON 可完整保留分支、备注、星标和评估。

## 暂不做

- 在线协同编辑变招树。
- 多人评论。
- 将完整引擎 PV 自动写入树。
- 云端存储和短链接。
