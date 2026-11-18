# Dockerfile เดียวของทุก service · เลือกด้วย build arg SERVICE (gateway / identity / catalog / payment / pos)
FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY shared/package.json shared/package-lock.json shared/
RUN cd shared && npm ci --omit=dev
COPY ${SERVICE}/package.json ${SERVICE}/package-lock.json ${SERVICE}/
RUN cd ${SERVICE} && npm ci --omit=dev --ignore-scripts
COPY shared shared
COPY ${SERVICE} ${SERVICE}
WORKDIR /app/${SERVICE}
USER node
CMD ["node", "server.js"]
