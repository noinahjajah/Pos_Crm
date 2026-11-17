# Dockerfile กลางของ backend · เลือก service ด้วย build arg SERVICE (gateway / identity / ...)
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
