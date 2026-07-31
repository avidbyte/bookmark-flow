document.addEventListener('DOMContentLoaded', async () => {
    const hotList = document.getElementById('hot-list');

    chrome.bookmarks.getTree(async (nodes) => {
        const allBookmarks = [];

        function traverse(node) {
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

            li.addEventListener('click', async () => {
                // 先发送消息通知后台更新，等待完成再跳转
                await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: 'recordVisit', bookmarkId: bm.id }, resolve);
                });
                chrome.tabs.create({ url: bm.url });
            });
            hotList.appendChild(li);
        });
    });
});
