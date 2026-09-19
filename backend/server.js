require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// The extension's origin is a chrome-extension:// URL that differs per
// install, so there is no fixed origin to allow-list. The Groq key stays
// server-side; this endpoint is unauthenticated, so treat the deployment
// URL as semi-private.
app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function health(req, res) {
  res.json({
    status: 'ok',
    model: GROQ_MODEL,
    keyConfigured: Boolean(GROQ_API_KEY)
  });
}

// Both prefixes are registered: on Vercel, /api/* is routed by the
// functions layer and everything else arrives via the catch-all rewrite.
app.get('/health', health);
app.get('/api/health', health);

async function suggestReply(req, res) {
  const { postText, tone = 'natural', count = 2 } = req.body || {};

  if (!postText) {
    return res.status(400).json({ error: 'postText is required' });
  }

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' });
  }

  const systemPrompt = [
    'You write reply suggestions for posts on X (Twitter).',
    '',
    'Rules:',
    '- Produce exactly ' + count + ' distinct replies.',
    '- Each reply must be under 280 characters.',
    '- Tone: ' + tone + '.',
    '- Sound like a real person, not a brand. No hashtags, no emoji spam.',
    '- Say something of substance: a point, a question, a specific detail.',
    '- Output only a numbered list, one reply per line, e.g. "1. ..."'
  ].join('\n');

  try {
    const response = await axios.post(GROQ_API_URL, {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Write replies to this post:\n\n' + postText }
      ],
      temperature: 0.8,
      max_tokens: 500
    }, {
      headers: {
        Authorization: 'Bearer ' + GROQ_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });

    const content = response.data.choices[0].message.content;
    const suggestions = parseReplySuggestions(content);

    if (suggestions.length === 0) {
      return res.status(502).json({
        error: 'The model returned nothing usable',
        raw: content
      });
    }

    res.json({ suggestions, model: GROQ_MODEL, tone });
  } catch (error) {
    const status = error.response && error.response.status ? error.response.status : 500;
    const groqMessage =
      error.response &&
      error.response.data &&
      error.response.data.error &&
      error.response.data.error.message;

    console.error('Groq request failed:', status, groqMessage || error.message);

    const body = { error: groqMessage || error.message };
    if (status === 400 || status === 404) {
      body.hint =
        'GROQ_MODEL may name a retired model. Check the current model ids at console.groq.com.';
    }

    res.status(status).json(body);
  }
}

app.post('/api/suggest-reply', suggestReply);
app.post('/suggest-reply', suggestReply);

function parseReplySuggestions(text) {
  const suggestions = [];

  text.split('\n').forEach(function (line) {
    const match = line.match(/^\s*\d+[\.\)]\s+(.+)$/);
    if (match) {
      suggestions.push(stripQuotes(match[1]));
    }
  });

  // Fall back to paragraph splitting when the model ignores the numbering.
  if (suggestions.length === 0) {
    text.split('\n\n').forEach(function (chunk) {
      const cleaned = stripQuotes(chunk.replace(/^\s*[-*\d\.\)]+\s*/, ''));
      if (cleaned.length > 10) {
        suggestions.push(cleaned);
      }
    });
  }

  return suggestions.slice(0, 3);
}

function stripQuotes(text) {
  return text.trim().replace(/^["']|["']$/g, '').trim();
}

// Unmatched routes answer with JSON so the extension never has to parse an
// HTML error page.
app.use(function (req, res) {
  res.status(404).json({ error: 'No route for ' + req.method + ' ' + req.path });
});

app.use(function (err, req, res, next) {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

// Only listen when run directly; on Vercel the app is imported as a handler.
if (require.main === module) {
  app.listen(PORT, function () {
    console.log('X Reply Copilot backend running on http://localhost:' + PORT);
    console.log('Model: ' + GROQ_MODEL);
  });
}

module.exports = app;
