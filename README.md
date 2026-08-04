# 棋境：中国象棋（Web + Pikafish）

一个以本地 [Pikafish](https://github.com/official-pikafish/Pikafish) 为棋力核心的 Web 中国象棋应用，覆盖对弈、残局训练、局面研究、变招管理与整局复盘。前端使用 React + Canvas，后端通过 WebSocket 和 UCI 协议管理本地 Pikafish 进程；棋局与研究数据默认保存在浏览器本地。

![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-9.15.9-F69220?logo=pnpm&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=1f2937)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-GPL--3.0-blue)

## 功能概览

### 对弈

- 人机对弈：可执红先手或执黑后手，提供初级 D8、中级 D14、高级 D20、大师 D26 四档棋力。
- 双人对弈：本地同屏轮流走棋，支持手动和棋与认输。
- AI 对战：红黑双方独立设置难度，可单步推进，也可按快速、标准、慢速自动播放。
- 完整对局操作：悔棋、重做、棋盘翻转、中文记谱、落子/吃子/将军/终局音效。
- 规则与提醒：合法走子、将军、将死、困毙、将帅照面；重复局面和连续未吃子目前只提醒，不直接裁定。

### Pikafish 辅助

- 提示走法：提示棋力可独立选择，不必与当前对手难度相同。
- 实时分析：显示红方视角评估、搜索深度、主变化（PV）及分析曲线。
- 候选走法：支持 1～5 路 MultiPV、中文变化线、手动或自动刷新。
- 候选预览：在独立棋盘状态中逐手查看候选变化，不会修改真实棋局。
- 引擎参数：可设置分析工具的深度/时间上限、线程数和 Hash，并保存在本地。
- 错着复盘：逐局面评估整局，按最佳、良好、疑问、错着、严重失误分类，可跳回走棋前查看推荐着。

### 残局训练

- 内置残局库，以及自定义残局的新建、编辑、复制、删除、收藏和搜索。
- 可视化摆子与 FEN 编辑，两种方式可组合使用。
- 支持标签、训练目标、最大步数和 UCI 标准解法。
- 提供方向、棋子、完整走法三层提示，并记录本局使用过的提示等级。
- 偏离标准解法后结合当前引擎评估反馈，区分仍可继续与局面明显转差。
- 自定义残局支持 JSON 导入导出。

### 研究与复盘

- 将任意当前局面保存为研究，记录起始 FEN、走法、当前步、分析曲线、星标和备注。
- 已保存研究会延迟自动保存；由分享链接打开的回放需要手动另存。
- 研究库支持搜索、筛选、重命名、复制、批量删除和 JSON 导入导出。
- 支持自动回放、速度选择、上一/下一星标和仅显示标注走法。
- 悔棋后走新棋会保留原后续，形成变招树；可切换支线并设为主线。
- 分享链接包含起始 FEN、当前活动线和播放位置，最多接受 600 个 UCI 走法。

### 导入、导出与分享

- 导入/导出 FEN，并保存最近使用的局面。
- 复制中文棋谱和回放链接。
- 导出带模式、走棋方、局面名称和 FEN 信息的棋盘 PNG。
- 将当前局面另存为残局或研究。

## 界面结构

启动页提供五种入口：人机对弈、双人对弈、AI 对战、残局模式和研究局面。进入棋局后，主工作台由棋盘、走棋记录和工具区组成；工具区按用途分为：

- 对局：状态、常用操作、提示、回放控制和更多工具。
- 分析：实时评估、分析曲线、候选走法与引擎参数。
- 复盘：整局错着统计、进度与推荐走法。
- 变招：当前局面的主线/支线切换。

## 技术架构

```text
浏览器 React 应用
  ├─ 本地规则、棋盘、记谱、研究与训练状态
  ├─ localStorage 持久化
  └─ WebSocket 请求（requestId + FEN + UCI moves）
             │
             ▼
Node.js / Express / ws 服务
  ├─ 协议与局面校验
  ├─ 请求隔离、取消和过期结果丢弃
  └─ 串行管理共享 Pikafish 进程
             │ UCI
             ▼
engine/pikafish + engine/pikafish.nnue
```

### 前端

