# syntax=docker/dockerfile:1
# 构建上下文是仓库根目录：docker build -f docker/Dockerfile .
FROM node:24-slim AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-fund --no-audit

FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
RUN useradd -r -u 10001 suenweb \
 && mkdir -p /data \
 && chown -R suenweb:suenweb /app /data
USER suenweb
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/server.ts"]
