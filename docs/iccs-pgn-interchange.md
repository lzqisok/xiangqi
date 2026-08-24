# ICCS PGN 棋谱交换设计

## 目标与规范来源

首版采用 XQBase 的 Chinese Chess PGN 规范，并固定使用 `Format "ICCS"` 的坐标着法。该格式显式定义了中国象棋棋谱标签、FEN 起始局面和 ICCS 坐标着法；坐标着法与项目内部使用的 UCI 四字符走法可以无歧义互转，也便于复用现有规则引擎逐手验证。

- Chinese Chess PGN: <https://www.xqbase.com/protocol/cchess_pgn.htm>
- ICCS move notation: <https://www.xqbase.com/protocol/cchess_move.htm>
- Chinese Chess FEN: <https://www.xqbase.com/protocol/cchess_fen.htm>

## 首版范围

- 只处理普通象棋的一条线性主线。
- 导出 `Game`、`Event`、`Result`、`FEN` 和 `Format` 标签。
- ICCS 着法使用 `H2-E2` 形式；导入后转成内部 `h2e2` 形式。
- 支持红方或黑方从任意合法 FEN 开始，并保持回合编号。
- 接受 `{...}` 块注释和 `;` 行注释，但导入后不保存注释。
- 结果限定为 `1-0`、`0-1`、`1/2-1/2` 或 `*`，标签与正文同时存在时必须一致。

## 安全与语义校验

导入不是字符串搬运。实现限制输入大小，解析并验证起始 FEN，再通过现有规则引擎从起始局面逐手重放；无法识别或不合法的着法会拒绝整份棋谱。重复标签、正文之后出现标签、缺失结果、结果之后继续走棋以及未闭合的注释或标签也会被拒绝。

揭棋不会进入此兼容层。其暗子身份与可见性需要公开、席位、裁判三层投影，继续使用独立的 `.jieqi.json` 和 `.jqseat` 格式。

## 暂不支持

- PGN 变例分支与注释持久化。
- CBR、XQF 等二进制或工具私有格式。
- 将普通棋谱导入后自动推断对局配置、双方名称或时间控制。

后续评估 CBR/XQF 时，需要先取得可公开使用的格式说明与固定测试语料，并单独确认版本差异、编码、校验和及版权边界；不通过猜测二进制字段来扩展本实现。
