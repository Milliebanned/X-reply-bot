# Setup

## Requirements

- Chrome or Chromium
- git
- A free Groq API key from console.groq.com (only needed if you host the
  backend yourself)

## Install once

```bash
git clone https://github.com/Milliebanned/X-reply-bot.git ~/X-reply-bot
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `~/X-reply-bot/extension`

## Updating

Because the extension is loaded from a folder on disk, updates do not need
a re-download or a re-install. Keep the same folder and:

```bash
cd ~/X-reply-bot && git pull
```

Then:

1. Open `chrome://extensions`
2. Click the reload icon on the X Reply Copilot card
3. Close the x.com tab and open a new one

The third step matters. A content script already injected into an open tab
keeps running the old code after a reload, and only a fresh page load
replaces it. The popup header shows the version, so you can confirm which
build is live.

## Using it

On x.com, each post gets an **AI Reply** button next to its action bar.
Clicking it opens that post's reply box, generates one reply using your
saved tone and word limit, and inserts it for editing. Review it, change
whatever you want, then send it yourself.

Tone and max words are set in the extension popup and are saved
automatically.

## Giving it to someone else

Groq rate limits are per API key, not per deployment, so the thing to give
each person is their own key. They do not need their own backend.

Have them:

1. Install the extension as above
2. Get a free key at https://console.groq.com (API Keys, Create New API Key)
3. Paste it into **Your Groq API key** in the extension popup

From then on their replies are generated against their own quota, and
nothing they do eats into anyone else's. Leaving the field empty falls back
to the shared key, so the extension still works before they set one up.

The **Model** field is worth setting too. Which models a Groq account can
serve differs between accounts, so a model that works for you may not exist
for them. POST to `/api/models` with their key to see their own list:

```bash
curl -X POST https://xreply-six.vercel.app/api/models \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"gsk_their_key_here"}'
```

Keys travel with each request and are never stored or logged by the
backend. They do pass through it, so if someone would rather their key
never leave their machine, they should deploy their own copy (see
**Backend** above) and point `BACKEND_URL` in `extension/popup.js` and
`extension/background.js` at it.

A key in the extension is stored in that browser profile, so treat it like
any other saved credential: it is fine for a free Groq key, less fine for a
paid one on a shared computer.

## Backend

The extension talks to a small Express service that holds the Groq key.
A deployment already exists; `BACKEND_URL` in `extension/popup.js` and
`extension/background.js` points at it.

To run your own:

```bash
npm install
cp .env.example .env     # add your GROQ_API_KEY
npm start                # http://localhost:3000
```

Call `/api/models` to see which model ids your Groq key can serve, and set
`GROQ_MODEL` to one of them. Availability differs between accounts.

## Rate limits

Groq's free tier covers roughly 30 requests per minute, which is well above
200 replies in 2 hours (about 1.7 per minute).

## Privacy

`GROQ_API_KEY` lives in your local `.env` or in the host's environment
variables and is never committed. Post text is sent to Groq to generate the
reply. Nothing is posted to X by the extension; you send every reply
yourself.
