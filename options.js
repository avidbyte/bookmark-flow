let chartInstance = null;
let currentRange = '1';
let coldBookmarkIds = [];

// 通用工具：递归获取所有书签节点
function getAllBookmarks(nodes) {
    const allBookmarks = [];
    function traverse(node) {
        if (node.title === '🧊 BookmarkFlow Cold Vault') return;
        if (node.url) allBookmarks.push(node);
        if (node.children) node.children.forEach(traverse);
    }
    nodes.forEach(traverse);
    return allBookmarks;
}

document.addEventListener('DOMContentLoaded', async () => {
    initFilters();
    loadAnalytics('1');
    await loadColdBookmarks().catch(console.error);
    await initFolderSortSettings().catch(console.error);

    document.getElementById('btn-archive-all')?.addEventListener('click', archiveColdBookmarks);
    document.getElementById('btn-run-sort')?.addEventListener('click', runSortNow);
});

/* ================= 1. 图表部分 ================= */
function initFilters() {
    const buttons = document.querySelectorAll('.btn-filter:not(select)');
    const yearSelect = document.getElementById('year-filter');

    if (!yearSelect) return;

    const currentYear = new Date().getFullYear();
    yearSelect.innerHTML = '<option value="" disabled selected>By Year...</option>';
    for (let y = currentYear; y >= currentYear - 9; y--) {
        const opt = document.createElement('option');
        opt.value = `year_${y}`;
        opt.textContent = `${y} Year`;
        yearSelect.appendChild(opt);
    }

    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget;
            buttons.forEach(b => b.classList.remove('active'));
            yearSelect.classList.remove('active');
            yearSelect.selectedIndex = 0;

            target.classList.add('active');
            currentRange = target.getAttribute('data-range') || '1';
            loadAnalytics(currentRange);
        });
    });

    yearSelect.addEventListener('change', (e) => {
        const target = e.target;
        buttons.forEach(b => b.classList.remove('active'));
        yearSelect.classList.add('active');

        currentRange = target.value;
        loadAnalytics(currentRange);
    });
}

