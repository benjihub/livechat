# Payment Assistant + LiveChat Bot

A Node.js backend with Express, a polling LiveChat bot (`newtest3.js`), and a simple dashboard/bridge (`test.html`).

## Scripts
- `npm start` – runs server and bot orchestrator (`run-all.js`).
- `node server.js` – start server only.
- `node newtest3.js` – start bot only.

## Environment
Create `.env` with:
```
PORT=3001
LIVECHAT_ACCESS_TOKEN=... # Agent Bearer token
FORCE_LIVECHAT_BEARER=true
BOT_SECRET=change-me
USE_OPENAI=false
OPENAI_API_KEY=...
```

## Endpoints
- `POST /send-message` – ingest visitor message `{ chatId, message, userId }` (requires `x-bot-secret` if BOT_SECRET set)
- `GET /api/chats` – list chats
- `GET /api/chats/:chatId/messages` – list messages

## LiveChat bridge
In `test.html`, a bridge posts visitor messages to `/send-message`. Set `window.__BOT_ENDPOINT__` and `window.__BOT_SECRET__` accordingly.

## GitHub
Initialize and push:
```
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
