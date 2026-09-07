# A 阶段可靠性与验收工具

本页区分自动化回归和真实环境容量验收。自动化通过不能替代 C 阶段的备份恢复、staging 发布与告警演练；不调整 B 阶段排位计分规则。

## 自动终局

`OnlineMatchManager` 使用按任务键串行的后台任务，失败按 1、2、4、8、16、30 秒退避，最多间隔 30 秒持续重试。每 30 秒扫描数据库中的 waiting/playing 对局，补回棋钟与掉线任务。启动扫描本身失败也重试，无需客户端触发。数据库中已有掉线截止时间继续沿用；首次发现未连接棋手时写入宽限截止时间，待写入失败重试期间保持该时间；若重试时已逾期，写入的 disconnected_at 不晚于原截止时间，避免违反数据库时间顺序约束。

席位 presence 写入串行，重连取代旧的待执行写入并等待已开始的离线写入完成。presence 与裁决都先锁对局；裁决继续检查 phase、revision 和数据库中的截止时间，走子更新棋钟后旧超时任务无效。重复扫描、重试与积分结算沿用现有事务约束。停机取消定时器，不再安排新任务。

失败记录 `online_recovery_retry`，含 operation、matchId、attempt、delayMs；指标 `xiangqi_online_recovery_failures{operation}` 使用有限标签。错误日志不输出 SQL、凭据或裁判载荷。告警送达与阈值验证仍属 C 阶段。

## 恢复一致性

原命令 `pnpm --filter server db:restore:verify` 保留“隔离空库 + gzip 导入 + migration 检查”流程，随后执行 `restore-verify-cli.ts`。任何 SQL 检查不为零、状态解析失败或公开投影不一致都返回退出码 1。

检查账号关联、缺失 match_states、revision、参与者匿名化、积分余额与流水 delta、胜负和盘数与有效结算、结算与对局、结算与流水数量/值。分批重放三棋类裁判状态，公开状态必须精确等于白名单投影，额外揭棋字段也失败。当前积分检查以初始 1500 和完整流水为基线；D 阶段数据保留策略变更时必须同步调整，不能删除流水后放宽校验掩盖不一致。

## 读负载与业务负载

所有命令从仓库根目录通过 pnpm filter 运行。报告不保存 Cookie、账号密码或请求体。凭据文件由操作者放在仓库外并设置 0600 权限。

读负载：

```bash
STAGING_ORIGIN=https://staging.example.com \
STAGING_SESSION_COOKIE='session cookie supplied securely' \
LOAD_CONCURRENCY=10 LOAD_ROUNDS=100 LOAD_P95_TARGET_MS=1000 \
LOAD_REPORT_FILE=/tmp/xiangqi-read-report.json \
pnpm --filter server staging:read-load
```

每次请求须为 200，session 须为 authenticated=true 且有用户 ID，大厅/历史须有 matches 数组。401、403、429、重定向、非法 JSON、传输超时和错误响应语义均失败。报告按路径保存 p50/p95/p99、错误率、429 比例。并发和轮数必须为范围内整数。

业务凭据文件是至少 `LOAD_PAIRS * 3` 个独立且已验证的隔离账号：

```json
[
  { "email": "load-red@example.test", "password": "isolated password" },
  { "email": "load-black@example.test", "password": "isolated password" },
  { "email": "load-observer@example.test", "password": "isolated password" }
]
```

```bash
ALLOW_STAGING_BUSINESS_LOAD=1 \
STAGING_ORIGIN=https://staging.example.com \
STAGING_ACCOUNTS_FILE=/secure/xiangqi-load-accounts.json \
LOAD_PAIRS=5 LOAD_ROUNDS=10 LOAD_P95_TARGET_MS=1000 \
LOAD_REPORT_FILE=/tmp/xiangqi-business-report.json \
pnpm --filter server staging:business-load
```

默认候选容量为 5 盘同时进行、15 个独立账号/WS，按 1、5、10、20 盘逐档执行，每档 10 轮，操作 p95 ≤ 1000ms、错误率和限流率均为 0。该数值是验收目标，不是已测得的生产容量。测试以五子棋短局覆盖登录、全体并发快速匹配、第三方订阅观战、聊天送达、交替走子、认输终局、双方历史和退出。三棋类端到端与移动端实际验收保留在 C 阶段。

