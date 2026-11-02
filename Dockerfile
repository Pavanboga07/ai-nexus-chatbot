FROM node:22-alpine

WORKDIR /app/ai-nexus-chatbot

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0
ENV GATEWAY_INTERNAL_URL=http://ai-nexus-gateway:4000
ENV VITE_GATEWAY_HTTP_URL=http://localhost:4000
ENV VITE_GATEWAY_WS_URL=ws://localhost:4000/ws/node

CMD ["npx", "tsx", "src/server/chatbotMain.ts"]
