FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY backend ./backend
COPY frontend ./frontend
COPY tests ./tests
USER node
CMD ["node", "backend/server.js"]
