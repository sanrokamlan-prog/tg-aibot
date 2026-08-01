FROM node:25-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
RUN apk add --no-cache tzdata

COPY src ./src

RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/data && chown -R app:app /app/data
USER app

CMD ["node", "src/index.js"]
