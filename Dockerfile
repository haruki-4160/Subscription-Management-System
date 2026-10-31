# RECUR SMS Production Dockerfile
FROM node:24-slim AS runner

WORKDIR /app

# Install dependencies required for native SQLite build
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY public/ ./public/

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/server.js"]
