// 监听来自 Popup 或 Dashboard 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'recordVisit') {
        recordVisitByBookmarkId(request.bookmarkId);
        sendResponse({ status: 'success' });
    } else if (request.action === 'archiveBookmarks') {
        archiveBookmarks(request.bookmarkIds).then(() => {
            sendResponse({ status: 'success' });
        });
        return true; // 保持异步响应
    }
});

chrome.history.onVisited.addListener((historyItem) => {
    if (!historyItem.url) return;
    chrome.bookmarks.search({ url: historyItem.url }, (bookmarks) => {
        if (bookmarks && bookmarks.length > 0) {
            bookmarks.forEach((bm) => recordVisitByBookmarkId(bm.id));
        }
    });
});

function recordVisitByBookmarkId(bookmarkId) {
    const now = Date.now();
    chrome.storage.local.get('bookmarkStats', (result) => {
        const stats = result.bookmarkStats || {};
        const current = stats[bookmarkId] || { visits: 0, lastVisited: now, timestamps: [] };

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

// 📦 执行真正的归档操作：创建冷库文件夹并移动书签
async function archiveBookmarks(bookmarkIds) {
    if (!bookmarkIds || bookmarkIds.length === 0) return;

    // 1. 查找或创建 "🧊 BookmarkFlow Cold Vault" 文件夹
    const vaultName = '🧊 BookmarkFlow Cold Vault';
    const tree = await chrome.bookmarks.getTree();
    const otherBookmarksFolder = tree[0].children[1] || tree[0].children[0]; // 默认取“其他书签”或书签栏

    let vaultNode = null;
    const existingVaults = await chrome.bookmarks.search({ title: vaultName });

    if (existingVaults && existingVaults.length > 0) {
        vaultNode = existingVaults[0];
    } else {
        vaultNode = await chrome.bookmarks.create({
            parentId: otherBookmarksFolder.id,
            title: vaultName
        });
    }

    // 2. 将指定 ID 的书签批量移动到冷库文件夹下
    for (const id of bookmarkIds) {
        try {
            await chrome.bookmarks.move(id, { parentId: vaultNode.id });
        } catch (e) {
            console.warn(`[BookmarkFlow] 移动书签 ${id} 失败:`, e);
        }
    }
}
