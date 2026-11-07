FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

# 不用 root 執行；資料目錄先建好並交給 node，具名 volume 會沿用這個擁有者
RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
