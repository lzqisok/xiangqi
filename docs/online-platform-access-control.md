# 公网平台权限矩阵

## 目标

本文定义公网 HTTP、WebSocket、用户私有数据和揭棋投影的统一授权规则。它是后续 API、Repository、集成测试和安全评审的共同输入。

现有局域网模式继续使用 owner/seat capability token；本文的用户身份规则只适用于公网场景。共享规则核心可以复用，但身份来源不得混用。

## ActorContext

所有公网请求在进入业务层前转换为服务端可信 actor：

```ts
type PublicActor =
  | { kind: 'anonymous'; requestId: string; ipKey: string }
  | {
      kind: 'user'
      requestId: string
      userId: string
      sessionId: string
      authEpoch: number
      status: 'pending_verification' | 'active' | 'restricted'
      capabilities: readonly string[]
    }
  | {
      kind: 'operator'
      requestId: string
      operatorId: string
      permissions: readonly string[]
      auditReason: string
    }
```

规则：

- actor 只能由认证中间件或 WebSocket Upgrade 创建。
- 路由 body/query/path 中出现的 `userId/role/isOwner/status` 不参与权限计算。
- `pending_verification` 和 `restricted` 通过服务端 capabilities 限制，不由前端判断。
- operator 与普通 user 入口分离；operator 不因角色自动获得揭棋 referee state。
- Repository 接收 actor 或已经从 actor 派生的明确 owner/participant scope，不接收任意客户端 userId。

## 资源分类

| 分类       | 示例                              | 授权模型                           |
| ---------- | --------------------------------- | ---------------------------------- |
| 公开静态   | 规则、内置残局、开局目录          | 匿名可读，版本化只读               |
| 公开动态   | 公共大厅摘要、公开已结束回放      | 匿名/用户按 visibility 只读        |
| 用户私有   | 研究、训练、对局库、设置          | owner-only，后台另行审计           |
| 共享对局   | match、participant、chat          | 由参与关系、阶段和 visibility 决定 |
| 席位私有   | 揭棋暗吃事件、本人席位备份        | 当前 match 的原红/黑 participant   |
| 服务端机密 | 密码、session hash、referee state | 普通 actor 永不可读                |

## HTTP 路由矩阵

图例：`R` 读取，`W` 写入，`-` 拒绝，`条件` 表示服务端继续执行资源级校验。

### 认证与账号

| 路由                    | 匿名       | 待验证   | active   | restricted | suspended/pending deletion |
| ----------------------- | ---------- | -------- | -------- | ---------- | -------------------------- |
| 注册/登录/验证/请求恢复 | W          | 条件     | 条件     | 条件       | 仅恢复策略允许             |
| `GET /api/auth/session` | R          | R        | R        | R          | 最小状态视图               |
| 退出当前会话            | -          | W        | W        | W          | 清理 Cookie                |
| 重发验证邮件            | -          | W        | -        | -          | -                          |
| `GET/PATCH /api/me`     | -          | R/W      | R/W      | R/条件     | -                          |
| 活跃会话列表/撤销       | -          | R/W      | R/W      | R/W        | -                          |
| 修改密码/邮箱           | -          | 条件     | 重新认证 | 重新认证   | -                          |
| 提交账号删除            | -          | 重新认证 | 重新认证 | 重新认证   | -                          |
| 取消账号删除            | 恢复 token | -        | -        | -          | 恢复 token                 |

认证接口仍执行 Origin、CSRF（存在会话时）、速率和负载限制。错误响应不透露邮箱是否存在。

### 用户私有资源 `/api/me/*`

| 操作        | 匿名 | 当前 owner               | 其他用户 | operator     |
| ----------- | ---- | ------------------------ | -------- | ------------ |
| 列表        | -    | R                        | -        | 独立审计接口 |
| 详情        | -    | R                        | -/404    | 独立审计接口 |
| 创建        | -    | W                        | 不适用   | -            |
| 更新/重命名 | -    | W + expected revision    | -/404    | 独立审计接口 |
| 删除        | -    | W + expected revision    | -/404    | 独立审计接口 |
| 导入        | -    | W + 幂等键               | -        | -            |
| 导出        | -    | R + 重新认证（敏感导出） | -        | 独立审计接口 |
| 来源跳转    | -    | 同时拥有来源访问权       | -        | 独立审计接口 |

为减少 IDOR 信息泄露，其他用户请求不存在和无权访问的私有资源统一返回 404；日志内部区分原因。

### 大厅、对局与邀请

