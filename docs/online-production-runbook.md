# 公网运行、发布与恢复手册

本文把 `online-platform-threat-deployment.md` 的设计约束落实为可执行顺序。它不代表 staging 已建立或恢复演练已发生；每次执行必须把时间、版本、操作者和结果写入发布记录。

## 固定制品与秘密

- Node 固定为仓库 `.nvmrc` 的 `22.22.0`，pnpm 固定为根 `packageManager` 的 `9.15.9`；systemd 的 `ExecStart` 与 preflight 必须使用同一份部署运行时，不能由交互 shell 的 PATH 偶然决定。
- `pnpm install --frozen-lockfile && pnpm build` 是唯一生产构建入口，运行命令为 `node server/dist/index.js`。
- 发布制品记录 `DEPLOYMENT_VERSION`、Pikafish、揭棋引擎、Rapfi 和权重版本；生产启动拒绝 `development` 占位值。
- `engine/` 由制品系统在启动前准备，二进制和权重不提交 Git。MySQL、邮件 webhook、metrics token 和 TLS 私钥只从 secret store 或 `/etc/xiangqi/runtime.env` 注入，不写入镜像层。
- systemd 示例只允许 `/var/lib/xiangqi` 写入，因此 `XIANGQI_DATA_DIR` 和 `XIANGQI_ROOM_DIR` 必须指向该目录下由 `xiangqi` 用户拥有的子目录；不得让运行进程写发布制品目录。
- `PUBLIC_ONLINE_ENABLED` 与前端构建变量 `VITE_PUBLIC_ONLINE_ENABLED` 默认均为 `false`。只有本手册的 staging 门禁有证据后才同时打开。

生产环境以 `server/.env.example` 为非秘密模板。应用发布前运行：

```bash
NODE_ENV=production pnpm --filter server platform:preflight
```

反向代理可从 `deploy/nginx.conf.example` 起步，并将 `deploy/security-headers.nginx.conf` 安装到示例 include 路径；它覆盖客户端传入的转发头，不追加不可信链。应用的 `TRUSTED_PROXY_CIDRS` 必须只包含代理到应用的实际地址范围。服务管理可从 `deploy/xiangqi.service.example` 起步，目录和资源值需按主机校准。

## Staging 基线

Staging 必须是与生产同拓扑的独立环境：独立域名、数据库、应用/迁移/备份角色、邮件投递目标、metrics token、账号、引擎目录和较小配额。不得连接生产数据库、复用生产 Cookie 域或接收生产邮件。

部署后先执行只读冒烟：

```bash
STAGING_ORIGIN=https://staging.example.com \
STAGING_ACCOUNT_EMAIL='release-check@example.test' \
STAGING_ACCOUNT_PASSWORD='从 secret store 注入' \
pnpm --filter server staging:smoke
```

受控读负载使用一个可撤销的 staging session，默认 10 并发、每 worker 10 次：

```bash
STAGING_ORIGIN=https://staging.example.com \
STAGING_SESSION_COOKIE='xiangqi_session=...' \
LOAD_CONCURRENCY=10 LOAD_ROUNDS=10 \
pnpm --filter server staging:read-load
```

写负载使用一次性账号和对局，逐步增加到目标并发。覆盖两个账号并发匹配、第三账号观战、双方聊天、准备/走子、完成后历史查询；使用唯一 `commandId/requestKey`，结束后撤销 session。记录 p50/p95/p99、429 比例、5xx、DB pool pressure、WS 断开和引擎拒绝。不得对生产执行写负载。

## 故障与资源门禁

在 staging 逐项记录开始/恢复时间、客户端现象和指标：

