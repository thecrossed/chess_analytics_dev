
# 国际象棋开局“容错率”数据验证方案（供 Codex 执行）

## 目标

从《Chapter 1：为什么你需要的不是更高级的开局，而是更不容易输的开局》中，抽取所有需要数据支持的核心主张，并转化为一套可执行的数据验证方案。  
本方案的目的不是一次性做完所有分析，而是先建立一个**最小可运行版本（MVP）**，验证“不同开局对相同级别失误的惩罚程度不同”这一核心论点。

---

## 一、需要数据验证的核心主张

以下内容都来自章节正文中“不能只靠直觉，需要数据支持”的部分。

### 主张 1：不同开局中，同样级别的失误，后果并不相同

书稿表达：

> 同样是一次明显失误，在不同开局中的后果并不一样。  
> 在某些开局中，一次失误之后，胜率会迅速崩塌。  
> 而在另一些开局中，同样级别的失误，胜率下降却相对有限。

需要验证的问题：

- 当失误强度相近时，不同开局的结果损失是否显著不同？
- 是否存在一些开局，在相同失误条件下，平均得分下降更少？
- 是否存在一些开局，在相同失误条件下，更容易快速崩盘？

---

### 主张 2：开局不仅影响局面质量，还影响错误的后果函数

书稿表达：

> 开局不仅影响局面质量，还影响错误的“后果函数”。  
> 有些开局会放大你的错误。  
> 有些开局会吸收你的错误。

需要验证的问题：

- 某个开局是否会让“同样大小的评价下降”转化成更大的结果损失？
- 某些开局中，失误后的局面是否更容易继续恶化？
- 某些开局中，失误后的局面是否更容易维持在“仍可竞争”的范围内？

---

### 主张 3：高容错开局会让棋手在失误后仍然保有生存空间

书稿表达：

> 高容错开局：你走得不精确，局面仍然可下。  
> 低容错开局：你稍有偏差，局面迅速崩塌。

需要验证的问题：

- 在失误发生后，一方是否仍然较常进入可竞争中局？
- 某些开局是否在失误后仍保留较高的平均得分？
- 某些开局是否在失误后更容易恢复到相对稳定的局面？

---

### 主张 4：普通棋手更应该关注“不要突然死掉”，而不是“理论上最强”

书稿表达：

> 不要只寻找最厉害的开局。  
> 要先寻找最不容易让你输掉的开局。

需要验证的问题：

- 对非顶级棋手而言，低失误惩罚的开局是否带来更稳定的实战结果？
- 在低中等级区间中，某些开局是否明显更“耐错”？
- 这种现象是否在快棋中更明显？

---

### 主张 5：容错率会随棋手水平和时间控制而变化

书稿表达：

> 同一个开局的容错率，会随着棋手水平和时间控制而变化。

需要验证的问题：

- একই开局在不同 Elo 区间中，失误后的结果损失是否不同？
- একই开局在 blitz、rapid、classical 中，失误惩罚是否不同？
- 某些开局是否在快棋中特别“致命”？

---

## 二、建议先验证的最核心问题

先不要把研究做得过大。  
建议第一轮只验证一个最关键的问题：

> **在开局前 15 步内，发生一次明显失误后，不同开局的平均得分下降是否不同？**

这是整章最重要、也最容易转化成图表和表格的核心分析。  
如果这个结论站得住，整章就有了坚实基础。

---

## 三、最小可运行版本（MVP）

### MVP 研究问题

在指定 Elo 区间、指定时间控制下：

- 某个开局中，若前 15 步内未出现明显失误，平均得分是多少？
- 若前 15 步内出现至少一次明显失误，平均得分是多少？
- 两者差值是多少？
- 不同开局之间，这个差值是否明显不同？

---

## 四、数据需求

Codex 需要准备或获取以下数据字段。

### 基础对局字段

- `game_id`
- `white_elo`
- `black_elo`
- `time_control`
- `result`  
  - 白胜 = 1-0
  - 和棋 = 1/2-1/2
  - 黑胜 = 0-1
