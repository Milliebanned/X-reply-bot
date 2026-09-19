// Runs on x.com pages. Bridges the page and the extension popup.

// Text of the post whose "AI Suggestion" button was clicked. The popup reads
// this instead of searching the DOM itself, because several posts are on
// screen at once and only the clicked one is the intended target.
let selectedPostText = '';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPostContent') {
    sendResponse({ postText: selectedPostText || extractVisiblePostText() });
    // Consume it, so opening the popup later from the toolbar does not
    // resurface a post picked minutes ago.
    selectedPostText = '';
  }

  if (request.action === 'fillReplyBox') {
    sendResponse({ success: fillReplyBox(request.text) });
  }
});

// Pulls just the post body, skipping the author, timestamp and counters that
// article.textContent would otherwise include.
function extractPostText(article) {
  if (!article) return '';
  const body = article.querySelector('[data-testid="tweetText"]');
  return (body ? body.textContent : article.textContent).trim();
}

// Fallback when the popup is opened from the toolbar rather than a post
// button: pick the post nearest the top of the viewport, which is the one
// being read, rather than the first in the DOM.
function extractVisiblePostText() {
  const articles = Array.from(document.querySelectorAll('article'));
  if (articles.length === 0) return '';

  const anchor = 120;
  let best = null;
  let bestDistance = Infinity;

  articles.forEach((article) => {
    const rect = article.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;

    const distance = Math.abs(rect.top - anchor);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = article;
    }
  });

  return extractPostText(best || articles[0]);
}

function fillReplyBox(text) {
  // Prefer the composer inside an open reply dialog over one elsewhere on
  // the page.
  const scope = document.querySelector('[role="dialog"]') || document;
  const selectors = [
    '[data-testid="tweetTextarea_0"]',
    '[role="textbox"][contenteditable="true"]',
    '.public-DraftEditor-content'
  ];

  let box = null;
  for (const selector of selectors) {
    box = scope.querySelector(selector) || document.querySelector(selector);
    if (box) break;
  }

  if (!box) return false;

  box.focus();

  // insertText raises the input events X's editor listens for. Assigning
  // textContent changes the DOM but leaves the editor's own state stale, so
  // the text looks present but the Reply button stays disabled.
  const inserted = document.execCommand('insertText', false, text);
  if (!inserted) {
    box.textContent = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  return true;
}

function injectReplyButtons() {
  document.querySelectorAll('article').forEach((article) => {
    if (article.dataset.copilotButtonAdded) return;

    const button = document.createElement('button');
    button.textContent = 'AI Suggestion';
    button.style.cssText = [
      'padding: 4px 12px',
      'font-size: 12px',
      'background: #1da1f2',
      'color: white',
      'border: none',
      'border-radius: 20px',
      'cursor: pointer',
      'margin-left: 8px'
    ].join(';');

    button.addEventListener('click', (event) => {
      // Without this, the click bubbles up to the post and X navigates away.
      event.preventDefault();
      event.stopPropagation();

      selectedPostText = extractPostText(article);
      chrome.runtime.sendMessage({ action: 'openPopup' });
    });

    const footer = article.querySelector('[role="group"]');
    if (footer) {
      footer.appendChild(button);
      article.dataset.copilotButtonAdded = true;
    }
  });
}

setTimeout(injectReplyButtons, 1000);

// X renders posts as you scroll, so newly added articles need buttons too.
const observer = new MutationObserver(() => injectReplyButtons());
observer.observe(document.body, { childList: true, subtree: true });
