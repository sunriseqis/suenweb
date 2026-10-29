# syntax=docker/dockerfile:1
# 构建上下文是仓库根目录：docker build -f docker/Dockerfile .
# 阶段 1：前端构建（vite 产出到 public/）
FROM node:24-slim AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-fund --no-audit
COPY web ./web
RUN cd web && npm run build

# 阶段 2：后端依赖
FROM node:24-slim AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-fund --no-audit

# 阶段 3：运行镜像
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
# 前端产物（由阶段 1 生成，入镜像但不入 git）
COPY --from=web /build/public ./public
COPY --from=addon /build/addons/dist ./addons/dist
# 插件打包产物（构建阶段装 zip 打包；缺失时下载接口返回构建指引）
FROM node:24-slim AS addon
RUN apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/*
WORKDIR /build/addons
COPY addons/manifest.json addons/package.json ./
COPY addons/scripts ./scripts
COPY addons/src ./src
COPY addons/icons ./icons
RUN node scripts/pack.mjs
RUN useradd -r -u 10001 suenweb \
 && mkdir -p /data \
 && chown -R suenweb:suenweb /app /data
USER suenweb
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/server.ts"]
