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

const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();
const GROQ_MODEL = (process.env.GROQ_MODEL || '').trim() || 'openai/gpt-oss-20b';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

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

// Lists the models this API key can actually call, so a rejected model id
// can be replaced with a real one instead of guessed at.
async function listModels(req, res) {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' });
  }

  try {
    const response = await axios.get(GROQ_BASE_URL + '/models', {
      headers: { Authorization: 'Bearer ' + GROQ_API_KEY },
      timeout: 20000
    });

    const available = (response.data.data || [])
      .map(function (model) { return model.id; })
      .sort();

    res.json({ current: GROQ_MODEL, available: available });
  } catch (error) {
    const status = error.response && error.response.status ? error.response.status : 500;
    const groqMessage =
      error.response &&
      error.response.data &&
      error.response.data.error &&
      error.response.data.error.message;

    res.status(status).json({ error: groqMessage || error.message });
  }
}

app.get('/api/models', listModels);
app.get('/models', listModels);

// X hard-caps a post at 280 characters, so anything much past 60 words is
// unusable regardless of what the client asks for.
function clampMaxWords(value) {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return 40;
  return Math.min(60, Math.max(5, parsed));
}

// Terms the user has banned. Normalised here rather than trusted from the
// client: the list is pasted by hand, so it arrives with duplicates, blanks
// and stray casing.
function parseBannedWords(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\n]/);
  const seen = Object.create(null);
  const terms = [];

  raw.forEach(function (item) {
    const term = String(item).trim().toLowerCase();
    if (!term || term.length > 40 || seen[term]) return;
    seen[term] = true;
    terms.push(term);
  });

  return terms.slice(0, 40);
}

// Matches on word boundaries so banning "sounds" does not also reject
// "soundscape", while still catching multi-word phrases.
function findBannedTerm(text, terms) {
  for (let i = 0; i < terms.length; i++) {
    const escaped = terms[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])', 'i').test(text)) {
      return terms[i];
    }
  }
  return null;
}

function firstBannedTerm(suggestions, terms) {
  if (terms.length === 0) return null;

  for (let i = 0; i < suggestions.length; i++) {
    const hit = findBannedTerm(suggestions[i], terms);
    if (hit) return hit;
  }
  return null;
}

async function generateSuggestions(payload, count) {
  let response;

  try {
    response = await callGroq(payload);
  } catch (error) {
    // Retry without the tuning parameter if this model rejects it, rather
    // than failing the request outright.
    if (isBadParameter(error) && payload.reasoning_effort) {
      const retry = Object.assign({}, payload);
      delete retry.reasoning_effort;
      response = await callGroq(retry);
    } else {
      throw error;
    }
  }

  const message = response.data.choices[0].message;

  // Some reasoning models put the answer under `reasoning` when `content`
  // comes back empty.
  const content = message.content || message.reasoning || '';

  return {
    suggestions: parseReplySuggestions(content, count).map(stripTells).filter(Boolean),
    content: content,
    finishReason: response.data.choices[0].finish_reason
  };
}

