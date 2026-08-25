# 棋境：象棋与五子棋（Web）

一个以本地 [Pikafish](https://github.com/official-pikafish/Pikafish) 为象棋棋力核心的 Web 棋类应用，覆盖普通象棋、揭棋、残局训练、错着训练、局面研究、变招管理与整局复盘，并提供完全独立的本地五子棋模块。前端使用 React + Canvas，象棋后端通过 WebSocket 和 UCI 协议管理本地 Pikafish 进程；实时象棋对局保存在服务端本地 JSON 文件，研究与训练数据保存在浏览器本地。

![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-9.15.9-F69220?logo=pnpm&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=1f2937)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-GPL--3.0-blue)

## 功能概览

### 五子棋

- 从统一首页的五子棋入口进入；本地规则、AI 状态和 Rapfi 会话与象棋隔离，在线模式复用经过版本校验的房间、聊天及持久化基础设施。
- 15×15 Canvas 棋盘，支持本地双人、人机及 AI 对战，可选择执黑/执白，并提供简单、中等、高等、大师四档 AI。
- 支持自由规则及仅约束黑方的长连、四四、三三禁手规则。
- 人机对战优先通过独立 `/gomoku-ws` 会话调用 Rapfi，服务不可用时自动切换至浏览器内置 AI；复盘分析继续在独立 Web Worker 中运行。
- Rapfi 自由规则与有禁手模式分别使用 freestyle、Renju 规则，支持悔棋、重开及局后复盘与推荐着法。

### 局域网对战与观战

执行 `pnpm lan` 会先构建项目，再由后端在 `0.0.0.0:3001` 通过单一端口提供前端、API 和 WebSocket。终端会打印可供同一局域网其他设备打开的大厅地址；macOS 首次运行时需要允许 Node.js 接收入站连接。

开发时执行 `pnpm dev`，Vite 同样会监听局域网网卡，可通过终端打印的 `Network` 地址（默认端口 `5173`）访问。即使房主从 `localhost` 打开页面，邀请与席位恢复链接也会自动换成本机优先物理网卡的 IPv4 地址；存在多块网卡时请确认链接使用的是双方可达的网段。

- 支持普通象棋和揭棋房间，双方准备后自动开局，其他设备可从公开大厅观战。
- 玩家邀请链接可直接选择空席；大厅观众申请落座需要房主批准，房主可移除棋手、重新生成邀请或解散等待房间。
- 棋手可复制席位恢复链接并在其他设备接管席位；房主恢复链接还包含房间管理权限，均请勿转发给无关人员。
- 双方每局各有 3 次固定大师提示；普通象棋可协商悔棋，揭棋禁止悔棋；换边、悔棋和议和申请 60 秒后自动失效，也可主动撤回。
- 服务端每 15 秒检查 WebSocket 心跳；单方掉线且另一方在线时，60 秒未重连判负，房主不是棋手时离线不影响对局。
- 揭棋完整暗子身份只保存在服务端，暗吃身份仅发送给捕获方。
- 大厅展示活跃房间和最近结束对局，联机棋谱使用中文记谱；观众可切换红黑视角。
- 房主、棋手和观众可在房间内聊天；消息独立持久化并保留最近 100 条，房主可删除消息、按成员或全员禁言，并设置房间敏感词。
- 无人在线的等待房间和双方离线的进行中房间保留 24 小时，结束对局保留 30 天，之后自动清理本地 JSON。
- LAN 模式仅适合可信内网，请勿配置公网端口映射；本机原有对局库仅允许通过回环地址访问。

### 对弈

- 人机对弈：可执红先手或执黑后手，提供初级 D8、中级 D14、高级 D20、大师 D26 四档棋力。
- 双人对弈：本地同屏轮流走棋，支持手动和棋与认输。
- AI 对战：红黑双方独立设置难度，可单步推进，也可按快速、标准、慢速自动播放。
- 完整对局操作：悔棋、重做、棋盘翻转、中文记谱、落子/吃子/将军/终局音效。
- 每局实时对局拥有独立 URL，刷新或在新标签页打开可恢复；启动页可管理、导入和导出最近对局。
- 规则与裁定：合法走子、将军、将死、困毙、将帅照面；实时普通对局采用三次同局面、连续 60 回合未吃子及 300 回合安全上限的简化自动和棋规则。

