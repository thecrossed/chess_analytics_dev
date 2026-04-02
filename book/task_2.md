# Opening Forgiveness 数据获取说明（给 Codex）

## 目标

为“Opening Forgiveness / 开局容错率”MVP 提供明确的数据获取路径，解决 Codex 不知道去哪里取样本的问题。  
本文件的目的不是解释研究结论，而是规定：

1. **允许使用哪些数据源**
2. **优先从哪里取样**
3. **第一轮应该抓什么范围的数据**
4. **如果数据太大或抓取失败，如何回退**
5. **如果没有现成评估文件，如何生成 eval 数据**

---

## 一、总体原则

Codex 不应该自行猜测样本来源。  
必须按以下优先级获取数据，并且在输出报告中明确说明：

- 使用了哪个数据源
- 抓取了什么时间范围
- 筛选了哪些条件
- 最终保留了多少局

第一轮目标不是覆盖全世界所有棋局，而是尽快得到一批**足以比较多个开局家族、且包含 clean/error 两组的样本**。

---

## 二、允许使用的数据源（按优先级）

### 优先级 1：Lichess 官方月度公开 PGN 数据库

首选来源：

- `https://database.lichess.org/standard/`

使用原则：

- 优先使用官方月度 PGN 数据库
- 只取 **standard rated games**
- 第一轮只取 **1 个月或若干个小时间片**
- 不要一上来下载过多月份
- 如果本地机器资源有限，先随机抽样或先过滤后处理

为什么优先：

- 数据量大
- 结构统一
- 适合做 opening family 比较
- 是正式研究最好的公开来源

---

### 优先级 2：Lichess API 导出少量对局

如果官方月度包太大、下载太慢、或不方便首轮快速验证，可退回使用 Lichess API 小批量抓取。

适用场景：

- 首轮只想抓一小批样本来验证流程
- 机器内存或磁盘不足以先处理大包
- 需要针对特定用户、特定 opening、特定时间控制做定向抓取

要求：

- 必须在报告中写明 API 抓取规则
- 必须记录每批样本的来源范围
- 不能混入来历不明的数据

---

### 优先级 3：Kaggle 小型国际象棋数据集（仅用于 smoke test）

这类数据只能用于：

- 快速调试代码
- 验证 manifest / parser / aggregation / plotting 是否正常
- 检查 pipeline 是否可跑通

不能直接作为正式研究主样本，除非用户明确允许。

使用限制：

- 只能用于 smoke test
- 一旦 pipeline 跑通，应尽快切回 Lichess 官方数据

---

## 三、第一轮推荐取样目标

Codex 第一轮不要追求“全量”，只追求“足够比较”。

### 目标用户区间

优先保留：

- `player Elo roughly 1200-2000`

原因：

- 更接近本书目标读者
- 更容易出现“正常人类失误”
- 容错率差异更容易显现

如果数据不足，可扩展到：

- `1000-2200`

---

### 时间控制

优先保留：

- `blitz`
- `rapid`

原因：

- 更贴近真实业余实战
- 失误更多
- 更容易产生 early mistake 样本

第一轮可以先不做 classical，或只作为附加样本。

---

### 对局类型

只保留：

- `rated`
- `standard`

尽量排除：

- casual
- variants
- correspondence
- puzzle-like或非标准格式

---

### 开局窗口

第一轮固定：

- **前 15 步**

也就是只关心：

- 前 15 步是否发生 early mistake
- 不需要先分析整盘棋所有错误

---

## 四、第一轮推荐覆盖的开局家族

第一轮不要钻到太细分支。  
先按 opening family 做。

至少尝试覆盖以下开局家族：

- Italian Game
- Ruy Lopez
- Sicilian Defense
- French Defense
- Caro-Kann Defense
- London System
- Queen's Gambit
- English Opening
- King's Indian Defense
- Scandinavian Defense

如果样本不足，可以先保证以下最核心的 6 个：

- Sicilian Defense
- French Defense
- Caro-Kann Defense
- Italian Game
- Ruy Lopez
- Queen's Gambit

---

## 五、首轮取样成功标准

Codex 不应该只下载数据，而要确认数据已经足够支持 MVP。

首轮成功标准建议设为：

1. 至少有 **多个 opening family**
2. 每个 opening family 至少有可用玩家级样本
3. 至少有若干 opening family 同时出现：
   - `clean group`
   - `error group`
4. 最终能输出这张表：

| opening | n_clean | n_error | score_clean | score_error | drop |
|---|---:|---:|---:|---:|---:|

如果还无法形成这张表，说明样本还不够，应该继续补样本，而不是过早写结论。

---

## 六、manifest 生成要求

Codex 应该自动生成或更新 manifest，而不是手动硬编码文件路径。

manifest 至少应包含：

- `game_id`（如果有）
- `pgn_path`
- `eval_csv_path`（如果已有）
- `source`
- `source_date_or_month`
- `opening_family`（如果抓取后可先填）
- `notes`

如果 `eval_csv_path` 还没有生成，可以先留空，并在后续步骤中补写。

---

## 七、如果没有现成 eval CSV，怎么办

如果样本只有 PGN，没有逐步评估 CSV，Codex 应自行生成。

### 推荐做法

1. 读取 PGN
2. 逐步回放前 15 步
3. 调用本地引擎（例如 Stockfish）
4. 对每个 ply 记录：
   - 当前执棋方
   - move number / ply
   - board FEN（可选）
   - played move
   - best move（可选）
   - eval before
   - eval after played
   - centipawn loss / eval gap
   - opening name / ECO（如果可识别）

