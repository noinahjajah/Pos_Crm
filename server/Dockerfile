# Dockerfile กลางของทุก service ฝั่ง Node · เลือก service ด้วย build arg SERVICE

FROM node:22-alpine AS manifests
WORKDIR /src
COPY . .
RUN mkdir -p /out \
 && cp package.json package-lock.json /out/ \
 && for f in packages/*/package.json services/*/package.json; do \
      mkdir -p "/out/$(dirname "$f")" && cp "$f" "/out/$f"; \
    done

# ติดตั้งเฉพาะ dependency ของ service ที่เลือก
FROM node:22-alpine AS deps
ARG SERVICE
WORKDIR /app
COPY --from=manifests /out ./
RUN npm ci --omit=dev --workspace "services/${SERVICE}" --include-workspace-root=false --ignore-scripts

# image สำหรับรันจริง
FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared
COPY services/${SERVICE} ./services/${SERVICE}
WORKDIR /app/services/${SERVICE}
USER node
CMD ["node", "src/server.js"]