function loadAnalytics(range) {
    chrome.bookmarks.getTree(async (nodes) => {
        const allBookmarks = getAllBookmarks(nodes);

        const storageData = await chrome.storage.local.get('bookmarkStats') || {};
        const stats = storageData.bookmarkStats || {};

        const now = Date.now();
        let startTime = 0;
        let endTime = Infinity;

        if (range.startsWith('year_')) {
            const targetYear = parseInt(range.split('_')[1], 10);
            startTime = new Date(targetYear, 0, 1, 0, 0, 0).getTime();
            endTime = new Date(targetYear + 1, 0, 1, 0, 0, 0).getTime() - 1;
        } else if (range === '1') {
            startTime = now - 24 * 60 * 60 * 1000;
        } else if (range === '7') {
            startTime = now - 7 * 24 * 60 * 60 * 1000;
        } else if (range === '30') {
            startTime = now - 30 * 24 * 60 * 60 * 1000;
        } else if (range === '90') {
            startTime = now - 90 * 24 * 60 * 60 * 1000;
        } else if (range === '365') {
            startTime = now - 365 * 24 * 60 * 60 * 1000;
        } else {
            startTime = 0;
        }

        const analytics = allBookmarks.map(bm => {
            const stat = stats[bm.id] || { visits: 0, timestamps: [] };
            let count;
            if (range === 'all') {
                count = stat.visits || 0;
            } else {
                const timestamps = stat.timestamps || [];
                count = timestamps.filter(ts => ts >= startTime && ts <= endTime).length;
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
    const canvas = document.getElementById('topChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    const labels = data.map(d => d.title.length > 20 ? d.title.substring(0, 20) + '...' : d.title);
    const counts = data.map(d => d.count);

    // @ts-ignore
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

/* ================= 2. ⚡ 文件夹重排配置逻辑 ================= */
async function initFolderSortSettings() {
    const folderList = document.getElementById('folder-list');
    const radios = document.querySelectorAll('input[name="sortMode"]');
    if (!folderList) return;

    const config = await chrome.storage.local.get(['sortMode', 'selectedFolders']);
    const savedMode = config.sortMode || 'exclude';
    const selectedArray = Array.isArray(config.selectedFolders) ? config.selectedFolders : [];
    const selectedFolders = new Set(selectedArray);

    radios.forEach(r => {
        const input = r;
        input.checked = (input.value === savedMode);
        input.addEventListener('change', async (e) => {
            const target = e.target;
            await chrome.storage.local.set({ sortMode: target.value });
        });
    });

    chrome.bookmarks.getTree(tree => {
        const folders = [];
        function traverse(node, path = '') {
            if (node.title === '🧊 BookmarkFlow Cold Vault') return;
            if (!node.url && node.id !== '0' && node.id !== '1' && node.id !== '2') {
                const fullPath = path ? `${path} / ${node.title}` : node.title;
                folders.push({ id: node.id, title: fullPath });
            }
            if (node.children) {
                node.children.forEach(child => traverse(child, path ? `${path} / ${node.title}` : node.title));
            }
        }
        tree.forEach(node => traverse(node));

        folderList.innerHTML = '';
        if (folders.length === 0) {
            folderList.innerHTML = '<div style="text-align:center; padding: 20px; color: #94a3b8; font-size:12px;">No custom folders found.</div>';
            return;
        }

        folders.forEach(folder => {
            const div = document.createElement('div');
            div.className = 'folder-item';
            const isChecked = selectedFolders.has(folder.id);

            div.innerHTML = `
        <input type="checkbox" id="folder-${folder.id}" value="${folder.id}" ${isChecked ? 'checked' : ''} />
        <label for="folder-${folder.id}" style="cursor:pointer; flex:1;">📁 ${folder.title}</label>
      `;

            div.querySelector('input')?.addEventListener('change', async () => {
                const checkboxes = folderList.querySelectorAll('input[type="checkbox"]:checked');
                const updatedSelected = Array.from(checkboxes).map(cb => cb.value);
                await chrome.storage.local.set({ selectedFolders: updatedSelected });
            });

            folderList.appendChild(div);
        });
    });
}

// ⚡ 手动重排按钮逻辑（已注入超时保护）
async function runSortNow() {
    const btn = document.getElementById('btn-run-sort');
    if (!btn) return;

    btn.disabled = true;
    const originalText = btn.innerText;
    btn.innerText = 'Sorting...';

    // 8 秒超时强制恢复机制
    let isFinished = false;
    const timeoutTimer = setTimeout(() => {
        if (!isFinished) {
            btn.disabled = false;
            btn.innerText = originalText;
            alert('Sorting is taking longer than expected. Please check Service Worker logs.');
        }
    }, 8000);

    try {
        const response = await chrome.runtime.sendMessage({ action: 'triggerManualSort' });
        isFinished = true;
        clearTimeout(timeoutTimer);

        if (response && response.status === 'success') {
            btn.innerText = 'Done!';
            setTimeout(() => {
                btn.innerText = originalText;
                btn.disabled = false;
            }, 1200);
        } else {
            alert('Sort failed: ' + (response?.error || 'Unknown error'));
            btn.disabled = false;
            btn.innerText = originalText;
        }
    } catch (err) {
        isFinished = true;
        clearTimeout(timeoutTimer);
        console.error('Run sort error:', err);
        alert('Failed to execute sort process.');
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

/* ================= 3. 🧊 冷库归档部分（含冷启动观察期保护） ================= */
async function loadColdBookmarks() {
    const coldList = document.getElementById('cold-list');
    const archiveBtn = document.getElementById('btn-archive-all');
    if (!coldList || !archiveBtn) return;

    // 读取数据，增加 installedAt
    const storageData = await chrome.storage.local.get(['bookmarkStats', 'whitelist', 'installedAt']);
    const stats = storageData.bookmarkStats || {};
    const whitelist = storageData.whitelist || [];
    // 如果因开发或旧版本没有 installedAt，则默认以当前时间为准
    const installedAt = storageData.installedAt || Date.now();

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - THIRTY_DAYS_MS;

    // 🛡️ 防御机制：判断插件安装时间是否满 30 天
    const elapsedMs = now - installedAt;
    if (elapsedMs < THIRTY_DAYS_MS) {
        const installedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
        const remainingDays = Math.max(1, 30 - installedDays);

        coldList.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 6px;">
                    ⏳ Learning Your Habits (${installedDays}/30 Days)
                </div>
                <div style="color: #64748b; font-size: 12px; line-height: 1.5;">
                    BookmarkFlow needs 30 days to observe your bookmark usage.<br>
                    Cold vault recommendations will unlock in <strong>${remainingDays} day(s)</strong>.
                </div>
            </div>
        `;
        archiveBtn.disabled = true;
        archiveBtn.innerText = 'Learning in Progress...';
        return;
    }

    // 网页正常满 30 天后：执行冷书签搜寻
    chrome.bookmarks.getTree(nodes => {
        const allBookmarks = getAllBookmarks(nodes);

        const coldBookmarks = allBookmarks.filter(bm => {
            const stat = stats[bm.id];

            // 💡 判定核心：
            // 1. 若有点击，看最后点击时间是否早于 30 天前；
            // 2. 若无点击，由于安装已满 30 天且一次未点，直接视为 0 (< thirtyDaysAgo)，判定为冷书签
            const lastVisited = stat ? stat.lastVisited : 0;
            return lastVisited < thirtyDaysAgo;
        });

        coldBookmarkIds = [];
        coldList.innerHTML = '';

        if (coldBookmarks.length === 0) {
            coldList.innerHTML = '<div class="empty-state">🎉 Great! No unvisited bookmarks found in the last 30 days.</div>';
            archiveBtn.disabled = true;
            archiveBtn.innerText = 'Move to Cold Vault';
            return;
        }

        coldBookmarks.forEach(bm => {
            const isWhitelisted = whitelist.includes(bm.id);
            if (!isWhitelisted) coldBookmarkIds.push(bm.id);

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

            li.querySelector('.btn-small')?.addEventListener('click', async () => {
                await toggleWhitelist(bm.id);
            });
            coldList.appendChild(li);
        });

        archiveBtn.disabled = coldBookmarkIds.length === 0;
        archiveBtn.innerText = `Move ${coldBookmarkIds.length} Bookmarks to Cold Vault`;
    });
}

async function toggleWhitelist(id) {
    const storageData = await chrome.storage.local.get('whitelist');
    let whitelist = storageData.whitelist || [];
    if (whitelist.includes(id)) {
        whitelist = whitelist.filter(item => item !== id);
    } else {
        whitelist.push(id);
    }
    await chrome.storage.local.set({ whitelist });
    await loadColdBookmarks();
}

function archiveColdBookmarks() {
    if (coldBookmarkIds.length === 0) return;
    const archiveBtn = document.getElementById('btn-archive-all');
    if (!archiveBtn) return;
    archiveBtn.disabled = true;
    archiveBtn.innerText = 'Archiving...';

    chrome.runtime.sendMessage({ action: 'archiveBookmarks', bookmarkIds: coldBookmarkIds }).then((response) => {
        if (response && response.status === 'success') {
            alert(`Successfully moved ${coldBookmarkIds.length} cold bookmarks to Cold Vault!`);
            loadColdBookmarks().catch(console.error);
        }
    }).catch(console.error);
}
