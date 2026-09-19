// Content script runs on X.com pages
// Communicates between the page and the extension

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPostContent') {
    const postContent = extractCurrentPostContent();
    sendResponse({ postText: postContent });
  }

  if (request.action === 'fillReplyBox') {
    const success = fillReplyBox(request.text);
    sendResponse({ success });
  }
});

function extractCurrentPostContent() {
  const selectors = [
    '[data-testid="tweetText"]',
    'article div[lang]',
    '.tweet-text'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element.textContent.trim();
    }
  }

  const article = document.querySelector('article');
  if (article) {
    return article.textContent.trim();
  }

  return '';
}

function fillReplyBox(text) {
  const selectors = [
    '[data-testid="tweetTextarea_0"]',
    '[role="textbox"][contenteditable="true"]',
    '.public-DraftEditor-content'
  ];

  for (const selector of selectors) {
    const textBox = document.querySelector(selector);
    if (textBox) {
      textBox.textContent = text;

      const inputEvent = new Event('input', { bubbles: true });
      const changeEvent = new Event('change', { bubbles: true });
      textBox.dispatchEvent(inputEvent);
      textBox.dispatchEvent(changeEvent);

      textBox.focus();

      return true;
    }
  }

  return false;
}

function injectReplyButtons() {
  const articles = document.querySelectorAll('article');

  articles.forEach(article => {
    if (article.dataset.copilotButtonAdded) {
      return;
    }

    const button = document.createElement('button');
    button.textContent = 'AI Suggestion';
    button.style.cssText = `
      padding: 4px 12px;
      font-size: 12px;
      background: #1da1f2;
      color: white;
      border: none;
      border-radius: 20px;
      cursor: pointer;
      margin-top: 8px;
    `;

    button.addEventListener('click', () => {
      const postText = article.textContent;
      chrome.runtime.sendMessage({
        action: 'suggestReply',
        postText
      });
    });

    const footer = article.querySelector('[role="group"]');
    if (footer) {
      footer.appendChild(button);
      article.dataset.copilotButtonAdded = true;
    }
  });
}

setTimeout(injectReplyButtons, 1000);

const observer = new MutationObserver(() => {
  injectReplyButtons();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
