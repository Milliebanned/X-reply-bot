# Quick Start Guide

## Requirements

- Node.js 14+
- Chrome or Chromium
- Free Groq API key from console.groq.com

## Setup Steps

1. Get a Groq API key at https://console.groq.com (API Keys -> Create New API Key)
2. Create `.env` in the project root:

```
GROQ_API_KEY=your_key_here
GROQ_MODEL=mixtral-8x7b-32768
PORT=3000
```

3. Install and run the backend:

```bash
npm install
npm start
```

4. Load the extension in Chrome:
   - chrome://extensions -> enable Developer mode -> Load unpacked -> select the `extension` folder

5. Go to x.com, open the extension popup, paste a post's text, click Generate, pick a suggestion, review, and send.

## Rate Limits

Groq free tier is ~30 requests/min, which comfortably covers 200 replies in 2 hours (~1.7/min).

## Privacy

Your GROQ_API_KEY stays in your local `.env` (or Vercel environment variables) and is never committed to the repo.
