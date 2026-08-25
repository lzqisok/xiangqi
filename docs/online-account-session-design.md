# 公网账号与会话设计

## 状态

- 阶段：第二批账号、会话和统一 ActorContext 核心已实现；公网对局身份接入留到第三批。
- 决策：首版采用自建邮箱密码账号和 MySQL 服务端会话。
- 适用范围：公网在线入口和云端用户数据。
- 不影响范围：本地模式、现有局域网房间 token、局域网邀请和席位恢复链接。

## 设计目标

- HTTP 与 WebSocket 使用同一个可信身份来源。
- 登录标识、公开资料和内部用户主键彼此分离。
- 浏览器不持有可被 JavaScript 读取的长期认证凭据。
- 账号切换会切断旧用户的请求、WebSocket、内存状态和缓存命名空间。
- 凭据重置、账号受限、会话撤销和账号删除均能立即影响现有连接。
- 首版保持小范围：不同时引入手机号、第三方 OAuth、MFA 和管理员前端。

## 首版产品决策

### 登录方式

- 首版只提供“邮箱 + 密码”。
- 注册后可以进入本地模式和账号中心，但邮箱验证完成前不能快速匹配、创建公网对局、申请席位、聊天或实时观战。
- 找回密码通过邮箱一次性链接完成。
- 不支持手机号、用户名登录或第三方登录；后续身份提供方通过 `auth_identities` 扩展，不改变 `users.id`。
- 邮箱只作为登录标识和安全通知目标，不作为公开资料返回。

### 用户标识与昵称

- `users.id` 使用服务端生成的随机 UUID，永不由客户端指定。
- 邮箱规范化后在有效身份范围内唯一；原始邮箱仅用于显示和投递。
- 公开昵称允许重复，首版长度 2～20 个 Unicode 字符。
- 昵称不是权限依据，也不参与账号查找、席位恢复或对局历史关联。
- 对局参与者保存开局时昵称快照，用户以后改名不重写历史。

### 匿名用户边界

匿名用户可以：

- 使用全部不依赖服务器私有数据的本地模式。
- 查看不包含私有字段的公开大厅摘要。
- 查看产品首页、规则说明和明确标记为公开的已结束回放。
- 打开登录、注册、验证和找回密码页面。

匿名用户不能：

- 进入公网快速匹配、创建公网对局或占用红黑席位。
- 发送聊天、申请席位、实时观战或读取用户资料。
- 使用 `/api/me/*` 或云端保存能力。

首版实时观战要求已验证账号，目的是复用账号限流、封禁和连接配额。以后若开放匿名观战，必须单独增加匿名会话、连接配额和滥用治理。

## 账号状态

| 状态                   | 登录           | 私有数据                 | 公网观战 | 创建/匹配/走子 | 修改安全信息     |
| ---------------------- | -------------- | ------------------------ | -------- | -------------- | ---------------- |
| `pending_verification` | 允许           | 仅本人，允许本地导入预览 | 不允许   | 不允许         | 允许             |
| `active`               | 允许           | 正常                     | 允许     | 允许           | 允许，需重新认证 |
| `restricted`           | 允许           | 只读或按限制项控制       | 允许     | 默认不允许     | 允许，需重新认证 |
| `suspended`            | 拒绝新登录     | 不可访问                 | 不允许   | 不允许         | 仅恢复/申诉流程  |
| `pending_deletion`     | 仅允许恢复账号 | 不可访问                 | 不允许   | 不允许         | 仅取消删除       |
| `deleted`              | 不允许         | 已清理                   | 不允许   | 不允许         | 不允许           |

规则：

- `restricted` 的具体限制以服务端安全策略为准，不接受客户端传入能力列表。
- 状态变化增加 `auth_epoch` 并撤销不再有效的会话。
- 管理员常规查看不自动获得揭棋裁判态；高权限诊断另走审计接口。

## 密码策略

- 密码只通过 HTTPS 传输，服务端不记录明文、长度、片段或请求体。
- 密码哈希采用 Argon2id；参数在目标生产规格上基准测试后冻结，并随哈希记录参数版本。
- 每个密码使用独立随机 salt；不使用 SHA-256 等快速散列直接保存密码。
- 接受长密码和密码管理器生成内容，不设置会破坏长口令的静默截断。
- 修改密码、修改邮箱、撤销其他设备和删除账号前要求近期重新认证。
- 密码修改成功后增加 `auth_epoch`，撤销除当前确认会话外的其他会话；用户可选择同时退出当前设备。
- 登录与找回接口使用一致的外部错误文案，避免泄露邮箱是否注册。
- 登录失败按“邮箱标识 + IP”和“IP 时间窗口”同时限流；不使用永久账号锁定替代限流。

