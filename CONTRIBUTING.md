# Contributing Guide

感谢你对 `xiangqi` 项目的关注与贡献。

本文档约定了 Issue、PR、提交信息和开发流程，目标是让协作更高效、评审更顺畅。

## 开发环境

- Node.js 18+
- pnpm
- 可用的 Pikafish 引擎文件与 `pikafish.nnue`

安装与启动：

```bash
pnpm install
pnpm dev
```

## 分支命名建议

- `feat/<topic>`：新功能
- `fix/<topic>`：问题修复
- `docs/<topic>`：文档改进
- `refactor/<topic>`：重构（不改行为）

示例：

- `feat/endgame-export`
- `fix/ai-side-selection`

## Commit 信息建议

保持简洁、单一主题，推荐格式：

```text
<type>: <summary>
```

常见 type：

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`

示例：

- `feat: 新增残局导出能力`
- `fix: 修复执黑后手 AI 走子颜色错误`
- `docs: 完善 README 使用说明`

## 提交 Pull Request 前检查

1. 确认功能可运行（本地手测主流程）
2. 确认构建通过：`pnpm build`
3. 确认未提交无关文件（如本地缓存、临时日志）
4. PR 说明中写清：
   - 改动动机（Why）
   - 主要实现（What）
   - 验证步骤（How to test）

仓库已内置 `.github/pull_request_template.md`，新建 PR 时会自动带出检查项。

## Issue 提交建议

仓库已内置 GitHub Issue 模板（Bug/Feature），建议直接按模板填写。  
如果模板中的链接仍是占位值，请在 `.github/ISSUE_TEMPLATE/config.yml` 替换为你的仓库地址。

建议包含：

- 问题描述（现象与预期）
- 复现步骤
- 环境信息（OS、Node、浏览器）
- 错误日志（前端控制台/后端终端）
- 截图或录屏（可选）

## 代码风格与范围控制

- 尽量保持小而明确的改动
- 一个 PR 尽量只解决一个问题
- 不在同一个 PR 混入大规模格式化
- 优先复用现有模式与工具函数

## License

提交代码即表示你同意你的贡献在本仓库许可证下发布（见 `LICENSE`）。
