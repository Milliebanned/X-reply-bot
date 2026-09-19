const BACKEND_URL = 'https://xreply-six.vercel.app';

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const postTextEl = document.getElementById('postText');
  const generateBtn = document.getElementById('generateBtn');
  const toneEl = document.getElementById('tone');
  const suggestionsEl = document.getElementById('suggestions');
  const errorEl = document.getElementById('error');
  const maxWordsEl = document.getElementById('maxWords');
  const savedHintEl = document.getElementById('savedHint');

  // Persisted so the tone and length do not have to be re-entered on every
  // reply. Kept in extension storage, which survives popup closes and
  // browser restarts.
  const SETTINGS_DEFAULTS = { tone: '', maxWords: 40 };
  let saveTimer = null;

  await restoreSettings();
  toneEl.addEventListener('input', scheduleSave);
  maxWordsEl.addEventListener('input', scheduleSave);

  async function restoreSettings() {
    const stored = await chrome.storage.local.get('settings');
    const settings = Object.assign({}, SETTINGS_DEFAULTS, stored.settings);
    toneEl.value = settings.tone;
    maxWordsEl.value = settings.maxWords;
  }

  // Debounced so typing a tone does not write on every keystroke.
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 300);
  }

  async function saveSettings() {
    await chrome.storage.local.set({
      settings: {
        tone: toneEl.value.trim(),
        maxWords: readMaxWords()
      }
    });

    savedHintEl.textContent = 'Saved';
    savedHintEl.classList.add('flash');
    setTimeout(() => {
      savedHintEl.textContent = 'Tone and length are saved automatically';
      savedHintEl.classList.remove('flash');
    }, 1200);
  }

  // The number input allows anything typed by hand, so clamp to the range the
  // server accepts rather than sending a value it will silently override.
  function readMaxWords() {
    const parsed = parseInt(maxWordsEl.value, 10);
    if (isNaN(parsed)) return SETTINGS_DEFAULTS.maxWords;
    return Math.min(60, Math.max(5, parsed));
  }

  try {
    const health = await request('/api/health');
    statusEl.textContent = 'Connected (' + health.model + ')';
    statusEl.classList.add('active');
    if (!health.keyConfigured) {
      showError('Server is up but GROQ_API_KEY is not set on it.');
    }
  } catch (err) {
    statusEl.textContent = 'Backend unreachable: ' + err.message;
    statusEl.style.color = '#e74c3c';
  }

  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  loadPostText();

  // A post captured by an "AI Suggestion" button click wins over whatever is
  // on screen now. It arrives through storage, so it does not depend on the
  // content script still being able to answer messages.
  async function loadPostText() {
    const stored = await chrome.storage.local.get('pendingPost');
    const pending = stored.pendingPost;

    if (pending && Date.now() - pending.ts < 120000) {
      postTextEl.value = pending.text;
      await chrome.storage.local.remove('pendingPost');
      return;
    }

    // Opened from the toolbar instead: ask the page for the visible post.
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getPostContent' }, (response) => {
        // No content script on this tab (not an X page) - leave the box empty.
        if (chrome.runtime.lastError) return;
        if (response && response.postText) {
          postTextEl.value = response.postText;
        }
      });
    });
  }

  generateBtn.addEventListener('click', async () => {
    const postText = postTextEl.value.trim();
    if (!postText) {
      showError('Paste the post text first');
      return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    suggestionsEl.innerHTML = '<div class="loading">Generating reply suggestions...</div>';
    errorEl.style.display = 'none';

    try {
      await saveSettings();

      const data = await request('/api/suggest-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postText,
          tone: toneEl.value.trim() || 'natural',
          maxWords: readMaxWords()
        })
      });
      displaySuggestions(data.suggestions || []);
    } catch (err) {
      showError(err.message);
      suggestionsEl.innerHTML = '';
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Reply Options';
    }
  });

  // Reads the body as text first so a non-JSON response (an HTML error page,
  // a proxy timeout) reports its status and content instead of failing with a
  // bare JSON parse error.
  async function request(path, options) {
    const response = await fetch(BACKEND_URL + path, options);
    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error('HTTP ' + response.status + ' - ' + raw.slice(0, 120));
    }

    if (!response.ok) {
      throw new Error(data.error || ('HTTP ' + response.status));
    }

    return data;
  }

  function displaySuggestions(suggestions) {
    suggestionsEl.innerHTML = '';

    suggestions.forEach((suggestion, index) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML =
        '<div class="suggestion-text">' + escapeHtml(suggestion) + '</div>' +
        '<div class="suggestion-actions">' +
        '<button class="suggestion-btn use" data-index="' + index + '">Use This</button>' +
        '<button class="suggestion-btn" data-action="copy">Copy</button>' +
        '</div>';
      suggestionsEl.appendChild(item);

      item.querySelector('.use').addEventListener('click', () => {
        useSuggestion(suggestion);
      });

      item.querySelector('[data-action="copy"]').addEventListener('click', () => {
        navigator.clipboard.writeText(suggestion);
      });
    });
  }

  function useSuggestion(text) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      chrome.tabs.sendMessage(tab.id, { action: 'fillReplyBox', text }, (response) => {
        if (chrome.runtime.lastError) {
          showError('Open a post on x.com first, then use the suggestion.');
          return;
        }
        if (response && response.success) {
          generateBtn.textContent = 'Filled - review and send on X';
          setTimeout(() => {
            generateBtn.textContent = 'Generate Reply Options';
          }, 3000);
        } else {
          showError('Could not find the reply box - use Copy and paste it instead.');
        }
      });
    });
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
});
