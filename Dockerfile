FROM node:22-bookworm-slim

WORKDIR /app

# Install Linux tools needed by Sandbox execution, GitHub/ZIP ops, and healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* bun.lock* ./
RUN npm ci || npm install

COPY . .

RUN npm run build && \
    mkdir -p /app/data /tmp/aetherflow_sandboxes /tmp/aetherflow_projects

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["./node_modules/.bin/tsx", "server.ts"]
