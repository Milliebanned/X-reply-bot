# X Reply Copilot

An AI-powered reply copilot for X (Twitter) that helps you write replies faster. Get AI suggestions, review them, and post with one click. **Human-in-the-loop** — you approve every reply.

## Features

- Groq-powered reply suggestions (free API tier)
- Human-in-the-loop approval — no spam automation
- Fast inference (~1-2 sec per suggestion)
- Tone control (witty, helpful, critical, etc.)
- Copy/paste or auto-fill into reply box
- Free to run

## Stack

- Extension: Chrome/Firefox browser extension (Manifest V3)
- Backend: Node.js Express server (runs locally or on Vercel)
- AI: Groq API (free tier, ultra-fast inference)

## Setup

### 1. Install

```bash
npm install
```

### 2. Get Groq API Key

1. Visit console.groq.com
2. Sign up (free)
3. Go to API Keys, Create New API Key
4. Copy the key

### 3. Configure Backend

```bash
cp .env.example .env
# Edit .env and add your GROQ_API_KEY
```

### 4. Start Backend Server

```bash
npm start
# Server runs on http://localhost:3000
```

### 5. Load Extension in Chrome

1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked
4. Select the extension folder

## Compliance & Safety

- Human-in-the-loop: You approve every reply before it posts
- No spam automation: You're reviewing each one
- Not using the X API to post; you click send on X yourself

## License

MIT