- React 18、TypeScript、Vite。
- Canvas 2D 棋盘；规则、FEN 与中文记谱在浏览器端完成。
- `useGame` 管理对局、分析、复盘和变招状态，`useWebSocket` 管理连接与重连。
- 候选预览与真实棋局状态隔离；异步结果通过 `requestId`、请求类型和走法快照校验。

### 后端与引擎

- Express + `ws` 提供 WebSocket 服务，通过 UCI 驱动 Pikafish。
- 所有引擎命令串行进入同一队列，防止多个搜索同时污染引擎状态。
- 支持运行时更新 Threads、Hash 和搜索限制。
- 有限搜索最长 60 秒；到达上限后发送 `stop` 并等待 5 秒获取当前最佳着。AI 对局前端另有 70 秒最终保护，断线或异常不会永久停在“思考中”。
- `stop` 按会话和请求标识处理，分析任务不会无条件取消正在进行的对局请求。

## 项目结构

```text
xiangqi/
├── client/
│   └── src/
│       ├── analysis/        # 候选预览、错着复盘
│       ├── components/      # 棋盘、工作台、残局/研究库、复盘与变招 UI
│       ├── endgames/        # 内置残局、自定义存储与导入导出
│       ├── engine/          # 棋盘、规则、FEN、记谱、重复/限着提醒
│       ├── export/          # 棋盘图片导出
│       ├── fen/             # 最近局面
│       ├── hooks/           # useGame、useWebSocket、状态流辅助
│       ├── share/           # 回放链接
│       ├── studies/         # 研究存储、导入导出与自动保存
│       ├── training/        # 残局提示和训练反馈
│       └── variations/      # 变招树
├── server/
│   └── src/
│       ├── engine.ts        # Pikafish 进程、UCI、搜索队列与超时
│       ├── index.ts         # WebSocket 会话和消息分发
│       ├── protocol.ts      # 消息解析
│       └── validation.ts    # 服务端局面校验
├── engine/                  # 本地运行文件，需手动准备且不提交
├── docs/                    # 设计说明
├── TODO.md                  # 已完成能力与后续优先级
└── pnpm-workspace.yaml
```

## 运行环境

- Node.js 18+
- pnpm 9.15.9（由根目录 `package.json#packageManager` 固定）
- 与当前系统/CPU 匹配的 Pikafish 可执行文件
- 与该 Pikafish 版本兼容的 `pikafish.nnue`

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备 Pikafish

项目运行时要求：

```text
engine/
├── pikafish          # macOS / Linux
├── pikafish.exe      # Windows 使用此文件名
└── pikafish.nnue
```

