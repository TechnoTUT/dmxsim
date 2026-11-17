FROM docker.io/library/node:22-alpine

WORKDIR /app

# 依存（three.js）だけ先に入れて、ソース変更時のビルドを速くする
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.mjs commons.svg ./
COPY public ./public
COPY config ./config

USER node
ENV NODE_ENV=production
EXPOSE 8080/tcp 6454/udp
CMD ["node", "server.mjs"]
