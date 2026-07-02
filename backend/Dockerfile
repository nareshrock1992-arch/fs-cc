FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer-cached separately from source)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "server.js"]
