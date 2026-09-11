# 公网 API 与 WebSocket 契约

Contract-Version: 1

本文记录首个账号化公网版本的兼容边界，并由 `pnpm contract:check` 与客户端、服务端源码共同校验。协议字段或路径变更必须在同一提交中更新服务端、客户端、测试和本文；灰度期间只允许向后兼容的可选字段扩展。删除、改名、改变语义或把可选字段改为必填时，必须提升契约版本并明确最低客户端版本或强制安全刷新策略。

## HTTP 基线

- 会话恢复：`GET /api/auth/session`；登录成功后以 HttpOnly session Cookie 和 CSRF Cookie/Header 双提交保护写请求。
- 在线大厅：`GET /api/online/lobby`。
- 本人历史：`GET /api/me/matches`，游标分页且只返回当前账号可见投影。
- 私有文档写入使用 `clientMutationId` 幂等键和 `revision` 乐观并发；冲突稳定返回 HTTP 409 与当前版本信息。
- 错误响应只暴露稳定错误码和 requestId，不返回凭据、邮箱全文、棋局 state、FEN、moves 或揭棋私有事件。

## WebSocket 基线

- `/ws` 承载象棋、揭棋在线对局和引擎协议；`/gomoku-ws` 承载五子棋协议。
- 公网模式升级请求必须带有效账号 session Cookie 和精确允许的 Origin。客户端命令使用唯一 `requestId`；改变对局状态的在线命令还使用当前 `revision` 与幂等请求键。
- 快照共享字段以两端 `OnlineMatchSummary`、`OnlineMatchSnapshot` 为准，包括 `competitionMode`、`clockPreset`、`visibility`、`role`、`side`、`disconnectDeadline` 和 `previousMatchId`。
- 揭棋快照必须按角色投影。`capturedHidden` 可以公开“发生暗子捕获”这一事实，但只有有权席位能收到对应身份；旁观者和对手不能通过增量消息、重连或历史接口恢复私有身份。
- 服务关闭或发布摘流使用 1012 关闭码提示客户端重连。未知字段在本契约版本内应被旧客户端忽略；服务端不得依赖尚未完成灰度的必填新字段。

## 阻断测试映射

- `server/src/protocol.test.ts`、在线路由/服务/管理器测试覆盖字段校验、revision、幂等、账号接管和 WebSocket 状态。
- `client/src/online/model.test.ts` 与 API 测试覆盖客户端快照合并、账号边界和冲突处理。
- 揭棋记录投影、ICCS PGN、象棋重复裁定与五子棋规则语料继续作为 CI 阻断测试，不因发布批次降级为非阻断检查。

## B 阶段兼容扩展

新增只读本人接口 `/api/me/ratings`、`/api/me/ratings/ledger`、`/api/me/ratings/matches/:id`，字段、分页、作废和 null 语义见 [积分策略](online-rating-policy.md)。这些查询不接受客户端指定所有者；错误游标/页大小为 400，非参与者或其他账号游标为 404。响应数字为 JSON number，未结算值为 null；读取受账号/IP/会话限流保护。

`matchmaking_cooldown` 使用 HTTP 429、`retryAfter` 和 `Retry-After`；`rated_undo_forbidden` 拒绝排位悔棋，`online_match_analysis_forbidden` 拒绝引擎辅助。后者同时覆盖 `/ws` 和 `/gomoku-ws` 的账号活跃排位约束。新增查询和现有错误消息扩展保持版本 1 的字段结构，旧客户端仍由服务端强制公平规则。

管理员中止无公共 HTTP/WS 路由。运维 CLI 中止使用既有 finished/draw/abandoned 快照，新的本人积分接口解释 service_restart/service_failure/admin_abort 原因。真实 HTTP 路由授权/分页与真实五子棋 WS 拦截测试分别在 `mysql.integration.test.ts`、`gomoku/websocket.test.ts`，不能以契约字符串检查替代这些测试。
