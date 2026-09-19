const BACKEND_URL = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const postTextEl = document.getElementById('postText');
  const generateBtn = document.getElementById('generateBtn');
  const toneEl = document.getElementById('tone');
  const suggestionsEl = document.getElementById('suggestions');
  const errorEl = document.getElementById('error');

  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    if (response.ok) {
      statusEl.textContent = 'Connected';
      statusEl.classList.add('active');
    }
  } catch (err) {
    statusEl.textContent = 'Backend not running';
    statusEl.style.color = '#e74c3c';
  }

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.tabs.sendMessage(tab.id, { action: 'getPostContent' }, (response) => {
      if (response && response.postText) {
        postTextEl.value = response.postText;
      }
    });
  });

  generateBtn.addEventListener('click', async () => {
    const postText = postTextEl.value.trim();
    if (!postText) {
      showError('Please provide post text');
      return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    suggestionsEl.innerHTML = '<div class="loading">Generating reply suggestions...</div>';
    errorEl.style.display = 'none';

    try {
      const response = await fetch(`${BACKEND_URL}/api/suggest-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postText,
          tone: toneEl.value || 'natural'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate suggestions');
      }

      const data = await response.json();
      displaySuggestions(data.suggestions || []);
    } catch (err) {
      showError(err.message);
      suggestionsEl.innerHTML = '';
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Reply Options';
    }
  });

  function displaySuggestions(suggestions) {
    suggestionsEl.innerHTML = '';

    suggestions.forEach((suggestion, index) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `
        <div class="suggestion-text">${escapeHtml(suggestion)}</div>
        <div class="suggestion-actions">
          <button class="suggestion-btn use" data-index="${index}">Use This</button>
          <button class="suggestion-btn" data-index="${index}" data-action="copy">Copy</button>
        </div>
      `;
      suggestionsEl.appendChild(item);

      item.querySelector('.use').addEventListener('click', () => {
        useSuggestion(suggestion);
      });

      item.querySelector('[data-action="copy"]').addEventListener('click', () => {
        navigator.clipboard.writeText(suggestion);
        alert('Copied to clipboard!');
      });
    });
  }

  function useSuggestion(text) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'fillReplyBox',
        text
      }, (response) => {
        if (response && response.success) {
          generateBtn.textContent = 'Reply filled! Review and send on X.';
          setTimeout(() => {
            generateBtn.textContent = 'Generate Reply Options';
          }, 3000);
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
    return text.replace(/[&<>"']/g, m => map[m]);
  }
});