### 揭棋

- 独立的人机揭棋入口：除将帅外，每方 15 枚棋子随机打乱并盖棋，支持执红或执黑及四档难度。
- 暗子按初始位置对应的棋种行走，移动后翻开真实身份；翻开后的仕、相可离开九宫或过河。
- 暗子未翻开前不构成将军；暗吃身份仅捕获方知晓，发送给 AI 的历史会隔离人类私有信息。
- 棋盘下方分别展示双方已吃棋子；明子身份公开，暗吃只向捕获方显示真实棋种。
- 使用官方 Pikafish `jieqi_old` 分支作为独立揭棋引擎，通过扩展 FEN 和 4～6 位 UCI 走法传递翻子信息。
- 普通象棋和揭棋使用两套独立可执行文件；每个 WebSocket 会话按需持有自己的变体引擎，标签页之间不会互相停止搜索。
- 为避免历史快照和分析变化泄露暗子身份，揭棋模式暂不开放悔棋、重做、历史跳转、候选、实时分析、变招与整局复盘。

### Pikafish 辅助

- 提示走法：提示棋力可独立选择，不必与当前对手难度相同。
- 实时分析：显示红方视角评估、搜索深度、主变化（PV）及分析曲线。
- 候选走法：支持 1～5 路 MultiPV、中文变化线、手动或自动刷新。
- 候选预览：在独立棋盘状态中逐手查看候选变化，不会修改真实棋局。
- 引擎参数：可设置分析工具的深度/时间上限、线程数和 Hash，并保存在本地。
- 错着复盘：逐局面评估整局，按最佳、良好、疑问、错着、严重失误分类，可跳回走棋前查看推荐着，并把错着或严重失误加入训练。

### 错着训练

- 训练题保存走棋前局面、实战着、推荐着以及来源对局或研究节点；同一来源节点重复加入时更新题目而不重复创建。
- 队列支持未练、待复习、已掌握筛选，记录尝试次数、最近结果和练习时间，并提供批量删除与 JSON 备份。
- 答题前默认隐藏答案，可按需依次查看方向、候选棋子和推荐变化；走出推荐着或评估损失在阈值内即通过。
- 引擎不可用时自动退化为推荐着精确匹配，本地训练不会被阻塞；有来源引用的题目可返回原节点继续查看分支、备注、标注和评估。

### 残局训练

- 内置残局库，以及自定义残局的新建、编辑、复制、删除、收藏和搜索。
- 可视化摆子与 FEN 编辑，两种方式可组合使用。
- 支持标签、训练目标、最大步数和 UCI 标准解法。
- 提供方向、棋子、完整走法三层提示，并记录本局使用过的提示等级。
- 偏离标准解法后结合当前引擎评估反馈，区分仍可继续与局面明显转差。
- 自定义残局支持 JSON 导入导出。

### 研究与复盘

- 将任意当前局面保存为研究，记录起始 FEN、走法、当前步、分析曲线、星标和备注。
- 分析评估绑定到变招节点：每条变招拥有独立评估、深度、最佳着和 PV，切换分支时曲线自动对应各自节点；同配置的已有分析在切回时直接恢复显示。
- 已保存研究会延迟自动保存；由分享链接打开的回放需要手动另存。
- 研究库支持搜索、筛选、重命名、复制、批量删除和 JSON 导入导出。
- 支持自动回放、速度选择、上一/下一星标和仅显示标注走法。
- 悔棋后走新棋会保留原后续，形成变招树；可切换支线并设为主线。
- 分享链接 v2 包含起始 FEN、完整变招树、当前节点、名称说明、节点标注与分析；最多 300 个节点和 120KB 原始载荷，旧版线性链接继续兼容。
- 内置可审阅的小型开局名称目录，按合法重放后的局面命中中炮、屏风马、顺炮、列炮、反宫马、飞相局、仙人指路等常见入口，并可直接保存为开局研究。

### 导入、导出与分享

