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

    const vaultName = chrome.i18n.getMessage('coldVaultFolderName') || '🧊 BookmarkFlow Cold Vault';
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

// ⏰ 4. 定时任务 & 浏览器启动事件注册
chrome.runtime.onInstalled.addListener(async (details) => {
    try {
        // 💡 1. 记录插件安装/首次初始化时间戳
        const { installedAt } = await chrome.storage.local.get('installedAt');
        if (!installedAt) {
            await chrome.storage.local.set({ installedAt: Date.now() });
            console.log('[BookmarkFlow] 已记录插件首次安装时间:', new Date().toLocaleString());
        }

        // 2. 创建 1 小时自动排序定时器
        chrome.alarms.create('hourlyAutoSort', {
            delayInMinutes: 1,      // 安装 1 分钟后首次触发
            periodInMinutes: 60     // 之后每 60 分钟触发一次
        });
        console.log('[BookmarkFlow] 1小时自动排序定时器已就位');
    } catch (e) {
        console.error('[BookmarkFlow] 初始化设置失败:', e);
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

// 递归计算文件夹及其所有子孙书签的点击量之和
function getFolderTotalVisits(node, stats) {
    if (node.url) {
        return stats[node.id]?.visits || 0;
    }
    let total = 0;
    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            total += getFolderTotalVisits(child, stats);
        }
    }
    return total;
}

// ⚡ 5. 自动化文件夹重排核心逻辑
async function autoSortFolders() {
    console.time('[BookmarkFlow] 重排总耗时');
    try {
        const config = await chrome.storage.local.get(['sortMode', 'selectedFolders', 'bookmarkStats', 'includeFoldersInSort']);
        const mode = config.sortMode || 'exclude';
        const includeFolders = Boolean(config.includeFoldersInSort); // 是否开启文件夹参与排序
        const folderIds = new Set(Array.isArray(config.selectedFolders) ? config.selectedFolders : []);
        const stats = config.bookmarkStats || {};

        const tree = await chrome.bookmarks.getTree();
        const targetFolders = [];

        // 1. 收集所有符合条件的文件夹节点
        function collectFolders(node) {
            if (node.title === '🧊 BookmarkFlow Cold Vault' || node.title === '🧊 BookmarkFlow 冷库') return;

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

        // 2. 逐个文件夹独立重排
        for (const folder of targetFolders) {
            const allChildren = await chrome.bookmarks.getChildren(folder.id);
            if (allChildren.length <= 1) continue;

            let finalSortedNodes = [];

            if (includeFolders) {
                // ==================== 【模式二】：文件夹参与重排 ====================
                // 为了获取文件夹下所有嵌套子节点计算权重，需要拿到带有 children 的完整子树节点
                const fullSubTree = await chrome.bookmarks.getSubTree(folder.id);
                const childrenWithTree = fullSubTree[0]?.children || [];

                // 检查直属或子代是否有任何点击记录
                const hasAnyVisits = childrenWithTree.some(node => getFolderTotalVisits(node, stats) > 0);
                if (!hasAnyVisits) continue;

                // 计算每个节点（普通书签 或 文件夹）的综合权重（visits）
                const indexedNodes = childrenWithTree.map((node, index) => ({
                    node,
                    originalIndex: index,
                    visits: getFolderTotalVisits(node, stats)
                }));

                // 按点击量降序排序，点击量相同则保持原始相对顺序
                indexedNodes.sort((a, b) => {
                    if (b.visits !== a.visits) {
                        return b.visits - a.visits;
                    }
                    return a.originalIndex - b.originalIndex;
                });

                finalSortedNodes = indexedNodes.map(item => item.node);

            } else {
                // ==================== 【模式一】：默认模式（锁定文件夹槽位，仅排序书签） ====================
                // 检查直属书签是否有点击记录
                const hasAnyVisits = allChildren.some(node => node.url && (stats[node.id]?.visits || 0) > 0);
                if (!hasAnyVisits) continue;

                const bookmarkNodes = [];
                const bookmarkIndices = [];

                // 提取直属书签及所在槽位索引
                allChildren.forEach((node, index) => {
                    if (node.url) {
                        bookmarkNodes.push(node);
                        bookmarkIndices.push(index);
                    }
                });

                // 如果普通书签不足 2 个，无需重新排序
                if (bookmarkNodes.length <= 1) continue;

                // 对普通书签按点击量降序排列
                bookmarkNodes.sort((a, b) => {
                    const visitsA = stats[a.id]?.visits || 0;
                    const visitsB = stats[b.id]?.visits || 0;
                    return visitsB - visitsA;
                });

                // 将排序后的书签放回原数组（文件夹的原始 Index 完全锁定）
                finalSortedNodes = [...allChildren];
                bookmarkIndices.forEach((targetIndex, i) => {
                    finalSortedNodes[targetIndex] = bookmarkNodes[i];
                });
            }

            // 3. 检查整体顺序是否有改变
            let isAlreadySorted = true;
            for (let i = 0; i < allChildren.length; i++) {
                if (allChildren[i].id !== finalSortedNodes[i].id) {
                    isAlreadySorted = false;
                    break;
                }
            }

            if (isAlreadySorted) continue;

            console.log(`[Sort Engine] 正在重排: "${folder.title}" (模式: ${includeFolders ? '文件夹参与' : '文件夹固定'})`);

            // 4. 倒序安全移动节点，确保 Index 精准
            for (let i = finalSortedNodes.length - 1; i >= 0; i--) {
                const node = finalSortedNodes[i];
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