async function suggestReply(req, res) {
  const { postText, tone = 'natural', count = 2 } = req.body || {};
  const maxWords = clampMaxWords(req.body && req.body.maxWords);
  const banned = parseBannedWords(req.body && req.body.bannedWords);

  if (!postText) {
    return res.status(400).json({ error: 'postText is required' });
  }

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' });
  }

  const single = count === 1;

  // Kept short deliberately: every token here is read before generation
  // starts, so a long preamble costs latency on every single reply.
  const rules = [
    'You write replies to posts on X.',
    single ? 'Write exactly one reply.' : 'Write ' + count + ' distinct replies.',
    'At most ' + maxWords + ' words, under 280 characters.',
    'Tone: ' + tone + '.',
    'Sound like a person, not a brand. No hashtags.',
    'Never use em dashes or en dashes. Use a comma or a full stop.'
  ];

  if (banned.length > 0) {
    rules.push('Never use these words or phrases: ' + banned.join(', ') + '.');
  }

  rules.push(
    single
      ? 'Output the reply text only, with no quotes or preamble.'
      : 'Output a numbered list, one reply per line.'
  );

  const payload = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: rules.join('\n') },
      { role: 'user', content: postText }
    ],
    temperature: 0.8,
    max_tokens: Math.min(1200, 120 + count * maxWords * 4)
  };

  // gpt-oss models reason before answering. Left at the default effort they
  // are slow, and the reasoning can consume the whole token budget and leave
  // message.content empty - which is what surfaced as a reply that returned
  // nothing. Low effort keeps them brief and quick.
  if (GROQ_MODEL.indexOf('gpt-oss') !== -1) {
    payload.reasoning_effort = 'low';
  }

  const startedAt = Date.now();

  try {
    let result = await generateSuggestions(payload, count);
    let hit = firstBannedTerm(result.suggestions, banned);
    let regenerated = false;

    // Naming the offending term works far better than repeating the list,
    // and one extra call is the most latency worth spending on this.
    if (hit && result.suggestions.length > 0) {
      const secondPayload = Object.assign({}, payload, {
        temperature: 0.95,
        messages: payload.messages.concat([
          { role: 'assistant', content: result.suggestions[0] },
          {
            role: 'user',
            content:
              'You used the banned word "' + hit + '". Rewrite completely, ' +
              'avoiding it and every other banned word. Output the reply only.'
          }
        ])
      });

      const second = await generateSuggestions(secondPayload, count);

      if (second.suggestions.length > 0) {
        regenerated = true;
        // Keep the retry only if it is actually clean, otherwise the first
        // attempt is no worse.
        if (!firstBannedTerm(second.suggestions, banned)) {
          result = second;
          hit = null;
        } else {
          hit = firstBannedTerm(second.suggestions, banned);
          result = second;
        }
      }
    }

    if (result.suggestions.length === 0) {
      return res.status(502).json({
        error: 'The model returned nothing usable',
        hint: 'A reasoning model may have spent its token budget thinking. Try a smaller model via GROQ_MODEL.',
        raw: result.content.slice(0, 200),
        finishReason: result.finishReason
      });
    }

    res.json({
      suggestions: result.suggestions,
      model: GROQ_MODEL,
      tone,
      maxWords,
      banned: banned.length,
      regenerated: regenerated,
      // Surfaced rather than hidden: the model kept a banned term even after
      // being told, so the reply is returned but flagged.
      bannedTermUsed: hit || undefined,
      ms: Date.now() - startedAt
    });
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
      body.hint = 'Open /api/models to see the model ids this key can use, then set GROQ_MODEL to one of them.';
    }

    res.status(status).json(body);
  }
}

function callGroq(payload) {
  return axios.post(GROQ_BASE_URL + '/chat/completions', payload, {
    headers: {
      Authorization: 'Bearer ' + GROQ_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });
}

function isBadParameter(error) {
  const status = error.response && error.response.status;
  const message =
    (error.response &&
      error.response.data &&
      error.response.data.error &&
      error.response.data.error.message) ||
    '';

  return status === 400 && /unsupported|unknown|unrecognized|invalid/i.test(message);
}

app.post('/api/suggest-reply', suggestReply);
app.post('/suggest-reply', suggestReply);

function parseReplySuggestions(text, count) {
  // A single reply is asked for unnumbered, so the whole response is the
  // reply. Splitting it on newlines would cut a multi-sentence answer apart.
  if (count === 1) {
    const cleaned = stripQuotes(text.replace(/^\s*\d+[\.\)]\s*/, ''));
    return cleaned ? [cleaned] : [];
  }

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

// The prompt asks the model to avoid these, but models slip, so strip them
// rather than trusting the instruction. Em dashes and curly punctuation are
// the clearest giveaways that a reply was not typed on a phone keyboard.
function stripTells(text) {
  return text
    // An em or en dash becomes a comma, which is how the same pause is
    // written by hand in a casual reply.
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    // Tidy up what the substitutions above can leave behind.
    .replace(/,{2,}/g, ',')
    .replace(/,\s*([.!?,])/g, '$1')
    .replace(/\s+([.!?,])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,]+$/, '')
    .trim();
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
