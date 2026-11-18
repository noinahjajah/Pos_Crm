# Dockerfile เดียวของทุก service · เลือกด้วย build arg SERVICE (gateway / identity / catalog / payment / pos)
FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production SERVICE=${SERVICE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY shared.js ./
COPY ${SERVICE} ./${SERVICE}
USER node
WORKDIR /app/${SERVICE}
CMD ["node", "server.js"]