密码存储遵循 [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)，具体 Argon2id 参数在实现批次通过基准测试确定，不在设计阶段复制可能随环境失真的固定值。

## 会话模型

### 会话 token

- 登录成功后生成至少 256 bit 的高熵随机 token。
- 浏览器只通过名为 `__Host-xiangqi_session` 的 Cookie 持有原始 token；本地非 HTTPS 开发使用不带 `__Host-` 前缀的 `xiangqi_session`。
- Cookie 属性固定为 `Secure; HttpOnly; SameSite=Lax; Path=/`，不设置 `Domain`。
- MySQL 只保存 token 的 SHA-256 摘要；随机 token 的摘要用于查找，不承担密码哈希职责。
- 不把 session token、JWT 或 refresh token 写入 `localStorage`、`sessionStorage`、URL、日志或分析事件。
- 邮件一次性 token 使用 URL fragment 交给账号操作页；页面立即从地址栏清除 fragment，以请求 body 完成交换，并且不写入持久存储、Referrer、日志或分析事件。
- 首版使用不透明服务端会话，不使用长期 JWT；这样可以立即撤销、封禁并统一 HTTP/WS 状态。

### 有效期

- 非“记住我”会话：7 天空闲过期、30 天绝对过期。
- 首版不提供无限期“记住我”；后续如增加，需要单独的设备管理和风险提示。
- `last_seen_at` 最多按 5 分钟节流更新，避免每次请求写数据库。
- 会话在过期、退出、密码修改、账号状态变化或管理员撤销时失效。
- 认证成功、权限提升和重新认证后轮换 token，防止会话固定。

### CSRF

- 所有带会话 Cookie 的状态变更 HTTP 请求校验 `Origin`，只允许配置的同源来源。
- 同时使用与会话绑定的 CSRF token；前端通过认证后的只读端点取得，保存在内存并放入 `X-CSRF-Token`。
- CSRF token 不进入 URL、不进入持久浏览器存储，并使用恒定时间比较。
- `SameSite` 是纵深防御，不能代替 CSRF token。
- 登录、注册、找回密码虽无既有会话，仍执行 Origin、内容类型、负载大小和频率限制。

### WebSocket

- Upgrade 时校验 `Origin`、Host/可信代理配置和 session Cookie。
- 公网 WebSocket 连接对象绑定 `{ userId, sessionId, authEpoch, accountStatus }`，消息中不得覆盖。
- 订阅对局时根据数据库参与关系计算 `owner/red/black/spectator`，不信任客户端的 nickname、role 或 userId。
- 邀请 token 只授权一次加入动作；加入后身份来自用户参与关系。
- 会话过期、退出、账号限制或 `auth_epoch` 变化后关闭现有公网连接。
- 自动重连重新执行 Upgrade 认证，不复用旧连接角色。
- LAN 模式继续使用当前 owner/seat token，并通过场景分发与公网 ActorContext 隔离。

