# Stage 1: Build
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Enable corepack and install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace configuration and dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.base.json ./
COPY scripts/preinstall.mjs ./scripts/
COPY lib ./lib
COPY artifacts ./artifacts

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all packages
RUN pnpm run build

# Stage 2: Production
FROM node:24-bookworm-slim AS runner

WORKDIR /app

# Install pnpm and nginx
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y nginx bash && rm -rf /var/lib/apt/lists/*

# Setup Nginx configuration
RUN rm /etc/nginx/sites-enabled/default || true
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy everything from builder since this is a mono-repo and pnpm workspace is needed.
COPY --from=builder /app /app

# The prompt says: Copy kg-engine/dist to /app/public
RUN mkdir -p /app/public && cp -r /app/artifacts/kg-engine/dist/* /app/public/

COPY docker/start.sh /app/docker/start.sh
RUN chmod +x /app/docker/start.sh

EXPOSE 80

CMD ["bash", "/app/docker/start.sh"]
