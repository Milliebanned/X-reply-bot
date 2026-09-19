// Runs on x.com pages. Clicking the injected button generates one reply and
// puts it straight into the post's reply box, ready to edit and send.

const SETTINGS_DEFAULTS = { tone: '', maxWords: 40 };

// Pulls just the post body, skipping the author, timestamp and counters that
// article.textContent would otherwise include.
function extractPostText(article) {
  if (!article) return '';
  const body = article.querySelector('[data-testid="tweetText"]');
  return (body ? body.textContent : article.textContent).trim();
}

// Used when the popup is opened from the toolbar rather than a post button:
// pick the post nearest the top of the viewport, which is the one being read,
// rather than the first one in the DOM.
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPostContent') {
    sendResponse({ postText: extractVisiblePostText() });
  }

  if (request.action === 'fillReplyBox') {
    sendResponse({ success: insertIntoComposer(request.text) });
  }
});

function findComposer() {
  // A reply dialog, when open, holds the composer that belongs to the post
  // being replied to. Prefer it over any other editable on the page.
  const scope = document.querySelector('[role="dialog"]') || document;
  return (
    scope.querySelector('[data-testid="tweetTextarea_0"]') ||
    scope.querySelector('[role="textbox"][contenteditable="true"]') ||
    document.querySelector('[data-testid="tweetTextarea_0"]')
  );
}

function waitForComposer(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000);

  return new Promise((resolve, reject) => {
    (function poll() {
      const box = findComposer();
      if (box) return resolve(box);
      if (Date.now() > deadline) return reject(new Error('Reply box did not open'));
      setTimeout(poll, 100);
    })();
  });
}

// Opens the reply composer for this specific post, unless one is already open.
function openReplyComposer(article) {
  if (findComposer()) return Promise.resolve();

  const replyButton = article.querySelector('[data-testid="reply"]');
  if (!replyButton) return Promise.reject(new Error('Reply button not found'));

  replyButton.click();
  return waitForComposer();
}

function insertIntoComposer(text) {
  const box = findComposer();
  if (!box) return false;

  box.focus();

  // execCommand inserts at the caret, and focus() alone does not reliably
  // create one in a contenteditable. Without a collapsed range inside the
  // box the call is a silent no-op, which is what made the text land via the
  // fallback below and come out uneditable.
  const range = document.createRange();
  range.selectNodeContents(box);
  range.collapse(false);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  if (document.execCommand('insertText', false, text)) return true;

  // Last resort. The text becomes visible but X's editor state stays empty,
  // so the Reply button can remain disabled and edits may not stick.
  box.textContent = text;
  box.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' })
  );
  return true;
}

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return Object.assign({}, SETTINGS_DEFAULTS, stored.settings);
}

// The background worker performs the request: it holds the extension's host
// permissions, so the call is not subject to the page's CORS rules.
function requestReply(postText, settings) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'generateReply', postText: postText, settings: settings },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response || !response.ok) {
          return reject(new Error((response && response.error) || 'No response'));
        }
        resolve(response.reply);
      }
    );
  });
}

async function handleSuggestClick(article, button) {
  const postText = extractPostText(article);
  if (!postText) {
    return flashButton(button, 'No post text');
  }

  button.disabled = true;
  button.textContent = 'Generating...';

  try {
    const settings = await getSettings();

    // Open the composer while the request is in flight, so the reply lands as
    // soon as it arrives.
    const [reply] = await Promise.all([
      requestReply(postText, settings),
      openReplyComposer(article)
    ]);

    if (!insertIntoComposer(reply)) {
      await navigator.clipboard.writeText(reply);
      flashButton(button, 'Copied - paste it');
      return;
    }

    flashButton(button, 'Filled');
  } catch (error) {
    flashButton(button, error.message.slice(0, 40));
  } finally {
    button.disabled = false;
  }
}

function flashButton(button, message) {
  button.textContent = message;
  setTimeout(() => {
    button.textContent = 'AI Reply';
  }, 2500);
}

function injectReplyButtons() {
  document.querySelectorAll('article').forEach((article) => {
    if (article.dataset.copilotButtonAdded) return;

    const button = document.createElement('button');
    button.textContent = 'AI Reply';
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
      // Without this the click bubbles up and X navigates to the post.
      event.preventDefault();
      event.stopPropagation();
      handleSuggestClick(article, button);
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