- `moves_pgn`
- `opening_name`
- `opening_eco`
- `termination`（如果有）

### 引擎分析字段（可后处理生成）

对每步至少需要：

- `ply`
- `side_to_move`
- `eval_before`
- `eval_after_best`
- `eval_after_played`
- `centipawn_loss` 或等价指标
- 是否为 `blunder / mistake / inaccuracy`（如果已有）
- 最好保留 mate score 信息

### 可选增强字段

- `event_type`
- `rated_or_casual`
- `date`
- `platform`
- `opening_family`
- `subvariation`

---

## 五、关键变量定义建议

以下定义要先固定，否则后续分析会不断漂移。

### 1. 开局窗口

建议定义：

- **只分析前 15 步（即前 30 ply）**

理由：

- 本章关注“开局阶段”
- 超过这个范围后，中局因素会越来越强
- 15 步是兼顾样本量与“仍可称为开局”的折中方案

可做敏感性分析：

- 前 10 步
- 前 12 步
- 前 15 步

---

### 2. 明显失误（Primary Definition）

建议主定义：

> 在前 15 步内，某一方某一步的 `centipawn loss >= X`

其中 `X` 先设为：

- `100 cp`
- 并额外测试 `75 cp` 与 `150 cp`

这样可以做稳健性检验。

可选补充定义：

- 使用平台已有 `mistake / blunder` 标签
- 用 win probability drop 替代 centipawn loss
- 使用 normalized error（按局面复杂度或 eval 区间校正）

---

### 3. 结果指标

建议主指标：

> `score_from_player_perspective`

定义：

- 玩家最终赢 = 1
- 和棋 = 0.5
- 玩家最终输 = 0

说明：

- 必须从“犯错方视角”计算，而不是固定从白方视角

---

### 4. 失误后快速崩盘（可选第二阶段）

建议定义一个辅助标签：

> 失误发生后，在接下来 `N` 个 ply 内，评价继续恶化超过 `Y cp`

例如：

- `N = 6 ply`
- `Y = 100 cp`

这可以帮助验证“有些开局会放大错误”。

---

### 5. 可竞争中局（可选第二阶段）

定义建议：

> 前 15 步内发生失误后，到第 20 步或第 25 步时，局面评价仍未超过某个绝对阈值

例如：

- `abs(eval) <= 1.5`
- 或 `win probability` 仍未低于某阈值

这可以帮助验证“失误后是否仍可下”。

---

## 六、样本筛选建议

为了避免第一版分析被太多噪音污染，建议先限制样本。

### 方案 A：中等级快速对局（推荐首版）

- Elo 区间：`1400-2000`
- 时间控制：`rapid`
- 只保留 rated games
- 只分析主流开局家族
- 每个开局至少 `N >= 1000` 局

理由：

- 最接近目标读者
- 错误足够多，便于看差异
- 样本通常比较充足

### 方案 B：按 Elo 分层

分成：

- `1000-1400`
- `1400-1800`
- `1800-2200`

目的是验证“容错率随水平变化”。

### 方案 C：按时间控制分层

分成：

- `blitz`
- `rapid`
- `classical`

目的是验证“快棋是否更放大低容错开局的问题”。

---

## 七、开局分组建议

第一轮不要分析太细的分支。  
建议先按**开局家族**做。

例如：

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

可选做法：

- 先按 `opening_family`
- 第二轮再下钻到 `subvariation`

理由：

- 第一轮更稳
- 样本足
- 结论更适合写书中的大图景

---

## 八、核心分析流程

### 分析 1：基础得分下降比较（最重要）

对每个开局，计算：

- 未失误样本数
- 失误样本数
- 未失误平均得分
- 失误后平均得分
- 得分下降 = 两者差值

输出表：

| opening | n_clean | n_error | score_clean | score_error | drop |
|---------|--------:|--------:|------------:|------------:|-----:|

书稿可对应的表达：

