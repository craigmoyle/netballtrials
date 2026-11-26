FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build

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