- 导入/导出 FEN，并保存最近使用的局面。
- 普通象棋对局支持线性 ICCS PGN 导入导出，保留起始 FEN 与结果；导入时逐手校验合法性，首版不接受变例分支，也不与揭棋记录混用。
- 复制中文棋谱和完整变招回放链接。
- 导出带模式、走棋方、局面名称和 FEN 信息的棋盘 PNG。
- 将当前局面另存为残局或研究。

## 界面结构

统一首页提供“中国象棋”和“五子棋”两个入口，进入后分别选择本地或在线模式；本地象棋内再提供人机对弈、双人对弈、AI 对战、揭棋、残局模式和研究局面。进入象棋棋局后，主工作台由棋盘、走棋记录和工具区组成；工具区按用途分为：

- 对局：状态、常用操作、提示、回放控制和更多工具。
- 分析：实时评估、分析曲线、候选走法与引擎参数。
- 复盘：整局错着统计、进度与推荐走法。
- 变招：当前局面的主线/支线切换。

## 技术架构

```text
浏览器 React 应用
  ├─ 本地规则、棋盘、记谱、研究与训练状态
  ├─ HTTP 对局读取、自动保存与 JSON 导入导出
  ├─ /ws：象棋引擎计算 + 单写者编辑租约
  └─ /gomoku-ws：五子棋 Rapfi 计算
             │
             ▼
Node.js / Express / ws 服务
  ├─ 协议与局面校验
  ├─ data/games/index.json 轻量索引
  ├─ data/games/<id>.json 单局原子持久化与备份恢复
  ├─ 请求隔离、取消和过期结果丢弃
  ├─ 象棋会话按变体独立管理 Pikafish 进程（UCI）
  └─ 五子棋会话独立管理 Rapfi 进程（Piskvork）
             │
             ├─ engine/pikafish / engine/pikafish-jieqi + pikafish.nnue
             └─ engine/rapfi + config.toml + Rapfi 权重
```

### 前端

- React 18、TypeScript、Vite。
- Canvas 2D 棋盘；规则、FEN 与中文记谱在浏览器端完成。
- `useGame` 管理对局、分析、复盘和变招状态，`useWebSocket` 管理连接与重连。
- 候选预览与真实棋局状态隔离；异步结果通过 `requestId`、请求类型和走法快照校验。

### 后端与引擎

- Express + `ws` 提供 WebSocket 服务，通过 UCI 驱动 Pikafish。
- 普通象棋与揭棋按协议中的 `variant` 选择对应引擎；每个 WebSocket 会话按需创建独立实例，实例内命令串行执行，避免跨标签页中断和搜索状态污染。
- 五子棋使用独立 `/gomoku-ws` 协议及 Rapfi 进程，通过 Piskvork `BOARD` 命令传递完整局面；不会复用或中断象棋 `/ws` 下的 Pikafish 实例。
- Rapfi 简单、中等、高等、大师档默认每步最多分别计算 300ms、1000ms、5000ms、10000ms，并分别使用最多 2、4、6、8 个线程；每个会话内存上限为 256MB。
- 支持运行时更新 Threads、Hash 和搜索限制。
- 有限搜索最长 60 秒；到达上限后发送 `stop` 并等待 5 秒获取当前最佳着。AI 对局前端另有 70 秒最终保护，断线或异常不会永久停在“思考中”。
- `stop` 按会话和请求标识处理，分析任务不会无条件取消正在进行的对局请求。

### 对局持久化