须使用独立实例、数据库与空匹配队列；账号数不足、跨入外部匹配、命令失败、历史缺失、容量目标不达标均阻断。正常结束撤销会话；异常中断后的对局交给掉线补偿，测试数据保留在隔离库供排查，账号清理由环境负责人处理。

## 故障场景

`staging:faults` 顺序执行 database-outage、slow-query、pool-pressure、application-restart，每次一盘、三账号。开局走子后关闭测试 WS，调用 apply、verify，跨过掉线宽限再 recover；恢复后不发业务请求等待后台补偿，最后断言终局、revision 稳定及双方历史。任何适配器非零退出或断言失败阻断命令，recover 在 finally 中执行。

提供本机隔离 MySQL 代理以实际注入前三种故障。代理仅监听 127.0.0.1，上游仅连接本机 MySQL。只将隔离应用的 DATABASE_URL 指向代理端口，其他应用不受影响：

```bash
# 从 server 目录启动；共享下列环境变量给故障运行器。
export ALLOW_STAGING_BUSINESS_LOAD=1
export FAULT_PROXY_CONFIG=/tmp/xiangqi-fault-config.json
export FAULT_PROXY_STATS=/tmp/xiangqi-fault-stats.json
printf '%s\n' '{"mode":"normal","generation":"initial"}' > "$FAULT_PROXY_CONFIG"
FAULT_PROXY_PORT=13306 FAULT_MYSQL_PORT=3306 node scripts/staging-fault-proxy.mjs
```

代理模式：database-outage 拒绝/断开连接；slow-query 每次转发延迟 5 秒且使用背压；pool-pressure 暂扣 MySQL 握手 30 秒，占用应用连接获取位置。`staging-proxy-control.mjs verify` 必须观察到实际受影响的流量，不能仅验证配置已写入。应用重启可使用 `staging-app-supervisor.mjs`：设置 `FAULT_APP_CONFIG`、`FAULT_APP_STATS`、`FAULT_APP_COMMAND_FILE`（例如内容为 `["node","dist/index.js"]`）及 `FAULT_APP_CWD`，配置文件初值与代理相同，再从隔离环境启动 supervisor。它只停止自己创建的应用子进程，先 SIGTERM，10 秒后仍未退出才 SIGKILL。`staging-proxy-control.mjs apply/verify/recover application-restart` 控制停止、确认已退出和重新启动；恢复后的业务验收确认应用可用。现有部署也可以提供具有相同非零失败语义的适配器，不可用仅输出成功文本的占位命令。

钩子配置文件的每项是可执行文件与参数数组，不使用 shell 字符串。例如前三项使用：

```json
{
  "database-outage": {
    "apply": ["node", "scripts/staging-proxy-control.mjs", "apply", "database-outage"],
    "verify": ["node", "scripts/staging-proxy-control.mjs", "verify", "database-outage"],
    "recover": ["node", "scripts/staging-proxy-control.mjs", "recover", "database-outage"]
  }
}
```

按同样格式补 slow-query、pool-pressure；application-restart 使用同一控制脚本及 application-restart 参数，或使用部署适配器的绝对路径。缺少任一场景/阶段时命令直接失败，不跳过场景。

```bash
ALLOW_STAGING_BUSINESS_LOAD=1 \
STAGING_ORIGIN=https://staging.example.com \
STAGING_ACCOUNTS_FILE=/secure/xiangqi-load-accounts.json \
STAGING_FAULT_HOOKS_FILE=/secure/xiangqi-fault-hooks.json \
FAULT_DISCONNECT_GRACE_MS=60000 FAULT_RECOVERY_WAIT_MS=65000 \
LOAD_REPORT_FILE=/tmp/xiangqi-fault-report \
pnpm --filter server staging:faults
```

宽限参数必须与应用一致；恢复等待覆盖扫描和退避上限。每场景保存独立报告文件。现场还须保存代理 verify 证据、应用重启适配器日志及 DB/CPU/内存观测，才能作为 C 阶段开放依据。

## 自动回归入口

```bash
pnpm --filter server test
pnpm --filter server test:acceptance-tools
pnpm --filter client test
pnpm build
pnpm contract:check
```

`TEST_DATABASE_URL` 未配置时真实 MySQL 用例会 skip，不能据此声称事务故障验收已完成。当前执行证据见 `docs/reports/2026-09-07-reliability.md`。
