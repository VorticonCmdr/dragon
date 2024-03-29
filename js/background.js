chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({'url': chrome.runtime.getURL('/html/map.html')}, function (tab) {});
});