- 人机、双人、AI 对战和揭棋分别保存到 `data/games/<id>.json`，`data/games/index.json` 仅保存列表摘要；更新一盘棋不会重写其他对局。
- 单局写入采用紧凑 JSON 和临时文件替换，并在对应的 `<id>.json.bak` 保留该局上一份有效数据。
- 持久化只保存一份紧凑变招树。普通棋局不再重复保存主线，揭棋只保存 30 枚暗子的初始身份和 UCI 走棋，加载时重放生成棋盘快照。
- URL 使用 `?game=<id>` 定位对局。相同对局同时打开时只有一个标签页可编辑，其余标签页只读，也可主动接管编辑权。
- 每次更新携带 revision，版本不一致会拒绝覆盖；存储不可用时可由用户明确选择开始不持久化的临时对局。
- 揭棋恢复所需的暗子布局属于本机裁判态私密数据。`/api/games` 同时校验回环来源、原始 Host，以及由开发代理覆盖写入的原始客户端地址；即使开发服务器监听局域网网卡，也不会向局域网访客开放本机对局库。
- 启动页的普通对局 JSON 导入导出会排除揭棋裁判态；揭棋回放使用独立的公开/本人席位投影格式。可用 `XIANGQI_DATA_DIR` 修改数据目录，或用 `HOST` 修改监听地址。

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
│       ├── gomoku/          # 独立五子棋规则、AI Worker、状态与页面
│       ├── hooks/           # useGame、useWebSocket、状态流辅助
│       ├── share/           # 回放链接
│       ├── studies/         # 研究存储、导入导出与自动保存
│       ├── training/        # 残局提示和训练反馈
│       └── variations/      # 变招树
├── server/
│   └── src/
│       ├── engine.ts        # Pikafish 进程、UCI、搜索队列与超时
│       ├── gomoku/          # Rapfi 进程、Piskvork 协议与独立 WebSocket
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
- 使用揭棋时还需要官方 `jieqi_old` 分支编译出的 `pikafish-jieqi`
- 使用 Rapfi 五子棋 AI 时还需要对应平台的 Rapfi 可执行文件、配置和权重；缺失时页面会自动使用内置 AI

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备引擎

#### Pikafish

项目运行时要求：

```text
engine/
├── pikafish          # macOS / Linux
├── pikafish-jieqi    # 揭棋模式；Windows 对应 pikafish-jieqi.exe
├── pikafish.exe      # Windows 使用此文件名
└── pikafish.nnue
```