| 操作           | 匿名 | 待验证 | active | restricted | 对局条件                           |
| -------------- | ---- | ------ | ------ | ---------- | ---------------------------------- |
| 公共大厅摘要   | R    | R      | R      | R          | 只返回 public waiting/playing 摘要 |
| 公共已结束回放 | R    | R      | R      | R          | visibility=public，使用公开投影    |
| 实时观战       | -    | -      | 条件   | 条件       | visibility + 连接配额              |
| 创建公网对局   | -    | -      | W      | -          | 用户活跃对局配额                   |
| 快速匹配       | -    | -      | W      | -          | 队列幂等与规则条件                 |
| 使用邀请       | -    | -      | W      | -          | token 有效、席位空、账号未占位     |
| 申请席位       | -    | -      | W      | -          | waiting + visibility 允许          |
| 本人对局历史   | -    | -      | R      | R          | participant.user_id=current        |
| 私密对局详情   | -    | -      | 条件   | 条件       | participant 或有效邀请预览         |

邀请预览只返回名称、规则、阶段和空席摘要；原始邀请 token 不写入响应日志。邀请不授予历史访问或持续身份。

## WebSocket 连接与订阅

### Upgrade

- 公网 `/ws` Upgrade 必须具有允许的 Origin 和有效 session。
- 引擎本地能力和公网对局建议最终使用明确子协议或路径区分；迁移期至少在连接上下文记录 scene。
- session user 必须是 active，或具有明确允许的 restricted capability。
- 每用户、session、IP 和 match 的连接数分别受限。
- 连接建立后绑定 actor；客户端不能通过后续消息切换用户。

### 订阅角色计算

```text
owner      := active match_participant.user_id == actor.userId and is_owner
red/black  := active match_participant.user_id == actor.userId and side matches
spectator  := visibility and account status permit live spectating
none       := otherwise
```

- owner 是对局管理关系，不自动获得红黑席位。
- 同一用户成为棋手后，该 match 的新连接可以接管自己的席位；旧连接被明确降权/关闭。
- 结束后不再建立可交互订阅；返回只读历史视图。
- LAN 订阅继续用 token 匹配 ownerHash/credentialHash，不调用公网计算函数。

## 房间命令权限矩阵

| 消息                         | owner | red/black    | spectator    | 额外条件                                      |
| ---------------------------- | ----- | ------------ | ------------ | --------------------------------------------- |
| `room-subscribe`             | 条件  | 条件         | 条件         | actor 有访问权、对局未关闭                    |
| `room-claim-seat`            | W     | -            | -            | waiting、席位空；公网首版建议改为参与关系接口 |
| `room-invite-seat`           | 条件  | -            | 条件         | 有效一次性邀请，使用时绑定当前 actor          |
| `room-seat-request`          | 条件  | -            | W            | waiting、公开申请开启、本人未占位             |
| `room-seat-approve`          | W     | -            | -            | 申请仍有效、席位空                            |
| `room-leave-seat`            | 条件  | W            | -            | waiting；playing 使用认输                     |
| `room-switch-seat`           | W     | W            | -            | waiting、目标席位空/协商成立                  |
| `room-remove-seat`           | W     | -            | -            | waiting、不能越权删除已开始棋手               |
| `room-renew-invite`          | W     | -            | -            | waiting、撤销旧邀请                           |
| `room-dissolve`              | W     | -            | -            | waiting；playing 不直接删除历史               |
| `room-ready`                 | -     | W            | -            | 本人席位、waiting、expected revision          |
| `room-swap-request/response` | -     | W            | -            | 双方就座、提案状态合法                        |
| `room-move`                  | -     | W            | -            | 本人轮次、合法着、playing、revision           |
| `room-hint`                  | -     | W            | -            | 休闲模式、本人剩余配额；排位禁用              |
| `room-undo-request/response` | -     | W            | -            | 普通象棋、提案状态合法；揭棋禁用              |
| `room-draw-offer/response`   | -     | W            | -            | playing、对手存在                             |
| `room-proposal-cancel`       | -     | 发起者 W     | -            | 对应提案未结束                                |
| `room-resign`                | -     | W            | -            | playing、本人席位                             |
| `room-chat-send`             | 条件  | 条件         | 条件         | 已验证账号、未禁言、频率/内容允许             |
| `room-chat-delete`           | W     | 本人消息条件 | 本人消息条件 | 管理/本人删除策略分离                         |
| `room-chat-mute`             | W     | -            | -            | 非 matchmaking 房或平台 moderator             |
| `room-chat-settings-update`  | W     | -            | -            | 非 matchmaking 房；敏感词策略受限             |

每个修改命令必须具有：

- `commandId`：在 actor + match 范围幂等。
- `roomId/matchId`：必须等于当前订阅资源。
- `expectedRevision`：除独立聊天序列命令外，必须与权威 revision 一致。
- 服务端重新读取 participant、phase、turn 和 proposal 状态，不能只使用连接建立时缓存。

## 引擎与本地对局 WebSocket

现有 `/ws` 同时承载引擎请求、game lease 和 room 命令，公网前需要显式隔离：

