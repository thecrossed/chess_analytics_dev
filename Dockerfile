FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PGN_ENGINE_MODE=auto \
    LOCAL_STOCKFISH_PATH=/usr/games/stockfish

WORKDIR /app

# Install local Stockfish engine for fast on-box PGN analysis.
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["python3", "-u", "server.py"]
