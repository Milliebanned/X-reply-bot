require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: [
    'chrome-extension://*',
    'http://localhost:3000'
  ]
}));
app.use(express.json());

// Groq API configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'mixtral-8x7b-32768';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Generate reply suggestions
app.post('/api/suggest-reply', async (req, res) => {
  try {
    const { postText, tone = 'natural', count = 2 } = req.body;

    if (!postText) {
      return res.status(400).json({ error: 'postText is required' });
    }

    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
    }

    // Call Groq API
    const response = await axios.post(GROQ_API_URL, {
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a helpful AI assistant that generates reply suggestions for posts on X (Twitter).

Guidelines:
- Generate ${count} different reply options
- Keep replies concise (under 280 characters)
- Match the tone: ${tone}
- Be engaging and authentic
- Don't be spammy or overly promotional
- Format each suggestion on a new line, numbered 1. 2. 3. etc.`
        },
        {
          role: 'user',
          content: `Generate ${count} reply suggestions for this X post:\n\n"${postText}"`
        }
      ],
      temperature: 0.7,
      max_tokens: 500
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // Parse the response
    const content = response.data.choices[0].message.content;
    const suggestions = parseReplySuggestions(content);

    res.json({
      suggestions,
      model: GROQ_MODEL,
      tone
    });
  } catch (error) {
    console.error('Error calling Groq API:', error.response?.data || error.message);
    res.status(500).json({
      error: error.response?.data?.error?.message || error.message
    });
  }
});

// Train model on user's voice (optional future feature)
app.post('/api/train-voice', async (req, res) => {
  try {
    const { pastPosts } = req.body;

    if (!pastPosts || pastPosts.length === 0) {
      return res.status(400).json({ error: 'pastPosts array required' });
    }

    res.json({
      status: 'training_data_received',
      postsCount: pastPosts.length,
      message: 'Your voice profile has been updated'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Parse numbered suggestions from response
function parseReplySuggestions(text) {
  const lines = text.split('\n');
  const suggestions = [];

  lines.forEach(line => {
    const match = line.match(/^\d+[\.\)]\s+(.+)$/);
    if (match) {
      suggestions.push(match[1].trim());
    }
  });

  if (suggestions.length === 0) {
    const chunks = text.split('\n\n').filter(s => s.trim());
    chunks.forEach(chunk => {
      const cleaned = chunk.replace(/^\d+[\.\)]\s*/, '').trim();
      if (cleaned && cleaned.length > 10) {
        suggestions.push(cleaned);
      }
    });
  }

  return suggestions.slice(0, 3);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server (skip when running as a Vercel serverless function)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`X Reply Copilot backend running on http://localhost:${PORT}`);
    console.log(`Groq Model: ${GROQ_MODEL}`);
  });
}

module.exports = app;
