# Dockerfile เดียวของทุก service (build จากโฟลเดอร์บนสุดของ repo) · เลือกด้วย build arg SERVICE
FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w services/shared -w services/${SERVICE}
WORKDIR /app/services/${SERVICE}
USER node
CMD ["node", "server.js"]
