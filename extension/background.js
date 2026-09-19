// Background service worker for the extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('X Reply Copilot extension installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'suggestReply') {
    chrome.action.openPopup();
  }
});
