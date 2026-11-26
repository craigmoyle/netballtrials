FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS build

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm ci --workspace=@netball-trials/api --workspace=@netball-trials/types --include-workspace-root
RUN npm exec --workspace=@netball-trials/api -- prisma generate
RUN npm run build --workspace=@netball-trials/api

# Migration jobs retain the Prisma CLI and run one migration command per manual promotion.
FROM build AS api-migrate
ENV NODE_ENV=production
CMD ["npm", "exec", "--workspace=@netball-trials/api", "--", "prisma", "migrate", "deploy"]

# The long-running API image keeps only production dependencies.
FROM build AS api-runtime
# Prisma's optional peer reintroduces the CLI; the runtime only needs its generated client.
RUN npm prune --omit=dev \
  && npm uninstall --no-save --workspace=@netball-trials/api prisma \
  && test ! -e node_modules/.bin/prisma
ENV NODE_ENV=production
WORKDIR /app
EXPOSE 3000
USER node
CMD ["npm", "run", "start", "--workspace=@netball-trials/api"]
