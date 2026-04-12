# Rapid Parquet Profile Summary

数据来源：

- [game.parquet](/Users/zhu/chess_analytics_dev/data/pgn_parquet_rapid/game.parquet)
- [move.parquet](/Users/zhu/chess_analytics_dev/data/pgn_parquet_rapid/move.parquet)

基础规模：

- `game_rows = 4,444,199`
- `move_rows = 286,003,152`
- `avg_ply = 64.35`

## Top 20 Openings

| rank | opening | n_games |
|---:|---|---:|
| 1 | Queen's Pawn Game | 108,509 |
| 2 | Philidor Defense | 107,766 |
| 3 | Queen's Pawn Game: Accelerated London System | 92,808 |
| 4 | Caro-Kann Defense | 76,718 |
| 5 | Pirc Defense | 67,603 |
| 6 | Scandinavian Defense | 67,526 |
| 7 | Van't Kruijs Opening | 61,276 |
| 8 | Bishop's Opening | 56,321 |
| 9 | Queen's Pawn Game: Chigorin Variation | 54,618 |
| 10 | Four Knights Game: Italian Variation | 53,487 |
| 11 | Scotch Game | 50,343 |
| 12 | Sicilian Defense: Bowdler Attack | 49,335 |
| 13 | King's Pawn Game: Wayward Queen Attack | 48,474 |
| 14 | Scandinavian Defense: Mieses-Kotroc Variation | 47,264 |
| 15 | Indian Defense | 44,479 |
| 16 | Horwitz Defense | 43,849 |
| 17 | Modern Defense | 43,811 |
| 18 | Italian Game: Anti-Fried Liver Defense | 43,230 |
| 19 | French Defense: Knight Variation | 40,995 |
| 20 | Sicilian Defense: Old Sicilian | 39,326 |

## Result Distribution

| result | n_games |
|---|---:|
| 1-0 | 2,196,321 |
| 0-1 | 2,035,019 |
| 1/2-1/2 | 212,834 |
| * | 25 |

## Top Time Controls

| rank | time_control | n_games |
|---:|---|---:|
| 1 | 600+0 | 3,165,749 |
| 2 | 600+5 | 698,302 |
| 3 | 900+10 | 186,327 |
| 4 | 900+0 | 64,710 |
| 5 | 300+5 | 35,989 |
| 6 | 480+0 | 34,731 |
| 7 | 600+2 | 30,893 |
| 8 | 600+3 | 29,499 |
| 9 | 420+2 | 20,811 |
| 10 | 420+3 | 17,504 |
| 11 | 1200+0 | 14,461 |
| 12 | 480+2 | 12,542 |
| 13 | 900+5 | 9,451 |
| 14 | 600+10 | 9,163 |
| 15 | 900+3 | 7,994 |
| 16 | 420+5 | 7,582 |
| 17 | 600+1 | 7,556 |
| 18 | 300+8 | 7,218 |
| 19 | 300+7 | 7,013 |
| 20 | 480+3 | 6,685 |

## Elo Distribution

这里按双方平均 Elo 做 `200` 分桶。

| elo_bucket | n_games |
|---|---:|
| <800 | 183,153 |
| 800-999 | 377,711 |
| 1000-1199 | 591,711 |
| 1200-1399 | 769,629 |
| 1400-1599 | 876,359 |
| 1600-1799 | 814,722 |
| 1800-1999 | 566,595 |
| 2000-2199 | 212,119 |
| 2200-2399 | 43,875 |
| 2400-2599 | 5,599 |
| 2600-2799 | 653 |
| 2800+ | 2,073 |

## Quick Takeaways

- 这批 rapid 数据里，`600+0` 是绝对主流 time control。
- Elo 主体集中在 `1200-1999`，尤其是 `1400-1799`。
- 和棋比例不高，远低于白胜和黑胜。
- opening 名称仍然比较“原始 PGN 标签化”，如果要做研究，后续更适合再聚合成 opening family。
