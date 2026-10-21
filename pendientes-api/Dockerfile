FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

RUN mkdir -p /data && chown -R node:node /app /data

USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