- 哪些开局失误后得分跌幅最小？
- 哪些开局失误后得分跌幅最大？

---

### 分析 2：控制玩家水平与对手强弱

用回归模型验证：

`score ~ opening + error_flag + opening:error_flag + elo_self + elo_opp + color + time_control`

重点看：

- `opening:error_flag` 交互项

解释：

- 它代表“同样发生失误时，不同开局的额外惩罚差异”

如果需要更直观，也可以做：

- matching
- stratified analysis
- mixed effects model

但第一版线性模型 / logistic 模型已经够用。

---

### 分析 3：失误后是否更容易持续恶化

对于已发生失误的样本，比较不同开局中：

- 后续 6 ply / 10 ply 内评价继续恶化的概率
- 后续 6 ply / 10 ply 内转为大劣势的概率

输出表：

| opening | n_error | prob_further_collapse | mean_extra_drop |
|---------|--------:|----------------------:|----------------:|

对应书稿主张：

> 有些开局会放大错误。

---

### 分析 4：按 Elo 分层

对每个 Elo 区间分别重复分析 1。

输出：

| opening | elo_bin | score_clean | score_error | drop |
|---------|---------|------------:|------------:|-----:|

对应书稿主张：

> 同一个开局的容错率，会随着棋手水平变化。

---

### 分析 5：按时间控制分层

对 `blitz / rapid / classical` 分别重复分析 1。

输出：

| opening | time_control | score_clean | score_error | drop |
|---------|--------------|------------:|------------:|-----:|

对应书稿主张：

> 同一个开局的容错率，会随着时间控制变化。

---

## 九、建议输出的图表

为了后续写书，Codex 不应该只输出表格，还应输出图。

### 图 1：不同开局的“失误后得分下降”柱状图

- x 轴：opening
- y 轴：drop in score

用途：

- 最直观
- 最适合书里展示“容错率差异”

---

### 图 2：不同开局的“失误后平均得分”点图

- x 轴：opening
- y 轴：score_error

用途：

- 展示“犯错后还能活到什么程度”

---

### 图 3：按 Elo 分层的折线图

- x 轴：elo_bin
- y 轴：drop in score
- color：opening

用途：

- 展示容错率是否随水平变化

---

### 图 4：按时间控制分层的比较图

- x 轴：time_control
- y 轴：drop in score
- color：opening

用途：

- 展示 blitz 是否更惩罚低容错开局

---

## 十、统计注意事项

### 1. 不要只看 centipawn，要看结果

书的核心不是“评价降了多少”，而是：

> 这个错误会不会更容易把人送走

所以一定要保留**最终得分**这个指标。

---

### 2. 注意从玩家视角而不是白方视角分析

如果黑方犯错，也应按黑方得分记。  
否则指标会错位。

---

### 3. 避免极端小样本开局

首轮可设置阈值：

- 每个 opening 家族至少 `1000` 局
- 或至少 `500` 个失误样本

---

### 4. 同时报告样本量

任何“某开局更耐错”的结论，都必须附带：

- 总局数
- 失误样本数

---

### 5. 做稳健性检验

至少变动以下参数：

- 失误阈值：75 / 100 / 150 cp
- 开局窗口：10 / 12 / 15 步
- Elo 分层
- 时间控制分层

如果主要结论方向一致，书里就更有底气。

---

## 十一、推荐的执行顺序（给 Codex）

### Phase 1：搭建基础数据管道

1. 读取对局数据  
2. 解析 PGN / move list  
3. 识别 opening family  
4. 读取或生成每步引擎评估  
5. 生成每步 CPL  
6. 标记前 15 步内是否发生明显失误

---

### Phase 2：生成主表

对每局、每个玩家生成：

- 是否在前 15 步内犯错
- 犯错发生在哪一步
- 犯错强度
- 最终得分
- opening family
- elo bucket
- time control

---

### Phase 3：跑 MVP 结果

输出：

- 主表格
- 柱状图
- 简短文字结论

---

### Phase 4：做分层与稳健性检验