会话和浏览器存储边界参考 [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

## 注册、验证与恢复流程

### 注册

1. 客户端提交邮箱、密码、昵称和 CSRF/Origin 所需信息。
2. 服务端在事务中创建 `users`、`user_profiles`、`auth_identities` 和 `password_credentials`。
3. 创建邮箱验证 token；数据库只保存摘要和过期时间。
4. 发送验证邮件失败时账号仍保持 `pending_verification`，允许受限重发。
5. 对外响应不暴露相同邮箱是否已经存在；已存在邮箱走安全通知或统一成功文案。

### 邮箱验证

- 验证链接 token 24 小时有效、最多使用一次。
- 验证成功后把账号转为 `active` 并撤销同用途的其他 token。
- 重发有账号、IP 和时间窗口限制；新 token 创建后旧 token 失效。

### 登录

1. 规范化邮箱并执行多维限流。
2. 无论账号是否存在，都走时间差尽量接近的校验路径。
3. 校验密码、账号状态和验证状态。
4. 轮换或创建服务端会话，设置安全 Cookie。
5. 记录不含敏感值的安全事件。

### 找回密码

- 请求接口始终返回统一结果。
- 恢复 token 30 分钟有效、最多使用一次，数据库只存摘要。
- 设置新密码前再次验证 token 状态和用户状态。
- 完成后增加 `auth_epoch`，撤销全部旧会话并创建新的当前会话。
- 邮箱投递失败不返回账号是否存在。

### 修改邮箱

- 首版可以延后 UI，但数据模型必须支持。
- 要求近期重新认证，并同时验证旧邮箱安全通知和新邮箱确认。
- 新邮箱确认前保留旧登录身份；切换在一个事务中完成。

## 账号删除与恢复

- 用户提交删除前必须重新认证。
- 提交后立即进入 `pending_deletion`，撤销全部会话并停止公网互动。
- 删除流程先取消匹配和 waiting 席位；playing 对局通过现有权威终局流程记为认输/异常离开，不能留下永久占位或直接删除共享 match。
- 提供 30 天恢复期；恢复必须通过验证邮箱的一次性链接并重新设置会话。
- 恢复期结束后异步清理用户私有资源、认证身份、密码凭据和会话。
- 共享对局不因一方删除而删除另一方历史；参与关系去标识化，保留开局昵称快照的策略见数据模型文档。
- 删除任务使用幂等 job，可以安全重试并记录不含正文的审计结果。
- 上线前仍需按实际运营地区复核最终保留期和法务文案，本设计只给出产品默认值。

## HTTP API 草案

| 方法     | 路径                               | 身份       | 说明                           |
| -------- | ---------------------------------- | ---------- | ------------------------------ |
| `POST`   | `/api/auth/register`               | 匿名       | 注册并发送验证邮件             |
| `POST`   | `/api/auth/login`                  | 匿名       | 创建服务端会话                 |
| `POST`   | `/api/auth/logout`                 | 当前会话   | 撤销当前会话并清 Cookie        |
| `GET`    | `/api/auth/session`                | 可匿名     | 返回匿名或当前用户最小会话视图 |
| `GET`    | `/api/auth/csrf`                   | 当前会话   | 返回会话绑定的短期 CSRF token  |
| `POST`   | `/api/auth/verify-email`           | 匿名 token | 验证邮箱                       |
| `POST`   | `/api/auth/verification/resend`    | 受限账号   | 重发验证邮件                   |
| `POST`   | `/api/auth/password/reset-request` | 匿名       | 请求找回，不暴露账号存在性     |
| `POST`   | `/api/auth/password/reset`         | 匿名 token | 设置新密码并撤销旧会话         |
| `GET`    | `/api/me`                          | 已登录     | 当前用户和账号能力摘要         |
| `PATCH`  | `/api/me/profile`                  | 已登录     | 修改公开资料                   |
| `GET`    | `/api/me/sessions`                 | 已登录     | 活跃会话列表，不返回 token     |
| `DELETE` | `/api/me/sessions/:id`             | 重新认证   | 撤销指定会话                   |
| `POST`   | `/api/me/password`                 | 重新认证   | 修改密码                       |
| `POST`   | `/api/me/deletion`                 | 重新认证   | 进入待删除状态                 |
| `POST`   | `/api/account/recover`             | 恢复 token | 取消账号删除                   |

所有响应使用白名单 DTO。`/api/me/*` 不接受目标 `userId`。

## 前端状态与缓存

- 应用启动先读取 `/api/auth/session`，完成前不加载任何用户私有资源。
- 用户缓存 key 必须包含 `userId`；旧全局 localStorage 只作为显式导入来源。
- 退出、401、账号状态变化或切换用户时：
  - 取消用户作用域内的 fetch/自动保存任务。
  - 关闭公网 WebSocket。
  - 清空 React 内存状态和用户作用域查询缓存。
  - 不删除用户主动保留的旧本地数据，但不得自动显示给下一账号。
- 引擎设置分为账号偏好和设备性能参数；后者默认留在设备用户命名空间。

## 安全事件

首版记录以下事件类型，不保存密码、token、完整请求体或聊天正文：

- 注册、验证、登录成功/失败、退出。
- 密码重置请求、完成和凭据修改。
- 会话创建、轮换、撤销和过期。
- 账号状态、邮箱和删除状态变化。
- 异常频率限制和安全策略拒绝。

安全事件默认保留 180 天；用户账号中心只展示适合用户理解的子集，管理员审计另行授权。

## 验收门禁

- 两个账号在同一浏览器依次登录，后一个账号看不到前一个账号的任何数据或异步结果。
- 修改 Cookie 之外的 userId、nickname、role、room token 不会改变公网身份。
- 当前会话退出、密码修改、账号限制和删除提交后，已有 HTTP/WS 权限立即失效。
- 登录、验证和恢复接口不通过状态码、文案或明显时间差泄露账号存在性。
- 认证凭据不出现在 localStorage、URL、日志、监控标签、错误响应或导出中。
- LAN 邀请、席位恢复和本地模式行为保持不变。

## 运行配置

- `AUTH_ALLOWED_ORIGINS`：以逗号分隔的额外可信 Origin；生产同源请求仍必须使用 HTTPS。
- `AUTH_DEV_EXPOSE_TOKENS=true`：仅供本地开发显示验证/恢复 token，生产环境强制忽略。
- 服务端通过 `AuthTokenDelivery` 适配器投递验证与恢复 token。当前默认启动器使用空实现，公网部署前必须接入邮件服务；投递失败不会回滚待验证账号，重发会撤销同用途的旧 token。

## 参考

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
