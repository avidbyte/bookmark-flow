// 1. 监听来自 Popup 内部点击的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'recordVisit') {
        recordVisitByBookmarkId(request.bookmarkId);
    }
});

// 2. 监听全网浏览历史：只要访问的 URL 匹配你的某个书签，自动 +1 分！
chrome.history.onVisited.addListener((historyItem) => {
    if (!historyItem.url) return;

    // 查一下这个 URL 是否在书签库里
    chrome.bookmarks.search({ url: historyItem.url }, (bookmarks) => {
        if (bookmarks && bookmarks.length > 0) {
            bookmarks.forEach((bm) => {
                recordVisitByBookmarkId(bm.id);
            });
        }
    });
});

// 封装通用的加分函数
function recordVisitByBookmarkId(bookmarkId) {
    chrome.storage.local.get('bookmarkStats', (result) => {
        const stats = result.bookmarkStats || {};
        const current = stats[bookmarkId] || { visits: 0, lastVisited: Date.now() };

        stats[bookmarkId] = {
            visits: current.visits + 1,
            lastVisited: Date.now()
        };

        chrome.storage.local.set({ bookmarkStats: stats }, () => {
            console.log(`[BookmarkFlow] 书签 ID ${bookmarkId} 计数更新为:`, stats[bookmarkId].visits);
        });
    });
}
