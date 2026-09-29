// DIP service worker: opens the side panel on toolbar click. The scan itself runs in the side panel
// (an extension page that stays alive while open), which avoids MV3 service-worker suspension.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
