chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'recordVisit') {
        recordVisitByBookmarkId(request.bookmarkId);
        sendResponse({ status: 'success' });
    }
});

chrome.history.onVisited.addListener((historyItem) => {
    if (!historyItem.url) return;

    chrome.bookmarks.search({ url: historyItem.url }, (bookmarks) => {
        if (bookmarks && bookmarks.length > 0) {
            bookmarks.forEach((bm) => {
                recordVisitByBookmarkId(bm.id);
            });
        }
    });
});

function recordVisitByBookmarkId(bookmarkId) {
    const now = Date.now();
    chrome.storage.local.get('bookmarkStats', (result) => {
        const stats = result.bookmarkStats || {};
        const current = stats[bookmarkId] || { visits: 0, lastVisited: now, timestamps: [] };

        // 只保留最近 365 天的时间戳，防止数据无限膨胀
        const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
        const filteredTimestamps = (current.timestamps || []).filter(ts => ts > oneYearAgo);
        filteredTimestamps.push(now);

        stats[bookmarkId] = {
            visits: current.visits + 1,
            lastVisited: now,
            timestamps: filteredTimestamps
        };

        chrome.storage.local.set({ bookmarkStats: stats });
    });
}