从 [Pikafish Releases](https://github.com/official-pikafish/Pikafish/releases) 获取适合本机的引擎与权重。macOS/Linux 需要保证可执行权限：

```bash
chmod +x engine/pikafish
chmod +x engine/pikafish-jieqi
```

这些运行文件体积较大且与平台相关，不应提交到仓库。

揭棋引擎需从官方 [`jieqi_old` 分支](https://github.com/official-pikafish/Pikafish/tree/jieqi_old) 编译。该分支与项目当前权重格式兼容，macOS Apple Silicon 示例：

```bash
git clone --depth 1 --branch jieqi_old https://github.com/official-pikafish/Pikafish.git /tmp/pikafish-jieqi
cp engine/pikafish.nnue /tmp/pikafish-jieqi/src/pikafish.nnue
make -C /tmp/pikafish-jieqi/src -j4 build ARCH=apple-silicon
cp /tmp/pikafish-jieqi/src/PikaJieQi engine/pikafish-jieqi
chmod +x engine/pikafish-jieqi
```

Linux 请通过 `make -C /tmp/pikafish-jieqi/src help` 选择对应 `ARCH`；Windows 则将产物命名为 `engine/pikafish-jieqi.exe`。不要直接给该旧分支搭配滚动更新的最新 NNUE，架构不一致时引擎会拒绝启动。

#### Rapfi

从 [Rapfi Releases](https://github.com/dhbloo/rapfi/releases) 下载官方引擎包，并从 [Rapfi Networks](https://github.com/dhbloo/rapfi-networks) 获取或核对配置与权重。将适合当前平台的可执行文件改名为 `rapfi`（Windows 为 `rapfi.exe`），和以下运行文件放在同一目录：

```text
engine/
├── rapfi
├── config.toml
├── model210901.bin
├── mix9svqfreestyle_bsmix.bin.lz4
├── mix9svqstandard_bs15.bin.lz4
├── mix9svqrenju_bs15_black.bin.lz4
└── mix9svqrenju_bs15_white.bin.lz4
```

macOS Apple Silicon 对应官方包内的 `pbrain-rapfi-macos-apple-silicon`；macOS/Linux 还需执行 `chmod +x engine/rapfi`。这些平台相关的大体积文件已加入 `.gitignore`，不应提交到仓库。若引擎放在其他目录，可设置 `RAPFI_PATH=/absolute/path/to/rapfi`，配置与权重仍须和可执行文件放在一起。

### 3. 启动

```bash
pnpm dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 象棋 WebSocket：ws://localhost:3001/ws
- 五子棋 Rapfi WebSocket：ws://localhost:3001/gomoku-ws

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

| 难度 | 默认搜索深度 | 使用场景                          |
| ---- | -----------: | --------------------------------- |
| 初级 |           D8 | 快速、入门                        |
| 中级 |          D14 | 日常对弈                          |
| 高级 |          D20 | 较强对手                          |
| 大师 |          D26 | 最高默认棋力，耗时与 CPU 占用最高 |

对局 AI 的难度深度由所选档位决定。当前没有供引擎直接走棋的统计开局库；内置开局名称目录只做局面识别，不向 Pikafish 提供着法。因此大师模式第一步仍会从初始局面完整搜索，在普通桌面设备上等待十几秒属于正常情况。

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

- `init`：设置对局难度、Threads、Hash 和引擎变体。
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

揭棋请求使用 `variant: "jieqi"`。扩展 UCI 走法的前四位仍是起止坐标，第五位可表示移动暗子翻开的身份或被暗吃棋子的身份，第六位用于二者同时发生；服务端仅将捕获方有权知道的身份传给对应 AI。

## 本地数据

目前没有账号或云端数据库，以下内容保存在浏览器 `localStorage`：

| 内容             | Key                            |
| ---------------- | ------------------------------ |
| 自定义残局       | `xiangqi.custom-endgames.v1`   |
| 残局收藏         | `xiangqi.favorite-endgames.v1` |
| 研究局面与变招树 | `xiangqi.study-positions.v1`   |
| 最近 FEN         | `xiangqi_recent_fens`          |
| 引擎设置         | `xiangqi_engine_settings`      |

清除浏览器站点数据会删除这些内容。重要的残局和研究请先导出 JSON 备份；回放链接 v2 可携带当前研究的完整变招树，但受 300 节点和 120KB 原始载荷限制，也不等同于研究库 JSON 备份。

## 常见问题

### AI 不可用

检查：

1. `engine/` 下是否同时存在可执行文件和 `pikafish.nnue`。
2. macOS/Linux 可执行权限是否正确。
3. 后端是否监听 3001，浏览器是否连接 `ws://localhost:3001/ws`。
4. 后端终端是否出现 NNUE 不兼容、权限或进程启动错误。

揭棋单独检查 `engine/pikafish-jieqi`（Windows 为 `.exe`）；普通引擎可用不代表揭棋引擎已经准备完成。

五子棋单独检查 `engine/rapfi`、`config.toml` 和 Rapfi 权重。Rapfi 缺失、启动失败或返回异常时，人机对战会自动切换至浏览器内置 AI，不会影响象棋功能。

### 大师第一步为什么需要十几秒

大师档使用 D26。项目内置的开局名称目录不参与引擎走棋，当前也没有供 Pikafish 直接命中的统计开局库，因此第一步同样需要完整搜索。CPU 在搜索期间明显升高、返回着法后下降是正常现象。若超过服务端上限，会采用 `stop` 后返回的当前最佳着；若引擎失去响应，页面会结束思考状态并显示错误。

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

- 普通象棋的三次重复局面会按长将、长捉、将捉交替和双方责任自动裁定；普通重复作和，单方禁止着法判责任方负。揭棋继续使用独立规则，不进入该裁定器。
- 分享功能采用 URL 内嵌的完整变招树回放 v2，暂不提供云端短链、封面、访问权限或过期失效。
- 研究分析和复盘结果已绑定到变招节点；支持分析当前节点/分支、停止与同配置缓存复用，并可只读比较两条分支的胜率、分值、推荐变化和主要分歧。
- 当前有小型开局名称目录，但没有供引擎走棋的大型统计开局库、账号、云同步和公网房间。

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

本项目采用 GPL-3.0，详见 [`LICENSE`](./LICENSE)。Pikafish 与 Rapfi 同样遵循 GPL-3.0；复制或分发引擎及其衍生程序时，请遵守相应许可证要求。Rapfi 官方权重仓库中的权重文件采用 CC0。
