// 监听来自 Popup 或 Dashboard 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'recordVisit') {
        recordVisitByBookmarkId(request.bookmarkId);
        sendResponse({ status: 'success' });
    } else if (request.action === 'archiveBookmarks') {
        archiveBookmarks(request.bookmarkIds).then(() => {
            sendResponse({ status: 'success' });
        }).catch(console.error);
        return true; // 保持异步响应
    } else if (request.action === 'triggerManualSort') {
        autoSortFolders().then(() => {
            sendResponse({ status: 'success' });
        }).catch(console.error);
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

        chrome.storage.local.set({ bookmarkStats: stats }).catch(console.error);
    });
}

// 📦 执行真正的归档操作：创建冷库文件夹并移动书签
async function archiveBookmarks(bookmarkIds) {
    if (!bookmarkIds || bookmarkIds.length === 0) return;

    // 1. 查找或创建 "🧊 BookmarkFlow Cold Vault" 文件夹
    const vaultName = '🧊 BookmarkFlow Cold Vault';
    const tree = await chrome.bookmarks.getTree();
    const otherBookmarksFolder = tree[0].children ? (tree[0].children[1] || tree[0].children[0]) : tree[0];

    let vaultNode;
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

// 1. 插件安装或更新时，初始化 1 小时定时任务
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('hourlyAutoSort', {
        delayInMinutes: 1,      // 安装 1 分钟后首次触发
        periodInMinutes: 60     // 之后每 60 分钟（1小时）触发一次
    }).catch(console.error);
    console.log('[BookmarkFlow] 1小时自动排序定时器已就位');
});

// 2. 监听开机/启动浏览器事件：开机即触发一次！
chrome.runtime.onStartup.addListener(() => {
    console.log('[BookmarkFlow] 浏览器启动，立即执行一次书签重排...');
    autoSortFolders().catch(console.error);
});

// 3. 监听 1 小时定时器触发
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'hourlyAutoSort') {
        console.log('[BookmarkFlow] 1小时正点到了，执行书签重排...');
        autoSortFolders().catch(console.error);
    }
});

// ⚡ 自动化文件夹重排逻辑（已完全消除 IDE 警告）
async function autoSortFolders() {
    const config = await chrome.storage.local.get(['sortMode', 'selectedFolders', 'bookmarkStats']);
    const mode = config.sortMode || 'exclude';
    const folderIds = new Set(Array.isArray(config.selectedFolders) ? config.selectedFolders : []);
    const stats = config.bookmarkStats || {};

    const tree = await chrome.bookmarks.getTree();

    // 通用递归函数：遍历所有层级的文件夹
    async function traverseAndSort(node) {
        if (node.title === '🧊 BookmarkFlow Cold Vault') return;

        if (!node.url && node.children) {
            const isSystemRoot = (node.id === '0' || node.id === '1' || node.id === '2' || node.id === '3');

            if (!isSystemRoot) {
                const folderId = node.id;
                let shouldSort = false;

                if (mode === 'exclude') {
                    shouldSort = !folderIds.has(folderId);
                } else if (mode === 'include') {
                    shouldSort = folderIds.has(folderId);
                }

                if (shouldSort) {
                    const childBookmarks = node.children.filter(child => child.url);

                    if (childBookmarks.length > 1) {
                        const sorted = [...childBookmarks].sort((a, b) => {
                            const ptsA = (stats[a.id] && stats[a.id].visits) || 0;
                            const ptsB = (stats[b.id] && stats[b.id].visits) || 0;
                            return ptsB - ptsA;
                        });

                        for (let i = 0; i < sorted.length; i++) {
                            const bm = sorted[i];
                            if (bm.index !== i) {
                                try {
                                    await chrome.bookmarks.move(bm.id, { index: i });
                                } catch (e) {
                                    console.warn(`[BookmarkFlow] 移动书签 ${bm.id} 失败:`, e);
                                }
                            }
                        }
                    }
                }
            }

            for (const child of node.children) {
                if (!child.url && child.children) {
                    await traverseAndSort(child);
                }
            }
        }
    }

    if (tree && tree.length > 0) {
        await traverseAndSort(tree[0]);
    }
}