### 最低要求

即使不记录 best move，也至少要生成：

- `ply`
- `side`
- `move_number`
- `eval_gap`
- `opening_name`
- `opening_eco`

### 注意

第一轮只需要覆盖：

- 前 15 步

不需要一开始就评估整盘棋。  
这样速度会快很多，也更符合 MVP 目标。

---

## 八、early mistake 的当前定义

Codex 应按当前 MVP 定义执行，不要自行改定义。

### 主定义

在前 15 步内：

- 若某一方某一步 `eval_gap_cp >= 100`
- 则记为一次 `early mistake`

### 稳健性阈值

同时支持：

- `75 cp`
- `100 cp`
- `150 cp`

输出中应保留不同阈值的结果，供后续 sensitivity analysis 使用。

---

## 九、从 PGN 到玩家级数据的要求

每盘棋至少拆成两行（必要时）：

- 白方视角
- 黑方视角

每一行应包含：

- `game_id`
- `player_color`
- `player_elo`
- `opp_elo`
- `time_control`
- `opening_family`
- `error_in_first_15`
- `first_error_ply`
- `first_error_cp`
- `final_score`

### final_score 的定义

必须从玩家视角出发：

- 玩家赢 = 1
- 和棋 = 0.5
- 玩家输 = 0

不能只固定从白方视角算，否则黑方数据会错位。

---

## 十、推荐的执行顺序

### Phase 1：烟雾测试（可选）

如果需要，先用小型样本做 smoke test：

- 验证 PGN 读取
- 验证 eval 生成
- 验证 manifest 更新
- 验证 summary 输出

完成后必须切到正式来源。

---

### Phase 2：正式样本抓取

优先从 Lichess 官方月度库抓取一小段时间范围。  
建议：

- 先抓 1 个月
- 如果样本仍不足，再继续加月份
- 不要一开始抓太大

---

### Phase 3：生成 eval 数据

如果没有现成 eval CSV：

- 自动对前 15 步做引擎评估
- 写出标准化 eval CSV
- 把路径回填到 manifest

---

### Phase 4：运行 opening forgiveness pipeline

运行现有分析脚本，生成：

- 玩家级分析数据
- opening family 汇总
- 按 Elo 分层汇总
- 按 time control 分层汇总
- sensitivity 表
- markdown 报告

---

### Phase 5：检查是否达到可比较状态

检查哪些 opening family 已经具备：

- 非空 clean 组
- 非空 error 组
- 足够的样本量

如果不足，继续补样本，而不是停止。

---

## 十一、Codex 必须输出的内容

### 1. 数据来源说明

必须明确写清：

- 使用的是哪一种数据源
- 抓取了哪一个月或哪几个批次
- 过滤条件是什么
- 保留了多少局
- 每个 opening family 有多少样本

---

### 2. manifest 文件

自动更新或新建：

- `opening_forgiveness_manifest.csv`

---

### 3. eval 文件（如需生成）

对每盘棋生成或补齐对应的：

- `eval_csv_path`

---

### 4. 分析输出

至少输出：

- `opening_forgiveness_analysis.csv`
- `opening_forgiveness_summary.csv`
- `opening_forgiveness_by_elo.csv`
- `opening_forgiveness_by_time_control.csv`
- `opening_forgiveness_sensitivity.csv`
- `opening_forgiveness_report.md`

---

### 5. 样本是否足够的判断

报告中必须明确说明：

- 哪些 opening family 已经可以比较
- 哪些 opening family 仍然缺少 error 样本
- 当前是否已经形成有意义的 `score_clean` vs `score_error` 对比

---

## 十二、不允许的行为

Codex 不应：

- 自行使用来历不清的数据源
- 混用未说明来源的数据
- 擅自修改“前 15 步”定义
- 擅自把 early mistake 阈值改掉
- 在样本明显不足时装作已经得到研究结论
- 跳过玩家视角得分转换

---

## 十三、建议直接交给 Codex 的执行说明

下面这段可以直接复制给 Codex：

```text
Use an explicit sample source. Do not guess where the games should come from.

Source priority:
1. Lichess official monthly PGN database for standard rated games
2. Lichess API for smaller batches if the monthly dump is too large for the first run
3. Kaggle small chess dataset only for smoke testing, not as the final research sample

Sampling target for the first meaningful run:
- standard rated games
- player Elo roughly 1200-2000
- blitz or rapid
- enough games across multiple opening families
- prioritize these opening families:
  Italian Game, Ruy Lopez, Sicilian Defense, French Defense, Caro-Kann Defense, London System, Queen's Gambit, English Opening, King's Indian Defense, Scandinavian Defense

If PGN is available but eval CSV is missing:
- generate move-by-move engine evaluations for the first 15 moves only
- compute eval_gap / centipawn loss per move
- save standardized eval CSV files
- update the manifest automatically

Then:
1. update or create the manifest
2. generate missing eval files
3. run the opening forgiveness pipeline
4. report sample counts by opening family
5. flag which openings have both clean and error groups
6. continue sampling if the summary table still has empty error groups for most openings

Do not claim the hypothesis is supported unless there is a real comparison across multiple opening families with non-empty error groups.
```

---

## 十四、当前最现实的策略

第一轮最现实的目标不是“证明一切”，而是：

> 尽快拿到一批可以让多个 opening family 同时出现 clean 组和 error 组的数据。

一旦这一步完成，第一章最关键的表就能开始出现：

| opening | score_clean | score_error | drop |
|---|---:|---:|---:|

这时，“开局容错率”就不再只是一个概念，而开始变成一个真正可比较的指标。