- 按 Elo 分层
- 按时间控制分层
- 按不同失误阈值重复

---

## 十二、建议 Codex 交付物

请让 Codex 最终输出以下内容：

### 1. 一个清洗后的分析数据表

例如：

- `opening_forgiveness_analysis.csv`

字段至少包括：

- `game_id`
- `player_color`
- `player_elo`
- `opp_elo`
- `time_control`
- `opening_family`
- `error_in_first_15`
- `error_ply`
- `error_cpl`
- `final_score`

---

### 2. 一个汇总表

例如：

- `opening_forgiveness_summary.csv`

至少包括：

- `opening_family`
- `n_games`
- `n_error_games`
- `score_clean`
- `score_error`
- `drop`

---

### 3. 图表文件

例如：

- `drop_by_opening.png`
- `score_error_by_opening.png`
- `drop_by_elo_bin.png`
- `drop_by_time_control.png`

---

### 4. 一个简短报告

例如：

- `opening_forgiveness_report.md`

内容包括：

- 数据来源
- 样本筛选条件
- 变量定义
- 主结果
- 稳健性检验
- 限制说明

---

## 十三、可以直接交给 Codex 的任务描述

下面这段可以直接复制给 Codex：

```text
Build a reproducible analysis pipeline to test whether different chess openings differ in how severely they punish similar early mistakes.

Goal:
Focus on the first 15 moves of the game. Measure whether making at least one clear mistake in that opening window leads to different drops in final score across opening families.

Please do the following:
1. Load game-level data with PGN/moves, player ratings, time control, result, and opening labels.
2. Obtain or compute engine evaluations for each ply.
3. Define an early mistake as a move within the first 15 moves that causes centipawn loss >= 100 cp. Also support sensitivity checks at 75 and 150 cp.
4. Create a player-level dataset from each game's perspective (white and black separately when needed), with:
   - opening_family
   - player_elo
   - opponent_elo
   - time_control
   - whether the player made an early mistake
   - first mistake ply
   - mistake size
   - final score from that player's perspective
5. For each opening family, compute:
   - number of clean games
   - number of error games
   - average score in clean games
   - average score in error games
   - score drop
6. Produce visualizations of score drop by opening family.
7. Run regression models that test whether the penalty of an early mistake differs by opening family, controlling for player elo, opponent elo, color, and time control.
8. Repeat the analysis by Elo bins and by time control.
9. Export:
   - cleaned analysis dataset
   - summary tables
   - plots
   - a markdown report describing the method, results, and limitations

Use clear, well-documented code and keep the pipeline easy to rerun.
```

---

## 十四、第一轮研究完成后的判断标准

如果第一轮结果显示以下现象之一，就说明这一章的核心论点已经站住了：

1. 不同开局的 `score drop after early mistake` 存在稳定差异  
2. 这种差异在控制 Elo、time control 后仍然存在  
3. 某些开局在多个设定下都表现出较低的失误惩罚  
4. 某些开局在 blitz 或中低分段中表现出特别高的失误惩罚

如果这些现象成立，那么书里关于“有些开局更耐错，有些开局更容易把你送走”的核心叙述，就不只是直觉，而是有数据支撑的论点。

---

## 十五、后续可扩展方向

如果 MVP 成功，后面可以继续做：

- 失误后的“持续恶化速度”分析
- 失误后的“可恢复率”分析
- 不同开局子类分支的比较
- 白方与黑方的容错率是否不同
- 某些体系是否特别适合某个 Elo 区间
- 容错率与复杂度、可控性、决胜性的关系

这些都可以作为后续章节的数据基础。

---

## 十六、当前最推荐的执行策略

不要一开始就做复杂模型。  
先跑出下面这张表：

| opening | score_clean | score_error | drop |
|---------|------------:|------------:|-----:|

如果这张表已经能清楚显示某些开局“更耐错”、某些开局“更致命”，那么整本书的第一章就已经有了非常强的骨架。

先把最核心的问题跑通，再往外扩展。
