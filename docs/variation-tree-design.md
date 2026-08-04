# 变招树数据模型设计

## 目标

变招树用于在同一局面下保留多条后续走法。它主要服务研究局面：

- 悔棋后走新棋不覆盖旧线。
- 支持主线与支线切换。
- 每个节点可保留备注、星标和引擎评估。
- 后续可与候选走法、回放分享和研究导入导出组合。

当前变招保留、分支切换、主线设置和研究 JSON v2 存储均已落地，同时保留线性 `moveRecords` 作为活动分支的派生结果。

## 实施状态

- 已完成旧线性棋谱到变招树的自动迁移。
- 已完成悔棋后创建支线、分支切换和设为主线。
- 已完成研究本地存储、自动保存、复制与 JSON v2 导入导出。
- 已完成当前节点后续分支展示、切换和设为主线。
- 回放链接仍只分享当前活动线；节点独立评估留待后续阶段。

## 当前约束

当前核心历史结构是 `MoveRecord[]`：

- `useGame` 以数组和 `currentMoveIndex` 管理悔棋、重做、跳转。
- `MoveHistory` 按数组顺序展示走棋记录。
- 研究局面存储 `initialFen + moves + currentMoveIndex + analysisPoints`。
- 导入导出 JSON 依赖现有线性结构。

因此变招树不能一次性替换历史模型，应先兼容线性主线。

## 当前模型

```ts
export interface VariationNode {
  id: string
  parentId: string | null
  move?: MoveRecord
  fen: string
  children: string[]
  mainChildId?: string
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
- 星标和备注当前保存在节点内的 `MoveRecord` 上。
- 引擎评估仍按活动线的步索引保存于研究对象；提升为节点独立评估是后续工作。

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

## 实际模块边界

- `client/src/hooks/useGame.ts`
  - 当前历史状态、悔棋、重做、跳转、新走法追加逻辑。
  - 保留线性派生结果，避免所有调用方同时维护树结构。
- `client/src/components/MoveHistory.tsx`
  - 继续展示当前活动线；分支入口由 `VariationPanel` 展示。
- `client/src/components/VariationPanel.tsx`
  - 展示当前局面的后续分支，并支持切换和设为主线。
- `client/src/studies/storage.ts`
  - 保存 `variationTree` 字段，同时继续读取旧版 `moves`。
- `client/src/types.ts`
  - 定义 `VariationNode`、`VariationTree`，并扩展 `StudyPosition`。
- 导入导出
  - JSON v2 保存完整变招树，旧数据导入时自动迁移。
- 测试
  - 历史跳转、悔棋后新分支、主线切换、旧研究导入兼容。

## 已完成的分阶段落地

### 阶段 1：只读模型与迁移（已完成）

- 新增类型与转换函数。
- 旧 `MoveRecord[]` 可转换为 `VariationTree`。
- UI 仍显示线性主线。
- 研究导入导出保留旧格式，不改变行为。

验收：

- 旧研究数据可以无损转换为树。
- 主线导出后与原 `moves` 顺序一致。

### 阶段 2：保留分支（已完成）

- 在非末尾节点走新棋时，不截断原后续。
- 新走法成为当前节点的新 child。
- 如果父节点没有主线，则新 child 设为主线；否则作为支线。

验收：

- 悔棋后走新棋，旧线仍可找回。
- 当前线性回放不丢失。

### 阶段 3：分支切换与主线设置（已完成）

- 走棋记录 UI 展示节点分支。
- 支持切换到任意子分支。
- 支持“设为主线”。

验收：

- 同一局面多个后续走法可切换。
- 主线变化后，复制棋谱和回放默认走新主线。

### 阶段 4：研究存储升级（已完成）

- `StudyPosition` 增加 `variationTree?: VariationTree`。
- 保存新研究时写入树结构。
- 导入旧研究时自动迁移。
- 导出时保留版本号。

验收：

- 旧 JSON 可导入。
- 新 JSON 可完整保留分支、备注、星标和评估。

## 后续边界

- 在线协同编辑变招树。
- 多人评论。
- 将完整引擎 PV 自动写入树。
- 将分析曲线和评估绑定到每个变招节点。
- 在分享链接中携带完整变招树。
- 云端存储和短链接。