1. 暂停数据库网络 10 秒：HTTP 写请求应返回稳定 503/500 requestId，进程不退出；恢复后 readiness 自动恢复。
2. 将测试查询延迟提高到 query timeout 以上，并把测试 pool 降到 1：超时/回滚有指标，真人 WS 规则进程仍存活，队列不无限增长。
3. 暂停 MySQL 存储或将测试卷逼近阈值：先由数据库/主机告警阻止继续发布，不在应用内自动清理业务数据。
4. 临时移走一个 staging 引擎二进制并重启：`/health/ready` 仍可通过，`/health/engines` 单独降级，真人对局不依赖引擎。
5. 将 `MAX_ENGINE_PROCESSES/MAX_ENGINE_TASKS` 降低后并发发起分析和提示：超限返回稳定错误与重试时间，进程数、线程和 Hash 不越界，在线实战连接拒绝分析协议。
6. SIGTERM 应用：代理摘除实例后不再接收 Upgrade；客户端收到 1012，Repository flush、WS、引擎和 MySQL pool 在 `SHUTDOWN_GRACE_MS` 内依序关闭。

## 最小告警

初始阈值必须在首轮压测后校准，但不能空缺：

| 告警     | 初始条件                                           | 处理入口                |
| -------- | -------------------------------------------------- | ----------------------- |
| 登录异常 | 5 分钟 rejected 比例 > 30% 且次数 > 50             | 凭据攻击、邮件/DB 状态  |
| HTTP 5xx | 5 分钟比例 > 2% 或连续 3 次 readiness 失败         | requestId 日志、DB 指标 |
| DB pool  | pressure ratio > 0.8 持续 5 分钟或 DB errors 激增  | 慢查询、连接泄漏、限流  |
| WS 断开  | 5 分钟断开量高于近 7 日同时间 3 倍                 | 代理、心跳、发布事件    |
| 引擎资源 | 任一 task/process quota reject 或 timeout 连续出现 | 关闭分析入口、检查进程  |
| 备份     | 计划窗口未产生新校验和，或恢复校验失败             | 阻断发布并补做备份      |

日志平台按 `event` 采样，安全事件、错误、发布和备份日志不采样；普通成功 HTTP 可采样。热日志保留 7 天、聚合指标至少 30 天，具体合规期限另行确认。禁止以 requestId、userId、matchId、IP、聊天正文、FEN 或 moves 作为指标标签。

## 发布检查表

发布前：

- [ ] 工作树、依赖锁、单元/集成测试、`pnpm build` 和 `git diff --check` 通过。
- [ ] preflight 通过，制品 SHA 和五类版本已记录；secret 扫描无新增。
- [ ] 最近逻辑备份的 gzip 与 SHA-256 有效，并有本次发布前恢复点。
- [ ] migration 在 staging 从当前生产 schema 前向执行；应用前一版本仍能读取扩展后的 schema。
- [ ] staging 冒烟、写负载、故障注入、回滚和恢复演练有记录。
- [ ] 告警接收人在线；旧应用制品、旧配置和关闭公网入口的操作已准备。

发布顺序：先备份，执行 `db:status`，用 migration 角色运行 `db:migrate`，再部署兼容应用；先保持公网入口关闭，验证 readiness/metrics/登录和三棋类，再小流量开启。破坏性 schema 清理不得与本次发布同批。

发布后观察至少 30 分钟：登录、5xx、DB pressure、WS、匹配等待、完成/异常终局、引擎和备份指标。记录开始、结束、版本、migration 4、指标截图位置和负责人。

## 回滚与恢复

异常时先把 `PUBLIC_ONLINE_ENABLED` 和前端入口关闭，停止新匹配；无数据完整性风险时允许兼容中的对局完成。回滚应用制品，不执行 down migration。若新旧代码不能共享 schema，发布必须预先声明维护窗口，不得声称滚动兼容。

备份：

```bash
DATABASE_BACKUP_URL='从 backup secret 注入' \
DATABASE_BACKUP_DIR='/独立备份挂载' \
pnpm --filter server db:backup
```

恢复演练：

```bash
DATABASE_RESTORE_URL='mysql://.../xiangqi_restore' \
DATABASE_BACKUP_FILE='/备份挂载/xiangqi-....sql.gz' \
ALLOW_RESTORE_VERIFY=1 \
pnpm --filter server db:restore:verify
```

恢复后还要人工抽查普通象棋、揭棋、五子棋各一局，逐席比较揭棋投影，并决定全局撤销旧 session。记录备份时间、恢复开始/结束、RPO、RTO、migration 版本、抽样 ID 和校验结果。没有这份证据，`TODO.md` 的 staging 发布/回滚/备份恢复演练保持未勾选。
