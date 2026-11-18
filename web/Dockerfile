# เว็บ · build จากโฟลเดอร์บนสุดของ repo (npm workspaces)
#   dev   = Vite dev server :5173 (ใช้กับ docker-compose.dev.yml)
#   ปกติ  = nginx เสิร์ฟไฟล์ที่ build แล้ว :80

# ---- dev ----
FROM node:22-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --ignore-scripts --no-audit --no-fund -w web
COPY web web
WORKDIR /app/web
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]

# ---- build ----
FROM dev AS build
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
