FROM node:22-slim
WORKDIR /app
COPY server.js .
ENV NODE_ENV=production
USER node
CMD ["node", "server.js"]
