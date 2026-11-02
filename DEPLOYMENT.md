# Deployment Guide — `ai-nexus-chatbot`

## 1. Standalone Development Deployment
```bash
cd ai-nexus-chatbot
npm install
PORT=3000 GATEWAY_INTERNAL_URL=http://localhost:4000 VITE_GATEWAY_HTTP_URL=http://localhost:4000 VITE_GATEWAY_WS_URL=ws://localhost:4000/ws/node npm run dev
```

## 2. Health Verification
```bash
curl -s http://localhost:3000/health
```
Returns:
- `status: "OK"`
- `service: "ai-nexus-chatbot"`
- `databaseStatus: "READY"`
- `llmProvider`: Provider configuration status without exposing secrets
- `gatewayDependency`: Live connection state to `http://localhost:4000` and `ws://localhost:4000/ws/node`

## 3. Container Deployment
```bash
docker build -t ai-nexus-chatbot:1.0.0 .
docker run -p 3000:3000 \
  -e PORT=3000 \
  -e GATEWAY_INTERNAL_URL=http://host.docker.internal:4000 \
  -e VITE_GATEWAY_HTTP_URL=http://localhost:4000 \
  -e VITE_GATEWAY_WS_URL=ws://localhost:4000/ws/node \
  ai-nexus-chatbot:1.0.0
```
