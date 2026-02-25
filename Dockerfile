# Stage 1 — install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Stage 2 — production image
FROM oven/bun:1
WORKDIR /app

# System dependencies for Playwright Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Copy dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Install Playwright Chromium
RUN bunx playwright install chromium

# Copy application source
COPY package.json tsconfig.json ./
COPY bin/ ./bin/
COPY src/ ./src/
COPY plugins/ ./plugins/

# Pre-download HuggingFace embeddings model to avoid slow cold starts
RUN bun -e "\
const { pipeline } = require('@huggingface/transformers'); \
async function preload() { \
  console.log('Pre-downloading embeddings model...'); \
  await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'); \
  console.log('Model downloaded successfully.'); \
} \
preload().catch(console.error);"

# Create persistent data and config directories
RUN mkdir -p /data /root/.paw

# Environment defaults for Railway
ENV PAW_WEB_HOST=0.0.0.0
ENV PAW_DB_PATH=/data/paw.db
ENV PAW_PROVIDER=claude
ENV PAW_WEB_ENABLED=true
ENV PAW_WEB_TRUSTED_PROXY=true
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "bin/paw.ts", "start"]
