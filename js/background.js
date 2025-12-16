chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create(
    { url: chrome.runtime.getURL("/html/dragon.html") },
    function (tab) {},
  );
});
