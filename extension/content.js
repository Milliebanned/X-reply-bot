// Runs on x.com pages. Clicking the injected button generates one reply and
// puts it straight into the post's reply box, ready to edit and send.

const SETTINGS_DEFAULTS = {
  tone: '',
  maxWords: 40,
  bannedWords: 'sounds, absolutely, great point, love this, so true, game-changer, delve'
};

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
    return;
  }

  if (request.action === 'fillReplyBox') {
    insertIntoComposer(request.text).then((success) => sendResponse({ success: success }));
    // Keeps the channel open for the async insert above.
    return true;
  }
});

function findComposer() {
  // A reply dialog, when open, holds the composer that belongs to the post
  // being replied to. Prefer it over any other editable on the page.
  const scope = document.querySelector('[role="dialog"]') || document;
  const selectors = [
    '[data-testid="tweetTextarea_0"]',
    '[role="textbox"][contenteditable="true"]',
    '.public-DraftEditor-content'
  ];

  for (const selector of selectors) {
    const element = scope.querySelector(selector) || document.querySelector(selector);
    if (!element) continue;

    // Some of these selectors match a wrapper rather than the editable
    // itself. Focusing a wrapper does nothing, and an insert at a caret that
    // was never created silently does nothing either.
    if (element.isContentEditable) return element;

    const editable = element.querySelector('[contenteditable="true"]');
    if (editable) return editable;
  }

  return null;
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

// X's composer is a rich-text editor holding its own document model. Writing
// box.textContent puts characters on screen without telling the editor, which
// still believes the box is empty - backspace then deletes against a model
// that does not match what is displayed and leaves fragments behind. Both
// methods here go through the editor so its model and the DOM stay in step,
// and each is verified rather than assumed.
async function insertIntoComposer(text) {
  const box = findComposer();
  if (!box) return false;

  // A paste event is the most widely handled path into these editors.
  selectAllIn(box);
  pasteInto(box, text);
  if (await textLanded(box, text)) return true;

  selectAllIn(box);
  document.execCommand('insertText', false, text);
  if (await textLanded(box, text)) return true;

  // Neither path took. Clear whatever partial content may be sitting there
  // so the box is not left in the half-written state this is meant to avoid.
  clearComposer(box);
  return false;
}

// Selects the existing content rather than collapsing to the end, so an
// insert replaces what is in the box instead of appending to it.
function selectAllIn(box) {
  box.focus();

  const range = document.createRange();
  range.selectNodeContents(box);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function clearComposer(box) {
  try {
    selectAllIn(box);
    document.execCommand('delete', false, null);
  } catch (error) {
    // Nothing further to try; the caller reports failure and uses the
    // clipboard instead.
  }
}

function pasteInto(box, text) {
  try {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    box.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
    );
  } catch (error) {
    // Older engines reject a synthesised ClipboardEvent; the caller falls
    // through to execCommand.
  }
}

// The editor commits asynchronously, so poll briefly rather than checking
// once and wrongly reporting failure.
function textLanded(box, text) {
  return new Promise((resolve) => {
    let attempts = 0;

    (function check() {
      if (boxContains(box, text)) return resolve(true);
      if (++attempts > 12) return resolve(false);
      setTimeout(check, 30);
    })();
  });
}

function boxContains(box, text) {
  // Compare a normalised prefix: the editor may re-wrap whitespace, so an
  // exact match is too strict.
  const needle = text.trim().slice(0, 24).replace(/\s+/g, ' ');
  const haystack = (box.textContent || '').replace(/\s+/g, ' ');
  return needle.length > 0 && haystack.indexOf(needle) !== -1;
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

// After the extension is reloaded or updated, scripts already injected into
// open tabs keep running but lose their connection to it. Every chrome.*
// call then throws "Extension context invalidated". Only a fresh page load
// injects a working script, so the buttons say so rather than repeating an
// error the page cannot recover from.
function extensionAlive() {
  try {
    return Boolean(chrome.runtime && chrome.runtime.id);
  } catch (error) {
    return false;
  }
}

function markStale(button) {
  document.querySelectorAll('[data-copilot-button]').forEach((stale) => {
    stale.dataset.stale = 'true';
    stale.disabled = false;
    stale.textContent = 'Refresh page';
    stale.title = 'The extension was updated. Reload this tab to reconnect it.';
    stale.style.background = '#8899a6';
  });

  if (button) button.focus();
}

function isContextError(error) {
  return /context invalidated|receiving end does not exist/i.test(error.message || '');
}

async function handleSuggestClick(article, button) {
  if (!extensionAlive()) {
    return markStale(button);
  }

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

    if (!(await insertIntoComposer(reply))) {
      await navigator.clipboard.writeText(reply);
      flashButton(button, 'Copied - paste it');
      return;
    }

    flashButton(button, 'Filled');
  } catch (error) {
    if (isContextError(error) || !extensionAlive()) {
      markStale(button);
      return;
    }
    flashButton(button, error.message.slice(0, 40));
  } finally {
    if (button.dataset.stale !== 'true') button.disabled = false;
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

    button.dataset.copilotButton = 'true';

    button.addEventListener('click', (event) => {
      // Without this the click bubbles up and X navigates to the post.
      event.preventDefault();
      event.stopPropagation();

      // Once stale, the only useful action the button has left is reloading.
      if (button.dataset.stale === 'true') {
        location.reload();
        return;
      }

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
