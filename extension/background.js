// Background service worker.

chrome.runtime.onInstalled.addListener(() => {
  console.log('X Reply Copilot extension installed');
});

// The content script cannot open the popup itself, so it asks here.
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'openPopup' && chrome.action.openPopup) {
    chrome.action.openPopup();
  }
});
