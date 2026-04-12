# PGN Parquet + DuckDB Quickstart

这份说明对应下面这两个 parquet 文件：

- `game.parquet`
- `move.parquet`

它们由：

- [pgn_to_game_move_parquet.py](/Users/zhu/chess_analytics_dev/scripts/pgn_to_game_move_parquet.py)

生成，并通过 `game_id` 相连。

## 1. 先生成 parquet

全量跑法：

```bash
python3 scripts/pgn_to_game_move_parquet.py \
  data/lichess_perf_subsets/lichess_db_standard_rated_2026-03_downloaded_part_rapid.pgn \
  --output-dir data/pgn_parquet_rapid
```

小样本试跑：

```bash
python3 scripts/pgn_to_game_move_parquet.py \
  data/lichess_perf_subsets/lichess_db_standard_rated_2026-03_downloaded_part_rapid.pgn \
  --output-dir data/pgn_parquet_rapid_sample \
  --limit-games 10000
```

生成后目录通常会是：

```text
data/pgn_parquet_rapid/
  game.parquet
  move.parquet
```

## 2. DuckDB 直接查 parquet

如果本机还没装 `duckdb`：

```bash
pip install duckdb
```

### 最简单的 Python 连接

```python
import duckdb

con = duckdb.connect()

game_path = "data/pgn_parquet_rapid/game.parquet"
move_path = "data/pgn_parquet_rapid/move.parquet"
```

## 3. 常用查询示例

### 3.1 看总盘数

```python
result = con.execute("""
    SELECT COUNT(*) AS n_games
    FROM read_parquet(?)
""", [game_path]).fetchdf()

print(result)
```

### 3.2 看总步数

```python
result = con.execute("""
    SELECT COUNT(*) AS n_moves
    FROM read_parquet(?)
""", [move_path]).fetchdf()

print(result)
```

### 3.3 看不同 opening 的盘数

```python
result = con.execute("""
    SELECT opening, COUNT(*) AS n_games
    FROM read_parquet(?)
    GROUP BY 1
    ORDER BY n_games DESC
    LIMIT 20
""", [game_path]).fetchdf()

print(result)
```

### 3.4 看不同 time control 的盘数

```python
result = con.execute("""
    SELECT time_control, COUNT(*) AS n_games
    FROM read_parquet(?)
    GROUP BY 1
    ORDER BY n_games DESC
""", [game_path]).fetchdf()

print(result)
```

### 3.5 game 和 move 关联

查某个开局前 20 ply 的走法：

```python
result = con.execute("""
    SELECT
        g.game_id,
        g.opening,
        m.ply,
        m.color,
        m.san,
        m.uci
    FROM read_parquet(?) AS g
    JOIN read_parquet(?) AS m
      ON g.game_id = m.game_id
    WHERE g.opening = 'Sicilian Defense'
      AND m.ply <= 20
    ORDER BY g.game_id, m.ply
    LIMIT 200
""", [game_path, move_path]).fetchdf()

print(result)
```

### 3.6 查某个玩家的所有对局

```python
player = "MagnusCarlsen"

result = con.execute("""
    SELECT *
    FROM read_parquet(?)
    WHERE white = ? OR black = ?
    ORDER BY utc_date, utc_time
    LIMIT 100
""", [game_path, player, player]).fetchdf()

print(result)
```

### 3.7 查某盘棋的完整走法

```python
game_id = "lpypEdb8"

result = con.execute("""
    SELECT
        m.ply,
        m.move_number,
        m.color,
        m.san,
        m.uci,
        m.is_capture,
        m.is_check,
        m.is_checkmate
    FROM read_parquet(?) AS m
    WHERE m.game_id = ?
    ORDER BY m.ply
""", [move_path, game_id]).fetchdf()

print(result)
```

### 3.8 查每盘棋平均 ply

```python
result = con.execute("""
    SELECT AVG(moves_count) AS avg_ply
    FROM read_parquet(?)
""", [game_path]).fetchdf()

print(result)
```

### 3.9 查不同 Elo 桶的平均步数

```python
result = con.execute("""
    SELECT
        CASE
            WHEN white_elo < 1200 THEN '<1200'
            WHEN white_elo < 1600 THEN '1200-1599'
            WHEN white_elo < 2000 THEN '1600-1999'
            ELSE '2000+'
        END AS white_elo_bucket,
        AVG(moves_count) AS avg_ply,
        COUNT(*) AS n_games
    FROM read_parquet(?)
    GROUP BY 1
    ORDER BY 1
""", [game_path]).fetchdf()

print(result)
```

## 4. 把 parquet 注册成临时表

如果你要连续写很多 SQL，先注册会更顺手：

```python
con.execute("CREATE VIEW game AS SELECT * FROM read_parquet(?)", [game_path])
con.execute("CREATE VIEW move AS SELECT * FROM read_parquet(?)", [move_path])
```

之后就可以直接写：

```python
result = con.execute("""
    SELECT g.opening, COUNT(*) AS n_games
    FROM game AS g
    GROUP BY 1
    ORDER BY n_games DESC
    LIMIT 20
""").fetchdf()
```

## 5. 一个完整可运行例子

```python
import duckdb

con = duckdb.connect()

game_path = "data/pgn_parquet_rapid/game.parquet"
move_path = "data/pgn_parquet_rapid/move.parquet"

con.execute("CREATE VIEW game AS SELECT * FROM read_parquet(?)", [game_path])
con.execute("CREATE VIEW move AS SELECT * FROM read_parquet(?)", [move_path])

top_openings = con.execute("""
    SELECT opening, COUNT(*) AS n_games
    FROM game
    GROUP BY 1
    ORDER BY n_games DESC
    LIMIT 10
""").fetchdf()

sicilian_moves = con.execute("""
    SELECT g.game_id, m.ply, m.san
    FROM game AS g
    JOIN move AS m ON g.game_id = m.game_id
    WHERE g.opening = 'Sicilian Defense'
      AND m.ply <= 10
    ORDER BY g.game_id, m.ply
    LIMIT 50
""").fetchdf()

print(top_openings)
print(sicilian_moves)
```

## 6. 实用建议

- 第一版先只查 parquet，不急着把数据导入一个长期数据库。
- 大查询尽量先在 `game` 表过滤，再去 join `move` 表。
- 如果后面你要做 opening study，优先在 `game` 表上建你自己的派生表。
- 如果以后确定要频繁查局面级特征，再考虑给 `move` 表补 `fen_before` 或 `fen_after`。
