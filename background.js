console.log('[BookmarkFlow] Background Service Worker 启动初始化...', new Date().toLocaleTimeString());

// 🛡️ 1. 注册全局错误监听，防止意外报错导致 Service Worker 崩溃
self.addEventListener('unhandledrejection', (event) => {
    console.error('[BookmarkFlow] 未捕获的 Promise 拒绝:', event.reason);
});

self.addEventListener('error', (event) => {
    console.error('[BookmarkFlow] 全局脚本错误:', event.error);
});

// 📩 2. 监听来自 Popup 或 Dashboard 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[BookmarkFlow] 收到消息:', request.action);

    if (request.action === 'recordVisit') {
        recordVisitByBookmarkId(request.bookmarkId);
        sendResponse({ status: 'success' });
        return false;
    }

    if (request.action === 'archiveBookmarks') {
        (async () => {
            try {
                await archiveBookmarks(request.bookmarkIds);
                sendResponse({ status: 'success' });
            } catch (err) {
                console.error('[BookmarkFlow] 归档失败:', err);
                sendResponse({ status: 'error', error: err ? err.message : String(err) });
            }
        })();
        return true; // ⚠️ 保持通道开启以等待 async 回调
    }

    if (request.action === 'triggerManualSort') {
        (async () => {
            try {
                console.log('[BookmarkFlow] 开始手动重排 autoSortFolders()...');
                await autoSortFolders();
                console.log('[BookmarkFlow] 重排成功，准备响应前端');
                sendResponse({ status: 'success' });
            } catch (err) {
                console.error('[BookmarkFlow] 重排失败:', err);
                sendResponse({ status: 'error', error: err ? err.message : String(err) });
            }
        })();
        return true; // ⚠️ 保持通道开启以等待 async 回调
    }
});

// 🌐 3. 监听历史记录访问事件
chrome.history.onVisited.addListener((historyItem) => {
    if (!historyItem.url) return;
    chrome.bookmarks.search({ url: historyItem.url }, (bookmarks) => {
        if (bookmarks && bookmarks.length > 0) {
            bookmarks.forEach((bm) => recordVisitByBookmarkId(bm.id));
        }
    });
});

// 📊 记录访问统计
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

// 📦 执行冷库归档操作
async function archiveBookmarks(bookmarkIds) {
    if (!bookmarkIds || bookmarkIds.length === 0) return;

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

    for (const id of bookmarkIds) {
        try {
            await chrome.bookmarks.move(id, { parentId: vaultNode.id });
        } catch (e) {
            console.warn(`[BookmarkFlow] 移动书签 ${id} 失败:`, e);
        }
    }
}

// ⏰ 4. 定时任务 & 浏览器启动事件注册（已修正非 Promise 调用错误）
chrome.runtime.onInstalled.addListener(() => {
    try {
        chrome.alarms.create('hourlyAutoSort', {
            delayInMinutes: 1,      // 安装 1 分钟后首次触发
            periodInMinutes: 60     // 之后每 60 分钟（1小时）触发一次
        });
        console.log('[BookmarkFlow] 1小时自动排序定时器已就位');
    } catch (e) {
        console.error('[BookmarkFlow] 创建定时器失败:', e);
    }
});

chrome.runtime.onStartup.addListener(() => {
    console.log('[BookmarkFlow] 浏览器启动，执行书签重排...');
    autoSortFolders().catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'hourlyAutoSort') {
        console.log('[BookmarkFlow] 1小时定时触发书签重排...');
        autoSortFolders().catch(console.error);
    }
});

// ⚡ 5. 自动化文件夹重排核心逻辑（完美支持子文件夹隔离与同级绝对索引）
async function autoSortFolders() {
    console.time('[BookmarkFlow] 重排总耗时');
    try {
        const config = await chrome.storage.local.get(['sortMode', 'selectedFolders', 'bookmarkStats']);
        const mode = config.sortMode || 'exclude';
        const folderIds = new Set(Array.isArray(config.selectedFolders) ? config.selectedFolders : []);
        const stats = config.bookmarkStats || {};

        const tree = await chrome.bookmarks.getTree();
        const targetFolders = [];

        // 1. 收集所有符合条件的文件夹节点
        function collectFolders(node) {
            if (node.title === '🧊 BookmarkFlow Cold Vault') return;

            if (!node.url && node.children) {
                const isSystemRoot = (node.id === '0' || node.id === '1' || node.id === '2' || node.id === '3');

                if (!isSystemRoot) {
                    let shouldSort = false;
                    if (mode === 'exclude') {
                        shouldSort = !folderIds.has(node.id);
                    } else if (mode === 'include') {
                        shouldSort = folderIds.has(node.id);
                    }

                    if (shouldSort) {
                        targetFolders.push(node);
                    }
                }

                for (const child of node.children) {
                    collectFolders(child);
                }
            }
        }

        if (tree && tree.length > 0) {
            collectFolders(tree[0]);
        }

        console.log(`[Sort Engine] 找到 ${targetFolders.length} 个符合条件的文件夹待检测`);

        // 2. 逐个文件夹独立重排（不跨层级、不混淆嵌套文件夹）
        for (const folder of targetFolders) {
            // 获取当前文件夹下的【所有直属子节点】（包含书签和子文件夹）
            const allChildren = await chrome.bookmarks.getChildren(folder.id);
            if (allChildren.length <= 1) continue;

            // 检查当前文件夹中的直属书签是否有点击记录
            const hasAnyVisits = allChildren.some(node => node.url && (stats[node.id]?.visits || 0) > 0);
            if (!hasAnyVisits) {
                continue; // 全无点击量，原封不动！
            }

            // 给所有直属节点赋予【在父文件夹中的真实绝对索引 absoluteIndex】
            const indexedNodes = allChildren.map((node, index) => ({
                node,
                absoluteIndex: index,
                isBookmark: Boolean(node.url),
                visits: node.url ? (stats[node.id]?.visits || 0) : -1 // 文件夹不参与热度排序
            }));

            // 排序策略：
            // 1. 纯网址书签按点击量降序；
            // 2. 点击量相同时（包含都为 0 次，或子文件夹），严格按 absoluteIndex 升序保持原始相对位置。
            indexedNodes.sort((a, b) => {
                if (b.visits !== a.visits) {
                    return b.visits - a.visits;
                }
                return a.absoluteIndex - b.absoluteIndex;
            });

            const sortedNodes = indexedNodes.map(item => item.node);

            // 检查整体顺序是否改变
            let isAlreadySorted = true;
            for (let i = 0; i < allChildren.length; i++) {
                if (allChildren[i].id !== sortedNodes[i].id) {
                    isAlreadySorted = false;
                    break;
                }
            }

            if (isAlreadySorted) continue;

            console.log(`[Sort Engine] 正在对文件夹进行安全重排: "${folder.title}" (ID: ${folder.id})`);

            // 倒序安全移动所有节点，保证绝对索引精确对齐（包括子文件夹与书签的相对位置）
            for (let i = sortedNodes.length - 1; i >= 0; i--) {
                const node = sortedNodes[i];
                try {
                    await chrome.bookmarks.move(node.id, {
                        parentId: folder.id,
                        index: 0
                    });
                } catch (e) {
                    console.warn(`[BookmarkFlow] 移动节点 ${node.id} 失败:`, e);
                }
            }
        }
        console.log('[BookmarkFlow] 所有文件夹书签重排完成！');
    } catch (err) {
        console.error('[BookmarkFlow] 自动排序底层报错:', err);
        throw err;
    } finally {
        console.timeEnd('[BookmarkFlow] 重排总耗时');
    }
}
