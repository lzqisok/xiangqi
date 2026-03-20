# 中国象棋

一个基于 [Pikafish](https://github.com/official-pikafish/Pikafish) 引擎的现代化 Web 中国象棋项目，提供人机对弈、双人对弈、AI 对战 AI、提示走法、引擎分析等功能。

## 功能特性

- 人机对弈：支持 `初级 / 中级 / 高级 / 大师` 四档强度，可选择执红或执黑
- 双人对弈：同屏本地双人模式
- AI 对战：开局前分别设置红方和黑方强度，开局后手动点击“下一步”推进
- 提示走法：使用大师级引擎给出当前局面的下一步建议
- 思考耗时：AI 每一步的思考时间会显示在走棋记录中
- 中文记谱：自动生成中文走棋记录，如 `炮二平五`、`馬8进7`
- 完整规则：包含蹩马脚、塞象眼、将帅对面、炮打隔子等规则校验
- 引擎分析：支持查看局面评估分数、PV 和搜索深度
- 悔棋 / 重做：支持在已有历史上前后回退
- FEN 导入导出：支持保存和恢复任意局面
- 棋盘翻转：便于切换观察视角
- 音效反馈：落子、吃子、将军、终局均有反馈

## 技术栈

- 前端：React 18 + TypeScript + Vite
- 后端：Node.js + Express + WebSocket
- 引擎：Pikafish（UCI 协议）
- 渲染：Canvas 棋盘绘制

## 项目结构

```text
xiangqi/
├── client/                  # React 前端
│   └── src/
│       ├── components/      # Board、GamePanel、MoveHistory、AnalysisBar
│       ├── engine/          # 棋盘、规则、记谱相关逻辑
│       ├── hooks/           # useGame、useWebSocket
│       ├── App.tsx          # 开局页与主界面
│       └── types.ts         # 前后端共享消息与数据结构
├── server/                  # Node.js 后端
│   └── src/
│       ├── engine.ts        # Pikafish 进程管理与搜索封装
│       └── index.ts         # WebSocket 消息分发
├── engine/                  # Pikafish 二进制与 NNUE 权重（不提交）
├── package.json             # 根脚本
└── README.md
```

## 环境要求

- Node.js 18+
- pnpm
- Pikafish 可执行文件
- Pikafish NNUE 权重文件

## 三平台快速启动

| 平台 | Node / pnpm | 引擎文件 | 额外步骤 | 启动命令 |
| --- | --- | --- | --- | --- |
| Windows | 安装 Node.js 18+ 与 pnpm | `engine/pikafish.exe` + `engine/pikafish.nnue` | 如被 Defender 拦截，手动允许可执行文件 | `pnpm install`<br>`pnpm dev` |
| macOS | 安装 Node.js 18+ 与 pnpm | `engine/pikafish` + `engine/pikafish.nnue` | 首次使用建议执行 `codesign --force --sign - engine/pikafish` | `pnpm install`<br>`pnpm dev` |
| Linux | 安装 Node.js 18+ 与 pnpm | `engine/pikafish` + `engine/pikafish.nnue` | 确保二进制有执行权限：`chmod +x engine/pikafish` | `pnpm install`<br>`pnpm dev` |

启动后默认访问：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`
- WebSocket：`ws://localhost:3001/ws`

## 安装依赖

```bash
pnpm install
```

## 准备 Pikafish 引擎

需要在项目根目录下的 `engine/` 中准备：

- `engine/pikafish`（或 Windows 下的 `pikafish.exe`）
- `engine/pikafish.nnue`

示例（macOS / Linux）：

```bash
git clone --depth 1 https://github.com/official-pikafish/Pikafish.git /tmp/pikafish
cd /tmp/pikafish/src
make -j ARCH=apple-silicon build

cp pikafish pikafish.nnue /path/to/xiangqi/engine/
codesign --force --sign - /path/to/xiangqi/engine/pikafish
```

如果是 Intel / AMD 机器，请将构建参数替换为合适的架构，例如：

```bash
make -j ARCH=x86-64-bmi2 build
```

### Windows

Windows 下更推荐直接使用 Pikafish 官方发布的预编译文件，而不是本地 `make build`。

准备方式：

1. 从 Pikafish Releases 下载 Windows 可执行文件
2. 下载对应的 `pikafish.nnue` 权重文件
3. 将它们放到项目根目录下的 `engine/` 中

目录结构示例：

```text
engine/
├── pikafish.exe
└── pikafish.nnue
```

准备完成后直接执行：

```bash
pnpm install
pnpm dev
```

注意事项：

- Windows 不需要执行 `codesign`
- 后端会自动优先查找 `engine/pikafish.exe`
- 如果首次运行被 Windows Defender 拦截，需要手动允许该可执行文件
- 建议将项目放在不含空格和中文的路径下，例如 `C:\\code\\xiangqi`

## 启动开发环境

```bash
# 同时启动前后端
pnpm dev

# 或分别启动
pnpm dev:server
pnpm dev:client
```

启动后访问：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`
- WebSocket：`ws://localhost:3001/ws`

## 构建

```bash
pnpm build
```

## 当前引擎配置说明

当前代码中的引擎参数如下（以 `server/src/engine.ts` 为准）：

- `easy`: 深度 8
- `medium`: 深度 14
- `hard`: 深度 20
- `master`: 深度 26
- 线程数：自动按 CPU 核心数设置，上限 8
- Hash：128 MB

这套配置在棋力和响应速度之间做了折中，适合日常本地对弈体验。

## 典型使用方式

### 人机对弈

1. 选择“人机对弈”
2. 选择强度与执方
3. 开局后正常下棋，可使用“提示”查看大师级建议走法

### AI 对战

1. 选择“AI 对战”
2. 分别设置红方和黑方强度
3. 开局后点击“下一步”推动双方逐手对弈

### 局面研究

1. 使用 FEN 导入进入指定局面
2. 打开“引擎分析”
3. 查看评估分数、最优变化和深度信息

## 注意事项

- `engine/` 目录中的引擎二进制和权重文件默认不会提交到仓库
- `client/dist/`、`server/dist/`、`node_modules/` 等构建和依赖目录也不会提交
- 如果引擎不可用，前端仍可进入本地规则模式，但无法使用 AI 与提示功能

## 许可证

- 本项目代码仅供学习与个人使用
- Pikafish 引擎遵循 GPL-3.0 许可证，请在分发时遵循其许可证要求
