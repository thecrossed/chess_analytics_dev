# Opening Forgiveness MVP 简报

## 目标

这次工作的目标，是先搭出一个最小可运行版本，用来验证这条核心假设：

> 在开局前 15 步内，如果发生一次明显失误，不同开局对这类失误的“惩罚程度”可能不同。

当前版本的重点不是直接给出最终结论，而是先把一套可以反复运行、后续可以扩样本的分析管道跑通。

## 我是怎么做的

### 1. 建立输入清单

我新增了一个 manifest 文件：

- [opening_forgiveness_manifest.csv](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_manifest.csv)

它用来声明每盘棋对应的两个输入：

- `pgn_path`
- `eval_csv_path`

这样后面只要往 manifest 里继续加样本，就能重复运行整套分析。

### 2. 编写可复跑分析脚本

我新增了主脚本：

- [opening_forgiveness_pipeline.py](/Users/zhu/chess_analytics_dev/scripts/opening_forgiveness_pipeline.py)

这个脚本会自动完成以下步骤：

1. 读取 PGN 标签  
   提取 `WhiteElo`、`BlackElo`、`Result`、`TimeControl`、`ECO`、`Termination` 等信息。

2. 读取逐步评估 CSV  
   使用已有评估文件中的每步 `eval_gap`、`opening_name`、`opening_eco`、`side`、`move_number`。

3. 定义开局窗口  
   当前 MVP 只看前 15 步。

4. 定义 early mistake  
   把 `eval_gap` 转换成 `eval_gap_cp = eval_gap * 100`，再用以下阈值标记明显失误：
   - `75 cp`
   - `100 cp`
   - `150 cp`

5. 转成玩家级数据  
   每盘棋拆成两行：
   - 白方视角一行
   - 黑方视角一行

   每一行都会记录：
   - `opening_family`
   - `player_elo`
   - `opp_elo`
   - `time_control`
   - 前 15 步内是否犯错
   - 第一次犯错出现在第几步
   - 犯错大小
   - 最终得分

6. 按开局聚合  
   对每个开局计算：
   - `n_clean`
   - `n_error`
   - `score_clean`
   - `score_error`
   - `drop = score_clean - score_error`

7. 输出分层结果  
   额外按：
   - `elo_bucket`
   - `time_control`

   生成分层汇总。

8. 尝试回归分析  
   当前脚本会尝试估计：

```text
final_score ~ opening_family * early_mistake + player_elo + opp_elo + player_color + time_control
```

如果样本不够，报告中会明确说明无法估计。

## 当前输出了什么

本次运行已生成以下文件：

- [opening_forgiveness_analysis.csv](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_outputs/opening_forgiveness_analysis.csv)
- [opening_forgiveness_summary.csv](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_outputs/opening_forgiveness_summary.csv)
- [opening_forgiveness_by_elo.csv](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_outputs/opening_forgiveness_by_elo.csv)
- [opening_forgiveness_by_time_control.csv](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_outputs/opening_forgiveness_by_time_control.csv)
- [opening_forgiveness_sensitivity.csv](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_outputs/opening_forgiveness_sensitivity.csv)
- [opening_forgiveness_report.md](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_outputs/opening_forgiveness_report.md)

## 当前结果

### 样本情况

当前 manifest 里只有 1 盘样本棋，因此玩家级数据只有 2 行：

- 白方 1 行
- 黑方 1 行

这盘棋被识别为：

- `Sicilian Defense`

时间控制被归类为：

- `blitz`

### 主结果

当前主汇总表内容是：

| opening_family | n_games | n_clean | n_error | score_clean | score_error | drop |
|---|---:|---:|---:|---:|---:|---:|
| Sicilian Defense | 2 | 2 | 0 | 0.5 |  |  |

这意味着：

- 当前样本中没有任何一方在前 15 步内触发 `>=100cp` 的 early mistake
- 因此还没有 `error` 组
- 所以现在还不能比较 `score_clean` 和 `score_error`
- 也还不能判断某个开局是否“更耐错”

### 回归结果

当前回归没有跑出有效估计，原因是样本没有足够变化。  
报告中的原话是：

```text
Not enough variation to estimate the regression model.
```

## 现在这套结果说明了什么

当前阶段，最重要的成果不是“已经证明了书里的论点”，而是：

1. 分析流程已经打通  
   现在已经有一套可以重复执行的 MVP 管道。

2. 变量定义已经固定下来  
   包括：
   - 开局窗口 = 前 15 步
   - 失误阈值 = 75 / 100 / 150 cp
   - 结果指标 = 玩家视角最终得分

3. 输出结构已经搭好  
   后续扩充数据后，不需要重写流程，只需要追加样本并重跑。

## 当前局限

目前还不能把这版结果直接写进书里作为结论，主要因为：

1. 样本量极小  
   只有 1 盘棋，不足以做跨开局比较。

2. 开局差异尚未出现  
   当前只有一个开局家族，无法比较不同 opening。

3. 错误样本为空  
   目前没有任何 `>=100cp` 的前 15 步失误样本。

4. 失误定义仍是 MVP 版本  
   现在直接用 `eval_gap` 近似错误强度，还没有引入复杂度校正、胜率跌幅或后续恶化速度。

## 下一步建议

要让这项研究真正进入“可以支持章节论点”的阶段，下一步最关键的是补充样本。

优先建议：

1. 给 manifest 增加更多 PGN + eval CSV
2. 覆盖多个开局家族，而不是只有一个 opening
3. 尽量包含会出现明显早期失误的对局
4. 先凑出一版能够产生下面这张表的数据规模：

| opening | score_clean | score_error | drop |
|---|---:|---:|---:|

一旦这张表开始稳定出现跨开局差异，整章的核心论点就有机会真正站住。

## 一句话总结

当前我已经把“开局容错率”研究的 MVP 分析管道搭建并跑通，但现有样本还太少，结果目前只能说明流程可用，还不能说明哪些开局真的更耐错。
