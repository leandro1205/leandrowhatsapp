FROM node:20-alpine

RUN apk add --no-cache tini curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY ./src ./src

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3     CMD curl -fsS http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
