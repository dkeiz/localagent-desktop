FROM node:20-slim

# Install native build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package.json ./
RUN npm install --production

# Copy application source
COPY src/ ./src/
COPY agentin/ ./agentin/

# Create runtime directories
RUN mkdir -p \
    agentin/workspaces \
    agentin/memory/daily \
    agentin/memory/global \
    agentin/memory/images \
    agentin/memory/tasks \
    agentin/subtasks/runs \
    agentin/research/runs \
    agentin/workflows/runs \
    agentin/knowledge/staging \
    data

# Expose external test API port
EXPOSE 8788

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD node -e "const http = require('http'); http.get('http://localhost:8788/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Default: run in headless Docker mode (no Electron needed)
# Exposes an HTTP API at the configured port
CMD ["node", "src/main/docker-entry.js", "--external-port", "8788"]
