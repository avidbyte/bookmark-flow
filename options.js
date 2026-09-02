let chartInstance = null;
let currentRange = '1';
let coldBookmarkIds = [];
let cachedAnalyticsData = []; // 💡 全局缓存当前时间段下的完整数据，供表格渲染与搜索使用

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
    initAllDataToggle(); // 💡 初始化 Show All Data 面板折叠与搜索事件
    loadAnalytics('1');
    await loadColdBookmarks().catch(console.error);
    await initFolderSortSettings().catch(console.error);

    document.getElementById('btn-archive-all')?.addEventListener('click', archiveColdBookmarks);
    document.getElementById('btn-run-sort')?.addEventListener('click', runSortNow);
});

/* ================= 1. 图表与全量列表部分 ================= */
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
            // 💡 补充传递 id 和 url，方便全量表格和点击跳转使用
            return {
                id: bm.id,
                title: bm.title || bm.url || 'Untitled',
                url: bm.url || '',
                count: count
            };
        });

        // 💡 缓存按访问量降序排列的全量数据
        cachedAnalyticsData = analytics.sort((a, b) => b.count - a.count);

        // 图表依然只拉取有访问量的 Top 10，保持精美
        const topData = cachedAnalyticsData
            .filter(item => item.count > 0)
            .slice(0, 10);

        renderChart(topData);

        // 💡 同步渲染全量数据表格（包含点击量为 0 的书签）
        renderAllDataTable(cachedAnalyticsData);
    });
}

function renderChart(data) {
    const canvas = document.getElementById('topChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    // 格式化文本：超过 12 个字符则截断，鼠标悬浮时可通过 Tooltip 查看完整标题
    const labels = data.map(d => d.title.length > 12 ? d.title.substring(0, 12) + '...' : d.title);
    const fullTitles = data.map(d => d.title); // 传给 Tooltip 用的完整标题
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
                hoverBackgroundColor: '#2563eb',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    bottom: 10 // 预留底部边距
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        // 悬浮时显示完整标题，解决截断后的可读性问题
                        title: (tooltipItems) => fullTitles[tooltipItems[0].dataIndex]
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false }, // 隐藏 X 轴竖向网格线，页面视觉更干净
                    ticks: {
                        font: { size: 11 },
                        color: '#64748b',
                        maxRotation: 0, // 💡 关键：强制 0 度水平显示，不再倾斜
                        minRotation: 0,
                        autoSkip: true, // 节点过多时自动隐藏部分 Label 防止拥挤
                        // 进阶处理：防止单个极其宽烈的字符破坏排列，格式化 X 轴显示的文本
                        callback: function(value, index) {
                            const label = this.getLabelForValue(value);
                            return label.length > 8 ? label.substring(0, 8) + '...' : label;
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, color: '#64748b' },
                    grid: { color: '#f1f5f9' }
                }
            }
        }
    });
}

/* ================= 💡 2. Show All Data 全量表格逻辑 ================= */
function renderAllDataTable(data) {
    const tbody = document.getElementById('all-data-tbody');
    const totalCountSpan = document.getElementById('total-count');
    if (!tbody) return;

    if (totalCountSpan) {
        totalCountSpan.textContent = String(data.length);
    }

    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No bookmarks found matching your query.</td></tr>';
        return;
    }

    data.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align: center; color: #94a3b8;">${index + 1}</td>
            <td class="table-title" title="${item.title}">${item.title}</td>
            <td class="table-url" title="${item.url}">
                <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.url}</a>
            </td>
            <td style="text-align: right;">
                <span class="badge-visits">${item.count}</span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function initAllDataToggle() {
    const toggleBtn = document.getElementById('btn-toggle-all-data');
    const container = document.getElementById('all-data-container');
    const icon = document.getElementById('toggle-icon');
    const searchInput = document.getElementById('all-data-search');

    if (toggleBtn && container && icon) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = container.classList.toggle('hidden');
            icon.textContent = isHidden ? '▼' : '▲';
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = (e.target.value || '').toLowerCase().trim();
            const filtered = cachedAnalyticsData.filter(item =>
                item.title.toLowerCase().includes(query) ||
                item.url.toLowerCase().includes(query)
            );
            renderAllDataTable(filtered);
        });
    }
}

/* ================= 3. ⚡ 文件夹重排配置逻辑 ================= */
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

/* ================= 4. 🧊 冷库归档部分（含冷启动观察期保护） ================= */
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