| 消息                                      | 匿名         | 已登录       | 公网实战连接     | 限制                            |
| ----------------------------------------- | ------------ | ------------ | ---------------- | ------------------------------- |
| `init/move/hint` 本地 AI                  | 本地部署可用 | 条件         | 禁止混入实战连接 | 用户/IP/引擎配额                |
| `analyze/candidates/review/analyze-nodes` | 本地部署可用 | 条件         | 公网实战期间禁用 | 任务队列、时间、线程、Hash 上限 |
| `stop`                                    | 仅本会话任务 | 仅本会话任务 | 仅本会话任务     | requestId 精确匹配              |
| `claim-game/takeover-game/release-game`   | 现有本机库   | owner 用户   | 非 owner 禁止    | user game ownership + lease     |

首版可以继续共用物理端点，但协议解析后必须进入 `engine/local-game/public-match/lan-room` 之一的显式 scene；一个连接不能未经重新认证跨 scene 获得更多权限。

## 揭棋投影矩阵

| 数据               | 匿名公开回放 | 登录观众 | 未落座 owner | 红方 participant | 黑方 participant | operator 常规查看 | referee 服务 |
| ------------------ | ------------ | -------- | ------------ | ---------------- | ---------------- | ----------------- | ------------ |
| 公开初始暗盘       | 可见         | 可见     | 可见         | 可见             | 可见             | 可见              | 可见         |
| 已公开移动身份     | 可见         | 可见     | 可见         | 可见             | 可见             | 可见              | 可见         |
| 红方暗吃所得身份   | 不可见       | 不可见   | 不可见       | 可见             | 不可见           | 不可见            | 可见         |
| 黑方暗吃所得身份   | 不可见       | 不可见   | 不可见       | 不可见           | 可见             | 不可见            | 可见         |
| 未揭晓完整初始身份 | 不可见       | 不可见   | 不可见       | 不可见           | 不可见           | 不可见            | 可见         |

规则：

- audience 由服务端参与关系决定，接口不接受 `includePrivate` 或客户端 audience。
- 用户删除后不能重新登录取回席位视图，但另一方历史不受影响。
- operator 若确需 referee 诊断，使用独立审计动作、工单理由和最小字段，不通过普通详情接口。
- 公共导出、日志、错误响应和管理列表执行敏感字段扫描。

## 数据删除与导出权限

| 操作          | 私有资源         | 共享对局                             | 聊天                         | 揭棋                                 |
| ------------- | ---------------- | ------------------------------------ | ---------------------------- | ------------------------------------ |
| 用户单项删除  | owner 可删       | 只能从本人列表隐藏，不能删除对方历史 | 本人按策略删除正文           | 只能删本人私有副本/隐藏历史          |
| 账号删除      | 恢复期后物理删除 | participant 去标识化                 | 作者去标识化，正文按期限清理 | referee 随共享 match 保留至到期      |
| 用户导出      | owner 全量可导出 | 当前参与者视图                       | 仅有权范围且遵守保留策略     | 仅本人 seat projection，默认公开投影 |
| operator 导出 | 默认禁止         | 审计工单                             | 审计工单                     | referee 数据默认禁止通用导出         |

## 错误语义

- 私有资源的“不存在”和“属于其他用户”统一对外 404。
- 未登录返回 401；已登录但账号状态/资源动作不允许返回 403。
- revision 冲突返回 409 并仅返回安全的当前 revision。
- 编辑租约冲突保留 423 语义，但必须先校验 owner，避免泄露资源存在性。
- 速率/配额返回 429 和安全的重试时间。
- 数据库/依赖不可用返回 503，不回退到跨用户全量文件存储。
- 内部日志记录 requestId 和分类原因，不记录凭据或揭棋 referee payload。

## 必须自动化的权限测试

### A/B 账号矩阵

对每类私有资源执行：A 创建，B 列表、详情、更新、删除、导出、导入同 ID、来源跳转、WebSocket claim，全部拒绝或按 404 隐藏。

### 参与关系矩阵

- red 不能执行 black 走子或读取 black 私有投影。
- spectator/owner 未落座不能执行棋手命令。
- 私密 match 的非参与者不能订阅或读取详情。
- invite 只能使用一次，不能作为结束后历史访问凭据。
- 同账号新连接接管席位后，旧连接不能继续发命令。

### 状态变化

- session 撤销、密码修改、restricted、suspended、pending deletion 后已有 HTTP/WS 权限变化一致。
- actor 状态不能由缓存无限保留；命令处理在必要时校验 auth epoch。
- 账号进入删除流程时取消匹配/waiting 占位，并通过权威终局路径结束 playing 对局，不能直接删除共享 match。
- 数据库恢复后 participant 与投影权限不漂移。

## 评审门禁

- 新路由或消息类型必须先加入本矩阵再实现。
- 所有 owner/participant 查询必须在 Repository 测试中有反向用户用例。
- 公网 scene 和 LAN scene 的身份来源不得使用隐式 fallback。
- 揭棋 audience 不得由客户端参数控制。
- operator 功能必须提供独立权限、审计理由和敏感字段白名单。
