const BACKEND_URL = 'https://xreply-six.vercel.app';

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const postTextEl = document.getElementById('postText');
  const generateBtn = document.getElementById('generateBtn');
  const toneEl = document.getElementById('tone');
  const suggestionsEl = document.getElementById('suggestions');
  const errorEl = document.getElementById('error');

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

  // Pull the post text from the page when the popup is opened on X.
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.tabs.sendMessage(tab.id, { action: 'getPostContent' }, (response) => {
      // No content script on this tab (not an X page) - leave the box empty.
      if (chrome.runtime.lastError) return;
      if (response && response.postText) {
        postTextEl.value = response.postText;
      }
    });
  });

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
      const data = await request('/api/suggest-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postText, tone: toneEl.value || 'natural' })
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
