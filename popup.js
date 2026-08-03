document.addEventListener('DOMContentLoaded', async () => {
    const hotList = document.getElementById('hot-list');
    if (!hotList) return;

    chrome.bookmarks.getTree(async (nodes) => {
        const allBookmarks = [];

        function traverse(node) {
            if (node.title === '🧊 BookmarkFlow Cold Vault') return;
            if (node.url) {
                allBookmarks.push(node);
            }
            if (node.children) {
                node.children.forEach(traverse);
            }
        }
        nodes.forEach(traverse);

        const storageData = await chrome.storage.local.get('bookmarkStats') || {};
        const stats = storageData.bookmarkStats || {};

        const scoredBookmarks = allBookmarks.map(bm => {
            const stat = stats[bm.id] || { visits: 0 };
            const dateAdded = bm.dateAdded || 0;

            return {
                ...bm,
                visits: stat.visits,
                dateAdded: dateAdded,
                score: stat.visits
            };
        });

        // 先按点击量降序，再按添加时间降序
        scoredBookmarks.sort((a, b) => {
            if (b.visits !== a.visits) {
                return b.visits - a.visits;
            }
            return b.dateAdded - a.dateAdded;
        });

        const topBookmarks = scoredBookmarks.slice(0, 10);
        hotList.innerHTML = '';

        if (topBookmarks.length === 0) {
            hotList.innerHTML = '<div class="empty">No bookmarks found.</div>';
            return;
        }

        topBookmarks.forEach(bm => {
            const li = document.createElement('li');
            li.innerHTML = `
        <div class="link-info">
          <div class="link-title">${bm.title || 'Untitled'}</div>
          <div class="link-url">${bm.url}</div>
        </div>
        <div class="score">${bm.visits > 0 ? bm.visits + ' pts' : 'NEW'}</div>
      `;

            // 💡 修复 Missing await：给点击回调函数加上 async
            li.addEventListener('click', async () => {
                // 先发送消息通知后台更新，等待完成再跳转
                await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: 'recordVisit', bookmarkId: bm.id }, resolve);
                });
                await chrome.tabs.create({ url: bm.url });
            });
            hotList.appendChild(li);
        });
    });
});

// 💡 修复 Promise returned from openOptionsPage is ignored：给回调加上 async 并 await
document.getElementById('open-dashboard')?.addEventListener('click', async () => {
    await chrome.runtime.openOptionsPage().catch(console.error);
});
