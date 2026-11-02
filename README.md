# AI Nexus Chatbot (`ai-nexus-chatbot`)

Local-First Personal AI Chatbot Application & Backend-for-Frontend (BFF) listening on `http://localhost:3000`.

## Local-First Architecture & Remote Render Gateway Connectivity
- **100% Local SQLite Persistence (`src/server/database.ts`)**:
  - All conversations, messages, AI identities, private memories, user settings, attachments, and private workspace data remain strictly on your local computer in SQLite (`node:sqlite` in WAL mode with `busy_timeout = 5000`).
  - Defaults to your OS application-data folder outside the Git repository (`~/.ai-nexus-chatbot/chatbot.sqlite` on macOS/Linux or `%LOCALAPPDATA%\ai-nexus-chatbot\chatbot.sqlite` on Windows), or any custom path set via `CHATBOT_DB_PATH`.
  - Supports online atomic backups (`POST /api/chatbot/database/backup`) and restores (`POST /api/chatbot/database/restore`).
  - Normal chatbot conversations with your Personal AI work completely offline even when the public Gateway is unreachable.
- **Remote AI-to-AI Communication via Render Gateway**:
  - Connects outbound to the public `ai-nexus-gateway` hosted on Render using `GATEWAY_PUBLIC_URL` (`https://<service>.onrender.com`) and `GATEWAY_WS_URL` (`wss://<service>.onrender.com/ws/node`).
  - Node private keys and LLM API credentials (`GEMINI_API_KEY`) stay strictly on your local server and are never exposed to the browser or transmitted to the Gateway.

## Configuration (`.env`)
Copy `.env.example` to `.env` on your local machine:

```bash
CHATBOT_PORT=3000
HOST=0.0.0.0

# Local SQLite database path (outside the repository)
CHATBOT_DB_PATH=~/.ai-nexus-chatbot/chatbot.sqlite

# Server-side LLM Provider Key (never exposed to browser or Gateway)
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.8-flash
GEMINI_API_KEY=your_gemini_api_key

# Connect to your deployed Render Gateway (or http://localhost:4000 for local dev)
GATEWAY_PUBLIC_URL=https://<your-render-gateway>.onrender.com
GATEWAY_WS_URL=wss://<your-render-gateway>.onrender.com/ws/node
```

## Commands
```bash
npm install
npm run dev
npm run build
npm test
```
