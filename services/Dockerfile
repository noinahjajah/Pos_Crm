# Dockerfile ของ gateway และ identity (ใช้ package.json กลางของ services/) · เลือกด้วย build arg SERVICE
FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production SERVICE=${SERVICE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY shared.js ./
COPY ${SERVICE} ./${SERVICE}
USER node
CMD ["sh", "-c", "node ${SERVICE}/server.js"]
