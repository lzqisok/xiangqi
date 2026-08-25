# MySQL 实现与运维

## 第一批技术选择

- 数据库要求 MySQL 8.0.16 或更高版本；不把 SQL Server、MariaDB 当作兼容替代。
- 驱动采用 `mysql2`。SQL 只存在于 `server/src/repositories`、数据库基础设施和 migration 中，业务路由不直接操作连接池。
- migration 采用仓库内前向 SQL runner。文件名是不可变的 `NNNN_name.sql`，应用后保存 SHA-256 校验和；版本必须从 0001 连续递增。
- 不引入 ORM。Repository 接口保持数据库无关，当前只维护一套 MySQL 实现和迁移，不提供运行时多数据库切换。
- 应用启动不会执行 migration。发布流程必须先备份，再显式运行 `pnpm --filter server db:migrate`。
- 当前 JSON 对局库和 LAN 房间 Repository 保持原样；`ONLINE_DATABASE_ENABLED=false` 时不建立 MySQL 连接。

## 数据库约束与用户隔离

- 表统一使用 InnoDB、`utf8mb4` 和 `utf8mb4_0900_ai_ci`；内部 UUID、token hash 和规范化邮箱使用二进制或大小写敏感列。
- 时间存为 UTC `datetime(6)`，连接建立后设置 `time_zone='+00:00'`。
- JSON 列仍由领域 validator 校验，不把 MySQL JSON 类型当作业务 schema。
- MySQL 没有 PostgreSQL RLS。用户私有查询必须通过 Repository，并同时匹配可信 actor 派生的 `owner_user_id`；路由不得把客户端 `userId` 直接传入数据层。
- 部分唯一约束使用可空生成列实现，例如未离开的参与者席位和未使用的账号 token。
- MySQL 不支持可延迟约束触发器。跨表的 owner、红黑双方和 match/state revision 一致性由同一事务中的 Repository 校验，表内唯一键、外键和 CHECK 继续作为数据库兜底。
- MySQL 不允许有效参与者生成列或 CHECK 依赖同时带 `ON DELETE SET NULL` 的外键列，因此参与者和邀请使用人外键使用 `ON DELETE RESTRICT`。账号最终删除必须先在事务中匿名化参与者、清空邀请使用人引用，再删除用户；邀请的 `used_at` 事实继续保留。恢复演练会反向扫描 `user_id IS NULL AND anonymized_at IS NULL` 的异常记录。

## 环境配置

配置模板见 `server/.env.example`。服务端和 `db:*` 命令会加载 `server/.env`，进程中已显式提供的环境变量优先。配置解析会拒绝：

- 开启数据库但缺少 `DATABASE_URL`；
- 非 `mysql://` URL 和越界的连接池/超时；
- production 使用非 TLS 或回环数据库；
- test 使用非回环数据库，或数据库名没有 `test` 标识。

三套环境使用独立数据库账号和数据库，禁止把 production URL 复制到本地：

| 环境        | 数据库建议            | migration 行为            |
| ----------- | --------------------- | ------------------------- |
| development | `xiangqi_development` | 开发者显式执行            |
| test        | `xiangqi_test_*`      | 测试创建独立随机 database |
| production  | 独立托管 MySQL 8.0    | 发布任务使用迁移角色      |

应用会话设置 UTC、严格 SQL mode、查询 timeout 和 `MAX_EXECUTION_TIME`。生产应用、migration 和 backup 使用不同账号。

连接串示例为 `mysql://user:password@127.0.0.1:3306/xiangqi_development`。用户名或密码中的 `@`、`:`、`/`、`#` 等保留字符必须进行 URL 编码；原有 SQL Server 或 PostgreSQL 连接串不能直接改协议头复用。

## Migration 命令

```bash
pnpm --filter server db:status
pnpm --filter server db:migrate
pnpm --filter server db:check
```

`db:status` 和 `db:check` 不修改业务表。`db:migrate` 在固定连接上使用 `GET_LOCK` 串行化迁移，并拒绝未知版本或被修改的已应用文件。

MySQL DDL 会隐式提交，不能声称把整批 DDL 包在一个可回滚事务中。迁移文件因此只向前、按版本记录，初始建表使用 `IF NOT EXISTS` 允许在单条原子 DDL 成功后安全重跑。发布兼容窗口使用“扩展 schema → 部署兼容代码 → 切换写路径 → 后续版本清理”，不提供自动 down migration。

## 健康与关闭

- `GET /health/live` 不访问外部依赖。
- `GET /health/ready` 在数据库启用后要求 MySQL 版本至少为 8.0.16、不是 MariaDB、实例可写且 migration 版本精确匹配。
- SIGINT/SIGTERM 停止接收流量并等待 JSON Repository、房间、HTTP server 和 MySQL pool 一起关闭。

数据库错误统一转换为 `database_unavailable`、`unique_conflict`、`foreign_key_conflict`、`revision_conflict` 和 `not_found`，HTTP 接口在账号批次映射稳定状态码。

## 测试数据库

真实集成测试只接受 `TEST_DATABASE_URL`，并创建独立的 `xiangqi_test_<uuid>` database；测试账号需要 `CREATE/DROP DATABASE` 权限。每个测试完成后删除自己的 database，不清理开发库。未配置 MySQL 时，纯配置、migration 发现、事务、错误映射和 DTO 测试仍会执行，真实 MySQL 测试明确显示为 skip。

## 备份与恢复

备份任务使用独立只读的 `DATABASE_BACKUP_URL`：

```bash
DATABASE_BACKUP_URL='mysql://...' \
DATABASE_BACKUP_DIR='/dedicated/backup/path' \
pnpm --filter server db:backup
```

脚本通过权限为 0600 的临时 option file 调用 `mysqldump`，使用一致性快照并包含 routines、triggers 和 events；输出 gzip SQL、校验压缩包并生成 SHA-256。调度平台每天执行一次，外部存储保留 7 份日备和 4 份周备；仓库脚本不擅自删除备份。

恢复演练只能指向名称包含 `test` 或 `restore` 的空数据库：

```bash
DATABASE_RESTORE_URL='mysql://.../xiangqi_restore' \
DATABASE_BACKUP_FILE='/dedicated/backup/path/xiangqi-....sql.gz' \
ALLOW_RESTORE_VERIFY=1 \
pnpm --filter server db:restore:verify
```

恢复后会验证 migration 版本、账号/对局可读、participant 外键、match/state revision 和揭棋 JSON 基本结构。上线前仍须用真实备份执行一次并记录 RPO/RTO、样本对局投影结果和操作者；没有实际执行记录时不得勾选 TODO 的恢复演练项。
