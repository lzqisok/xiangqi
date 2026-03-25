# Cloud Agent：运行与测试本仓库（入门技能）

面向在干净环境中拉取代码后要**立刻跑起来并验证**的 Cloud Agent。本仓库是 **pnpm monorepo**（`client` + `server`），无用户登录；**无 feature flag 系统**；**尚无自动化测试脚本**（README Roadmap 已标注）。

---

## 1. 先决条件（一次性）

| 项 | 要求 |
|----|------|
| Node.js | 18+ |
| 包管理 | `pnpm`（workspace 根目录安装） |
| 引擎（完整 AI 能力） | 仓库根下 `engine/pikafish`（或 Windows 下 `engine/pikafish.exe`）+ `engine/pikafish.nnue` |

从 monorepo **根目录**安装依赖：

```bash
pnpm install
```

---

## 2. 启动应用（常用命令）

在**仓库根目录**执行：

| 目标 | 命令 |
|------|------|
| 前后端一起开发 | `pnpm dev` |
| 仅前端（Vite） | `pnpm dev:client` |
| 仅后端（Express + WebSocket） | `pnpm dev:server` |
| 生产构建 | `pnpm build` |

默认端口：

- 前端：`http://localhost:5173`（见 `client/vite.config.ts`）
- 后端 HTTP + WS：`http://localhost:3001`，WebSocket 路径 `/ws`

**环境变量（当前代码实际使用）：**

- `PORT`：后端监听端口，默认 `3001`（`server/src/index.ts`）

前端 WebSocket 直连 `hostname:3001/ws`（见 `client/src/hooks/useWebSocket.ts`），与 Vite 端口无关；改后端端口时需同步考虑前端是否仍连 3001。

---

## 3. 登录、鉴权、Feature flags

- **登录**：无。打开前端即可用。
- **Feature flags**：代码库中**没有**集中式开关。若要验证「无引擎」行为，依赖下面「引擎缺失」的自然降级，勿臆造 env 开关。

---

## 4. 引擎：安装位置与「无引擎」行为

引擎目录为**相对于 `server` 包上一级**的 `engine/`（`server/src/engine.ts` 使用 `path.resolve(process.cwd(), '../engine')`）。从根目录执行 `pnpm dev` 时，`cwd` 一般为 `server/`，故解析到仓库根下的 `engine/`。

**无二进制或缺 NNUE 时：** 后端仍会启动；日志会提示引擎未找到。连接上的客户端在请求需要引擎的操作时会收到 `type: 'error'`（例如 `Engine not available`）。可用此状态手测「仅前端 / 规则层」而不跑 Pikafish。

**完整 AI / 分析 / 提示：** 必须按根目录 `README.md`「引擎准备说明」放置 `pikafish` + `pikafish.nnue`。

---

## 5. 按代码区域组织：改什么、怎么测

### 5.1 Monorepo 根（`package.json`、`pnpm-workspace.yaml`）

- **改动**：脚本、workspace 配置、根级依赖。
- **验证**：`pnpm install`；`pnpm dev` 能同时拉起两个子包；`pnpm build` 无报错。

### 5.2 前端 `client/`

- **关键路径**：`src/App.tsx`（流程）、`src/hooks/useGame.ts`、`src/hooks/useWebSocket.ts`、`src/components/*`、`src/engine/*`（纯前端规则与棋盘）、`src/endgames/*`。
- **手测流程（UI）**：
  1. `pnpm dev` → 浏览器打开 `http://localhost:5173`。
  2. 任选模式（人机 / 双人 / AI 对战 / 残局），走子、悔棋、FEN 导入导出、翻转棋盘。
  3. 需引擎：提示、分析、AI 走子；看浏览器控制台无持续报错，后端终端无未处理异常。
- **仅前端（无引擎）**：确认 UI 与本地双人/规则相关功能仍可用；请求 AI 时应出现错误提示而非白屏。

### 5.3 后端 `server/`

- **关键路径**：`src/index.ts`（HTTP、WebSocket 消息分发）、`src/engine.ts`（UCI 子进程、难度深度）。
- **手测流程**：
  1. `pnpm dev:server`，确认日志出现监听端口与（若引擎存在）引擎启动信息。
  2. 配合前端或使用 `wscat` 等工具连 `ws://localhost:3001/ws`，发送 JSON 消息（类型见根 `README.md`「WebSocket 消息」）：`init`、`move`、`hint`、`analyze`、`stop`。
  3. 改 `PORT` 时：`PORT=4000 pnpm --filter server dev`，需用前端或客户端改连对应端口（当前前端写死 `:3001`）。

### 5.4 引擎资产 `engine/`（非 Git 二进制，环境自备）

- **验证**：可执行权限（Unix）、路径与文件名与 `engine.ts` 一致；后端日志无 `Pikafish engine binary not found`。

### 5.5 前端规则与记谱 `client/src/engine/`

- **说明**：与 Pikafish 解耦，可在无引擎时通过棋盘 UI、非法走子拦截、记谱显示做回归。
- **建议**：将来若加 `vitest`/`jest`，优先为 `rules.ts`、`notation.ts` 加单测；加完后在本技能「自动化」小节补充命令。

### 5.6 残局 `client/src/endgames/`

- **手测**：残局库列表、内置/自定义、本地存储键（见根 README「数据持久化」）、编辑器保存与再打开。

### 5.7 文档与协作 `.github/`、`CONTRIBUTING.md`

- **验证**：不涉及运行时；PR 前按 `CONTRIBUTING.md`：`pnpm build` + 主流程手测说明。

---

## 6. 构建产物运行（冒烟）

```bash
pnpm build
pnpm --filter server start   # 默认 node dist/index.js，需先 build server
pnpm --filter client preview # 可选，检查静态构建
```

确认生产模式下方仍能连上后端 WebSocket（端口与部署方式一致）。

---

## 7. 发现新技巧时如何更新本技能

1. **新命令或脚本**：在根或子包 `package.json` 有变更时，更新第 2 节表格与示例命令。
2. **新环境变量或配置**：在 `server`/`client` 出现 `process.env` / `import.meta.env` 时，追加到第 2–3 节，并注明默认值与影响范围。
3. **新手测路径**：在对应「按代码区域」小节增加简短步骤或边界情况（如新消息类型）。
4. **自动化测试**：一旦加入 `test` 脚本或 CI，新增一节列出 `pnpm test`（或实际命令）并指向测试目录；Roadmap 可勾选同步。
5. **保持精简**：只记录 Agent **重复需要**的入口信息；细节仍可由 `README.md` / `CONTRIBUTING.md` 承担。

提交技能变更时与代码改动同一 PR 或紧随其后的 docs 提交即可，便于评审对照。
