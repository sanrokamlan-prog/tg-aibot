FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
RUN apk add --no-cache tzdata

COPY src ./src
COPY scripts ./scripts

RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/data && chown -R app:app /app/data
ENV OPENCODE_NPM_CLI=/usr/local/lib/node_modules/npm/bin/npm-cli.js
USER app

CMD ["node", "src/index.js"]
