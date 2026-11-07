FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY live/ ./live/
COPY cloud/ ./cloud/
ENV NODE_ENV=production
USER node
CMD ["node", "cloud/server.js"]
