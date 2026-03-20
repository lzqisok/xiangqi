# 中国象棋（Web + Pikafish）

一个基于 [Pikafish](https://github.com/official-pikafish/Pikafish) 引擎的现代化 Web 中国象棋项目。  
目标是同时覆盖「对弈体验」「残局训练」「局面研究」三类使用场景，提供清晰的 UI 与可扩展的工程结构。

> 如果你准备开源这个项目，建议将仓库名、许可证、截图路径替换为你的实际值。

![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=1f2937)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-GPL--3.0-blue)

---

## 目录

- [效果展示](#效果展示)
- [项目亮点](#项目亮点)
- [功能总览](#功能总览)
- [技术架构](#技术架构)
- [项目结构](#项目结构)
- [运行环境与依赖](#运行环境与依赖)
- [快速开始（3 分钟）](#快速开始3-分钟)
- [引擎准备说明](#引擎准备说明)
- [开发脚本](#开发脚本)
- [玩法说明](#玩法说明)
- [残局模式说明](#残局模式说明)
- [局面表示与通信协议](#局面表示与通信协议)
- [引擎参数与性能建议](#引擎参数与性能建议)
- [常见问题（FAQ）](#常见问题faq)
- [Roadmap](#roadmap)
- [贡献指南](#贡献指南)
- [开发建议与扩展方向](#开发建议与扩展方向)
- [许可证](#许可证)

---

## 效果展示

> 你可以把下面路径替换为真实截图或 GIF，GitHub 首页展示效果会更好。

- 启动页（模式选择）：`docs/screenshots/start.png`
- 对弈主界面（棋盘 + 记录 + 面板）：`docs/screenshots/game.png`
- 残局库与编辑器：`docs/screenshots/endgame.png`
- 引擎分析与提示：`docs/screenshots/analysis.png`

示例写法：

```md
![启动页](docs/screenshots/start.png)
![主界面](docs/screenshots/game.png)
```

---

## 项目亮点

- 多模式：`人机对弈 / 双人对弈 / AI 对战 / 残局模式`
- 可研究：支持提示、引擎分析、FEN 导入导出、悔棋重做
- 可训练：内置残局 + 自定义残局（新建、编辑、复制、收藏）
- 规则完整：覆盖中国象棋核心走子规则与将军判定
- 体验统一：Canvas 棋盘渲染、中文记谱、音效反馈

---

## 功能总览

### 对弈功能

- **人机对弈**
  - 四档难度：`easy / medium / hard / master`
  - 支持执红先手或执黑后手
- **双人对弈**
  - 同屏本地双人
- **AI 对战**
  - 红黑双方可单独配置难度
  - 采用“下一步”手动推进，便于观战和学习

### 辅助能力

- **提示走法**：请求大师级引擎给出建议
- **引擎分析**：显示评估分、主变化（PV）和搜索深度
- **走棋记录**：中文记谱，记录 AI 思考耗时
- **悔棋 / 重做**：支持历史回退与前进
- **FEN 导入导出**：保存与恢复任意局面
- **棋盘翻转**：切换观察视角
- **音效反馈**：落子、吃子、将军、终局

### 残局能力

- 内置残局库
- 自定义残局编辑器（可视化摆子 + FEN 编辑）
- 残局收藏、搜索、筛选、复制
- 支持“另存残局”

---

## 技术架构

### 前端（`client`）

- React 18 + TypeScript + Vite
- Canvas 2D 绘制棋盘与棋子
- `useGame` 负责核心对局状态流转
- `useWebSocket` 负责与后端实时通信

### 后端（`server`）

- Node.js + Express + WebSocket (`ws`)
- 通过 UCI 协议管理 Pikafish 子进程
- 统一处理 `move / hint / analyze / stop` 消息

### 引擎层（`engine/` 目录）

- Pikafish 可执行文件
- NNUE 权重文件 `pikafish.nnue`

---

## 项目结构

```text
xiangqi/
├── client/                         # React 前端
│   ├── src/
│   │   ├── components/             # Board / GamePanel / MoveHistory / AnalysisBar / Endgame*
│   │   ├── engine/                 # board.ts / rules.ts / notation.ts
│   │   ├── endgames/               # 内置残局与本地存储
│   │   ├── hooks/                  # useGame / useWebSocket
│   │   ├── App.tsx                 # 启动页 + 主流程编排
│   │   ├── types.ts                # 核心类型与 WS 消息类型
│   │   └── index.css               # 全局样式
│   └── package.json
├── server/                         # Node 后端
│   ├── src/
│   │   ├── engine.ts               # Pikafish 进程封装
│   │   └── index.ts                # WebSocket 消息分发
│   └── package.json
├── engine/                         # 引擎二进制与权重（需手动准备）
├── package.json                    # monorepo 根脚本
├── pnpm-workspace.yaml
└── README.md
```

---

## 运行环境与依赖

- Node.js `18+`
- pnpm
- Pikafish 可执行文件（不同平台名称不同）
- Pikafish NNUE 权重文件

---

## 快速开始（3 分钟）

### 1) 安装依赖

```bash
pnpm install
```

### 2) 准备引擎文件

在项目根目录创建并放置：

- macOS/Linux：`engine/pikafish`
- Windows：`engine/pikafish.exe`
- 通用权重：`engine/pikafish.nnue`

### 3) 启动项目

```bash
pnpm dev
```

启动后地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`
- WebSocket：`ws://localhost:3001/ws`

---

## 引擎准备说明

### 目录要求

```text
engine/
├── pikafish        # 或 pikafish.exe
└── pikafish.nnue
```

### macOS / Linux（示例）

```bash
git clone --depth 1 https://github.com/official-pikafish/Pikafish.git /tmp/pikafish
cd /tmp/pikafish/src
make -j ARCH=apple-silicon build

cp pikafish pikafish.nnue /path/to/xiangqi/engine/
chmod +x /path/to/xiangqi/engine/pikafish
codesign --force --sign - /path/to/xiangqi/engine/pikafish  # macOS 可选但推荐
```

Intel/AMD 可按机器改为如 `ARCH=x86-64-bmi2`。

### Windows

建议直接使用官方 release 预编译版本：

1. 下载 `pikafish.exe`
2. 下载 `pikafish.nnue`
3. 放到项目根目录 `engine/`

注意：

- 可能被 Defender 拦截，需手动允许
- 建议项目路径尽量简洁（如 `C:\code\xiangqi`）

---

## 开发脚本

根目录可用脚本：

```bash
pnpm dev          # 并行启动 client + server
pnpm dev:client   # 仅前端
pnpm dev:server   # 仅后端
pnpm build        # 构建 client + server
```

子包脚本：

- `client`
  - `pnpm --filter client dev`
  - `pnpm --filter client build`
  - `pnpm --filter client preview`
- `server`
  - `pnpm --filter server dev`
  - `pnpm --filter server build`
  - `pnpm --filter server start`

---

## 玩法说明

### 人机对弈

1. 选择“人机对弈”
2. 选择难度与执方（红/黑）
3. 对弈过程中可使用提示、悔棋、导入导出 FEN

### 双人对弈

1. 选择“双人对弈”
2. 同屏轮流走棋

### AI 对战

1. 选择“AI 对战”
2. 分别设置红/黑难度
3. 点击“下一步”推进

---

## 残局模式说明

残局模式流程：

1. 进入残局库
2. 选择内置残局或创建自定义残局
3. 配置红黑双方（人类/AI + 难度）
4. 开始残局

支持能力：

- 搜索/筛选：全部、内置、自定义、收藏
- 自定义编辑：名称、描述、FEN、可视化摆子
- 维护操作：新建、编辑、复制、删除、收藏
- 快速沉淀：对局中局面可“另存残局”

数据持久化：

- 自定义残局：`xiangqi.custom-endgames.v1`
- 收藏列表：`xiangqi.favorite-endgames.v1`

---

## 局面表示与通信协议

### FEN

- 使用标准象棋 FEN（含走棋方）
- 前端支持导入/导出
- 后端按请求局面 + 历史 `moves` 构建引擎位置

### WebSocket 消息

常见消息类型：

- `init`：初始化难度
- `move`：请求 AI 走子
- `hint`：请求提示
- `analyze` / `stop`：分析开关
- `bestmove`：返回最优着
- `info`：分析信息流
- `error`：错误反馈

---

## 引擎参数与性能建议

当前默认（`server/src/engine.ts`）：

- 深度：
  - `easy`: 8
  - `medium`: 14
  - `hard`: 20
  - `master`: 26
- 线程数：自动检测 CPU，并限制在 `1~8`
- Hash：`128MB`

建议：

- 低功耗设备优先 `easy/medium`
- 需要快速响应可降低深度
- 需要更强棋力可提高深度与 hash（注意 CPU 占用）

---

## 常见问题（FAQ）

### 1. 启动后无法使用 AI

先检查：

- `engine/` 下是否存在可执行文件 + `pikafish.nnue`
- 可执行文件是否有执行权限（Linux/macOS）
- 后端终端是否有引擎启动错误

### 2. Windows 启动时引擎被拦截

- 在 Defender 或安全软件中允许该可执行文件
- 重新启动后端

### 3. 前端能开，但 AI 一直不动

- 检查后端是否正常运行在 `3001`
- 检查浏览器是否连上 `ws://localhost:3001/ws`
- 查看后端日志是否出现引擎错误

### 4. 构建后如何运行服务端

```bash
pnpm --filter server build
pnpm --filter server start
```

---

## Roadmap

- [x] 人机 / 双人 / AI 对战
- [x] 残局库（内置 + 自定义 + 收藏）
- [x] FEN 导入导出、悔棋重做、提示与分析
- [ ] 自动化测试（规则层 + 协议层）
- [ ] 棋谱导出（PGN/自定义格式）
- [ ] 在线对战（房间、观战、回放）
- [ ] CI 工作流（lint/build/test）

> 欢迎按这个清单提 PR 或 Issue。

---

## 贡献指南

详细规范见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

已内置：

- Issue 模板：`.github/ISSUE_TEMPLATE/`
- PR 模板：`.github/pull_request_template.md`

### 提交 Issue 建议模板

建议包含以下信息，便于快速定位：

- 问题描述：发生了什么，预期是什么
- 复现步骤：尽量精确到按钮与顺序
- 运行环境：OS、Node 版本、浏览器版本
- 日志信息：前端控制台 / 后端终端关键报错
- 截图或录屏（可选但强烈推荐）

### 提交 PR 建议

1. 创建分支：`feat/xxx`、`fix/xxx`
2. 说明动机：为什么要改，不只是改了什么
3. 附测试方法：如何验证（手测步骤或测试命令）
4. 保持单一主题：一个 PR 尽量只做一类事情

### Commit 信息建议

当前仓库历史以中文为主，建议保持一致，例如：

- `feat: 新增残局导入导出`
- `fix: 修复执黑后手 AI 走子颜色错误`
- `docs: 完善 README 与使用说明`

---

## 开发建议与扩展方向

- 增加自动化测试：
  - 规则层（`rules.ts`）单测
  - 记谱与 UCI 编解码单测
  - WebSocket 协议集成测试
- 增加残局导入/导出（JSON）能力
- 增加在线对战（房间、观战、回放）
- 增加局面评估图（全局历史曲线）

---

## 许可证

- 本项目采用 GPL-3.0，详见 [`LICENSE`](./LICENSE)。
- Pikafish 遵循 GPL-3.0，涉及分发时请遵循其许可证要求。
