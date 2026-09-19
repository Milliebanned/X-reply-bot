// Background service worker. Performs backend calls on behalf of the content
// script, which keeps them clear of the page's CORS rules.

const BACKEND_URL = 'https://xreply-six.vercel.app';

chrome.runtime.onInstalled.addListener(() => {
  console.log('X Reply Copilot extension installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateReply') {
    generateReply(request.postText, request.settings)
      .then((reply) => sendResponse({ ok: true, reply: reply }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    // Keeps the message channel open for the async reply above.
    return true;
  }

  if (request.action === 'openPopup' && chrome.action.openPopup) {
    chrome.action.openPopup();
  }
});

async function generateReply(postText, settings) {
  const response = await fetch(BACKEND_URL + '/api/suggest-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postText: postText,
      tone: (settings && settings.tone) || 'natural',
      maxWords: (settings && settings.maxWords) || 40,
      count: 1
    })
  });

  // Read as text first so an HTML error page reports its status rather than
  // failing with a bare JSON parse error.
  const raw = await response.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error('HTTP ' + response.status + ' - ' + raw.slice(0, 80));
  }

  if (!response.ok) {
    throw new Error(data.error || 'HTTP ' + response.status);
  }

  if (!data.suggestions || data.suggestions.length === 0) {
    throw new Error('No reply returned');
  }

  return data.suggestions[0];
}