从 [Pikafish Releases](https://github.com/official-pikafish/Pikafish/releases) 获取适合本机的引擎与权重。macOS/Linux 需要保证可执行权限：

```bash
chmod +x engine/pikafish
```

这些运行文件体积较大且与平台相关，不应提交到仓库。

### 3. 启动

```bash
pnpm dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- WebSocket：ws://localhost:3001/ws

## 开发命令

```bash
pnpm dev                         # 同时启动前后端
pnpm dev:client                  # 仅启动前端
pnpm dev:server                  # 仅启动后端
pnpm test                        # 全部测试
pnpm build                       # 完整生产构建

pnpm --filter client test        # 客户端测试
pnpm --filter server test        # 服务端测试
pnpm --filter client build       # 客户端构建
pnpm --filter server build       # 服务端构建
pnpm --filter server start       # 运行已构建服务端
```

## 难度与引擎设置

### 对局棋力

| 难度 | 默认搜索深度 | 使用场景 |
| --- | ---: | --- |
| 初级 | D8 | 快速、入门 |
| 中级 | D14 | 日常对弈 |
| 高级 | D20 | 较强对手 |
| 大师 | D26 | 最高默认棋力，耗时与 CPU 占用最高 |

对局 AI 的难度深度由所选档位决定。当前没有开局库，因此大师模式第一步也会从初始局面完整搜索，在普通桌面设备上等待十几秒属于正常情况。

### 分析工具设置

分析面板中的设置主要用于提示、候选走法和实时分析：

- 候选数量：1～5 路。
- 自动刷新间隔：500～5000ms。
- 提示棋力：初级到大师。
- 搜索模式：深度 D4～D30，或固定 500～10000ms。
- 引擎线程：自动或 1～8。
- Hash：16～512MB。

线程数决定可并行利用的 CPU 资源；Hash 保存搜索缓存。提高它们可能加快搜索或让同一时间内搜索更充分，但不会改变 NNUE 权重本身，也不是无限提升棋力。

## WebSocket 协议概览

客户端消息：

- `init`：设置对局难度、Threads 和 Hash。
- `move` / `hint`：请求对局着法或提示。
- `candidates`：请求 MultiPV 候选。
- `analyze`：启动当前局面分析。
- `review`：逐局面生成整局复盘，最多 120 个走法。
- `stop`：取消指定请求或当前会话任务。

服务端消息：

- `engine-status`：引擎可用状态。
- `bestmove`：最优着、耗时、请求类型，以及是否触及 60 秒上限。
- `info`：深度、分数、节点数与 PV。
- `candidates`：候选着列表。
- `review-progress` / `review-result`：复盘进度与结果。
- `error`：校验或引擎错误。

协议定义和校验分别位于 `client/src/types.ts`、`server/src/protocol.ts` 和 `server/src/validation.ts`。

## 本地数据

目前没有账号或云端数据库，以下内容保存在浏览器 `localStorage`：

| 内容 | Key |
| --- | --- |
| 自定义残局 | `xiangqi.custom-endgames.v1` |
| 残局收藏 | `xiangqi.favorite-endgames.v1` |
| 研究局面与变招树 | `xiangqi.study-positions.v1` |
| 最近 FEN | `xiangqi_recent_fens` |
| 引擎设置 | `xiangqi_engine_settings` |

清除浏览器站点数据会删除这些内容。重要的残局和研究请先导出 JSON 备份；分享回放只包含当前活动线，不等同于完整研究备份。

## 常见问题

### AI 不可用

检查：

1. `engine/` 下是否同时存在可执行文件和 `pikafish.nnue`。
2. macOS/Linux 可执行权限是否正确。
3. 后端是否监听 3001，浏览器是否连接 `ws://localhost:3001/ws`。
4. 后端终端是否出现 NNUE 不兼容、权限或进程启动错误。

### 大师第一步为什么需要十几秒

大师档使用 D26，且项目当前没有开局库，第一步同样需要完整搜索。CPU 在搜索期间明显升高、返回着法后下降是正常现象。若超过服务端上限，会采用 `stop` 后返回的当前最佳着；若引擎失去响应，页面会结束思考状态并显示错误。

### 调整分析深度为什么没有改变对局 AI

“分析工具上限”控制提示、候选和实时分析；人机/AI 对战仍使用所选难度档位。二者刻意分开，避免为了查看轻量分析而意外降低对手棋力。

### 修改 Threads 或 Hash 后为什么分析会重启

Pikafish 需要先停止当前搜索、应用 UCI 选项并等待 `readyok`，随后客户端才会对当前局面重新发起分析。这是正常的配置切换流程。

### 页面一直显示 AI 思考中

最新版会在连接断开、引擎报错或最终超时时清理等待状态。若仍出现：保存复现局面的 FEN，记录模式、执方、难度和后端日志，并按 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 中的 Issue 建议提交。

### 构建后运行服务端

```bash
pnpm --filter server build
pnpm --filter server start
```

前端生产文件位于 `client/dist/`，项目当前未内置统一生产部署脚本。

## 当前边界与后续方向

- 严格长将/长捉裁定尚未实现，重复局面与自然限着只做提醒。
- 分享功能是 URL 内嵌回放，不包含云端短链、权限或完整变招树。
- 研究分析仍以活动线的步索引保存，尚未绑定到每个变招节点。
- 当前没有开局库、账号、云同步和在线房间。

完整优先级见 [`TODO.md`](./TODO.md)，变招树的数据模型与迁移说明见 [`docs/variation-tree-design.md`](./docs/variation-tree-design.md)。

## 贡献

开发流程、分支和提交约定见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。提交前至少运行：

```bash
pnpm test
pnpm build
git diff --check
```

提交信息采用 `<type>: <summary>`，例如：

- `feat: 新增残局导入导出`
- `fix: 修复 AI 搜索超时后卡住`
- `docs: 同步项目功能说明`

## 许可证

本项目采用 GPL-3.0，详见 [`LICENSE`](./LICENSE)。Pikafish 同样遵循 GPL-3.0；复制或分发引擎及其衍生程序时，请遵守相应许可证要求。
