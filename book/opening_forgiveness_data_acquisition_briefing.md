# Opening Forgiveness 数据获取与首轮样本简报

## 这轮做了什么

这轮工作的目标，是把 task_2 里要求的“明确数据来源 + 自动更新 manifest + 缺失 eval 自动补齐 + 重跑分析”真正落地，而不是只停留在说明层。

本次我完成了 4 件事：

1. 扩展 manifest 结构  
   现在的 manifest 不再只记录文件路径，还会记录：
   - `source`
   - `source_date_or_month`
   - `opening_family`
   - `notes`

2. 新增 Lichess API 采样脚本  
   新文件：
   - [opening_forgiveness_fetch_lichess_api.py](/Users/zhu/chess_analytics_dev/scripts/opening_forgiveness_fetch_lichess_api.py)

   它会：
   - 从 Lichess API 小批量抓取 PGN
   - 把 PGN 保存到本地
   - 自动把来源和采样说明写入 manifest

3. 新增缺失 eval 批处理脚本  
   新文件：
   - [opening_forgiveness_eval_batch.py](/Users/zhu/chess_analytics_dev/scripts/opening_forgiveness_eval_batch.py)

   它会：
   - 扫描 manifest
   - 找出还没有 `eval_csv_path` 的 PGN
   - 用本地 `stockfish` 对前 15 步窗口对应的 30 ply 做逐步评估
   - 自动生成标准化 eval CSV 并回填 manifest

4. 用增强版 manifest 重跑 opening forgiveness pipeline  
   主分析脚本仍然是：
   - [opening_forgiveness_pipeline.py](/Users/zhu/chess_analytics_dev/scripts/opening_forgiveness_pipeline.py)

## 这次实际使用了什么数据源

本次真实样本来源是：

- `Lichess API`

没有使用 Kaggle，也没有混入来源不明的数据。

### 采样方式

这次为了优先验证“真实来源抓样本 -> 生成 eval -> 跑分析”的整条链路，先使用了小批量 API 抓取，而没有直接上官方月度大包。

本次尝试的公开账号有：

- `lichess`
- `thibault`
- `DrNykterstein`
- `MagnusCarlsen`

其中实际抓取成功的账号是：

- `thibault`
- `DrNykterstein`

### 当前保留样本

当前 manifest 中共有 9 盘棋：

- 1 盘本地仓库样本
- 8 盘来自 `Lichess API`

对应文件见：

- [opening_forgiveness_manifest.csv](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_manifest.csv)

## 过滤与处理逻辑

这轮保持了 task_2 里的 MVP 口径，没有擅自改定义。

### 数据过滤

Lichess API 抓取时使用的条件是：

- `rated=true`
- `standard=true`
- `perfType=blitz,rapid`

### 评估范围

缺失 eval 时，使用本地 `stockfish` 只生成：

- 前 30 ply

这正好对应研究里“前 15 步”的 opening window。

### early mistake 定义

仍然使用当前 MVP 主定义：

- 前 15 步内，若某玩家有一步 `eval_gap_cp >= 100`
- 则记为一次 early mistake

并保留稳健性阈值：

- `75 cp`
- `100 cp`
- `150 cp`

## 当前样本覆盖到哪些 opening family

根据当前汇总表，已经覆盖 6 个 opening family：

- `Benoni Defense`
- `English Opening`
- `Nimzo-Larsen Attack`
- `Queen's Pawn Game`
- `Scandinavian Defense`
- `Sicilian Defense`

对应汇总文件：

- [opening_forgiveness_summary.csv](/Users/zhu/chess_analytics_dev/book/opening_forgiveness_outputs/opening_forgiveness_summary.csv)

## 哪些 opening 已经具备 clean/error 两组

当前已经进入“可比较状态”的 opening family 有 4 个：

| opening_family | n_clean | n_error | drop |
|---|---:|---:|---:|
| Benoni Defense | 2 | 2 | 0.000 |
| English Opening | 1 | 1 | -1.000 |
| Scandinavian Defense | 1 | 1 | 1.000 |
| Sicilian Defense | 3 | 3 | -0.333 |

这意味着：

- 这 4 个 opening 已经同时出现了 clean 组和 error 组
- MVP 的核心表已经开始形成
- 但样本量仍然非常小，不能把这些数值当成稳定结论

## 哪些 opening 还缺少 error 样本

当前仍然只有 clean 组、还没有 error 组的 opening family 是：

| opening_family | n_games | n_clean | n_error |
|---|---:|---:|---:|
| Nimzo-Larsen Attack | 2 | 2 | 0 |
| Queen's Pawn Game | 2 | 2 | 0 |

这说明：

- 这些 opening 目前还不能参与真正的 `score_clean` vs `score_error` 比较
- 需要继续补样本，而不是提前写结论

## 当前结果说明什么

这轮最重要的成果，不是“已经证明哪个开局更耐错”，而是：

1. 真实来源数据获取已经打通  
   现在不是只有 repo 里的单盘样本，而是已经有一条真实可重复的数据链路。

2. manifest 已经能承载正式研究信息  
   数据来源、月份、opening family、说明信息现在都会被记录下来。

3. 缺失 eval 已经能自动补齐  
   不需要再手工给每盘棋单独生成逐步评估。

4. 已经开始出现可比较 opening  
   虽然样本很少，但 summary 表已经不再是“全部没有 error 组”的状态。

## 当前限制

这一轮仍然有几个明显限制：

1. 样本量太小  
   现在只有 9 盘，远远不够形成稳健研究结论。

2. 用户层面没有按目标 Elo 严格筛选  
   这轮优先解决的是“来源明确、流程跑通”，还没有把样本严格压到 `1200-2000` 的目标区间。

3. opening 分布还很稀  
   某些 opening 只有 1 个 clean 和 1 个 error，波动会非常大。

4. 还没有使用 Lichess 官方月度大样本  
   目前采用的是 task_2 明确允许的 API 小批量回退路径，不是最终研究级主样本。

## 下一步最推荐的动作

如果要继续朝“可以支持章节论点”的方向推进，下一步建议是：

1. 继续用明确来源补样本  
   优先继续扩充：
   - `Sicilian Defense`
   - `French Defense`
   - `Caro-Kann Defense`
   - `Italian Game`
   - `Ruy Lopez`
   - `Queen's Gambit`

2. 尽量让更多 opening 同时具备 clean/error 两组

3. 把采样逐步拉近目标用户区间  
   尽量增加更接近 `1200-2000` 的样本来源，而不是继续堆高水平账号。

4. 等 API 小批量流程足够稳定后，再考虑切到 Lichess 官方月度库

## 一句话总结

task_2 这一轮已经把“数据获取 -> manifest 更新 -> eval 生成 -> 分析重跑”整条链路跑通，并拿到了第一批真实来源样本；现在已经出现多个可比较 opening，但样本量仍然太小，只能说明研究开始成形，还不能说明结论已经站稳。
