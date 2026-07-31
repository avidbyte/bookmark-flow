let chartInstance = null;
let currentRange = '1';
let coldBookmarkIds = [];

document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    loadAnalytics('1');
    loadColdBookmarks();

    document.getElementById('btn-archive-all').addEventListener('click', archiveColdBookmarks);
});

function initFilters() {
    const buttons = document.querySelectorAll('.btn-filter');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            buttons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentRange = e.target.getAttribute('data-range');
            loadAnalytics(currentRange);
        });
    });
}

function loadAnalytics(range) {
    chrome.bookmarks.getTree(async (nodes) => {
        const allBookmarks = [];
        function traverse(node) {
            if (node.url) allBookmarks.push(node);
            if (node.children) node.children.forEach(traverse);
        }
        nodes.forEach(traverse);

        const storageData = await chrome.storage.local.get('bookmarkStats') || {};
        const stats = storageData.bookmarkStats || {};

        const now = Date.now();
        let timeThreshold = 0;

        if (range === '1') timeThreshold = now - 1 * 24 * 60 * 60 * 1000;
        else if (range === '7') timeThreshold = now - 7 * 24 * 60 * 60 * 1000;
        else if (range === '30') timeThreshold = now - 30 * 24 * 60 * 60 * 1000;
        else timeThreshold = 0;

        const analytics = allBookmarks.map(bm => {
            const stat = stats[bm.id] || { visits: 0, timestamps: [] };
            let count = 0;
            if (range === 'all') {
                count = stat.visits || 0;
            } else {
                const timestamps = stat.timestamps || [];
                count = timestamps.filter(ts => ts >= timeThreshold).length;
            }
            return { title: bm.title || bm.url, count: count };
        });

        const topData = analytics
            .filter(item => item.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        renderChart(topData);
    });
}

function renderChart(data) {
    const ctx = document.getElementById('topChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const labels = data.map(d => d.title.length > 20 ? d.title.substring(0, 20) + '...' : d.title);
    const counts = data.map(d => d.count);

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Visits',
                data: counts,
                backgroundColor: '#3b82f6',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

// 🧊 加载冷书签列表与白名单状态
async function loadColdBookmarks() {
    const coldList = document.getElementById('cold-list');
    const archiveBtn = document.getElementById('btn-archive-all');

    const storageData = await chrome.storage.local.get(['bookmarkStats', 'whitelist']);
    const stats = storageData.bookmarkStats || {};
    const whitelist = storageData.whitelist || []; // 存 ID 数组

    chrome.bookmarks.getTree(nodes => {
        const allBookmarks = [];
        function traverse(node) {
            // 过滤掉已经在冷库文件夹里的书签，防止重复扫描
            if (node.title === '🧊 BookmarkFlow Cold Vault') return;
            if (node.url) allBookmarks.push(node);
            if (node.children) node.children.forEach(traverse);
        }
        nodes.forEach(traverse);

        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        // 筛选规则：最近访问时间 < 30 天前（或者从来没访问过且添加时间 > 30 天前）
        const coldBookmarks = allBookmarks.filter(bm => {
            const stat = stats[bm.id];
            const lastVisited = stat ? stat.lastVisited : (bm.dateAdded || 0);
            return lastVisited < thirtyDaysAgo;
        });

        coldBookmarkIds = [];
        coldList.innerHTML = '';

        if (coldBookmarks.length === 0) {
            coldList.innerHTML = '<div style="text-align:center; padding: 20px; color: #94a3b8; font-size:12px;">🎉 Great! No cold bookmarks found.</div>';
            archiveBtn.disabled = true;
            archiveBtn.innerText = 'Move to Cold Vault';
            return;
        }

        coldBookmarks.forEach(bm => {
            const isWhitelisted = whitelist.includes(bm.id);
            if (!isWhitelisted) {
                coldBookmarkIds.push(bm.id);
            }

            const li = document.createElement('li');
            li.className = 'item-row';
            li.innerHTML = `
        <div class="item-title" title="${bm.url}">${bm.title || bm.url}</div>
        <div>
          <button class="btn-small ${isWhitelisted ? 'pinned' : ''}" data-id="${bm.id}">
            ${isWhitelisted ? '⭐ Protected' : '☆ Whitelist'}
          </button>
        </div>
      `;

            // 点击切换白名单机制
            li.querySelector('.btn-small').addEventListener('click', (e) => {
                toggleWhitelist(bm.id);
            });

            coldList.appendChild(li);
        });

        archiveBtn.disabled = coldBookmarkIds.length === 0;
        archiveBtn.innerText = `Move ${coldBookmarkIds.length} Bookmarks to Cold Vault`;
    });
}

// 切换白名单函数
async function toggleWhitelist(id) {
    const storageData = await chrome.storage.local.get('whitelist');
    let whitelist = storageData.whitelist || [];

    if (whitelist.includes(id)) {
        whitelist = whitelist.filter(item => item !== id);
    } else {
        whitelist.push(id);
    }

    await chrome.storage.local.set({ whitelist });
    loadColdBookmarks(); // 重新加载渲染
}

// 执行归档
function archiveColdBookmarks() {
    if (coldBookmarkIds.length === 0) return;

    const archiveBtn = document.getElementById('btn-archive-all');
    archiveBtn.disabled = true;
    archiveBtn.innerText = 'Archiving...';

    chrome.runtime.sendMessage({ action: 'archiveBookmarks', bookmarkIds: coldBookmarkIds }, (response) => {
        if (response && response.status === 'success') {
            alert(`Successfully moved ${coldBookmarkIds.length} cold bookmarks to Cold Vault!`);
            loadColdBookmarks(); // 刷新列表
        }
    });
}
