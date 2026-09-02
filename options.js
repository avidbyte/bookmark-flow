let chartInstance = null;
let currentRange = '1';
let coldBookmarkIds = [];
let cachedAnalyticsData = [];
let allCustomFolders = []; // 💡 缓存文件夹节点列表供即时搜索使用

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
    initAllDataToggle();
    initFolderSearch(); // 💡 初始化文件夹搜索框事件
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
            return {
                id: bm.id,
                title: bm.title || bm.url || 'Untitled',
                url: bm.url || '',
                count: count
            };
        });

        cachedAnalyticsData = analytics.sort((a, b) => b.count - a.count);

        const topData = cachedAnalyticsData
            .filter(item => item.count > 0)
            .slice(0, 10);

        renderChart(topData);
        renderAllDataTable(cachedAnalyticsData);
    });
}

function renderChart(data) {
    const canvas = document.getElementById('topChart');
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;

    // 💡 优化点 1：清理已有的 Empty Overlay
    const existingOverlay = container.querySelector('.chart-empty-overlay');
    if (existingOverlay) existingOverlay.remove();

    // 💡 优化点 1：无数据时渲染 Empty State 图示
    if (!data || data.length === 0) {
        if (chartInstance) chartInstance.destroy();
        const emptyOverlay = document.createElement('div');
        emptyOverlay.className = 'chart-empty-overlay';
        emptyOverlay.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 6px;">📊</div>
            <div>No visits recorded in this period</div>
        `;
        container.appendChild(emptyOverlay);
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    const labels = data.map(d => d.title.length > 12 ? d.title.substring(0, 12) + '...' : d.title);
    const fullTitles = data.map(d => d.title);
    const counts = data.map(d => d.count);

    // 💡 优化点 1：高亮 Top 1 / Top 2-3 颜色梯度
    const bgColors = counts.map((_, index) => {
        if (index === 0) return '#2563eb'; // Top 1: 皇家深蓝高亮
        if (index < 3) return '#3b82f6';  // Top 2-3: 标准蓝
        return '#93c5fd';                 // 其余：淡蓝色降维
    });

    const hoverBgColors = counts.map((_, index) => {
        if (index === 0) return '#1d4ed8';
        if (index < 3) return '#2563eb';
        return '#60a5fa';
    });

    // @ts-ignore
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Visits',
                data: counts,
                backgroundColor: bgColors,
                hoverBackgroundColor: hoverBgColors,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { bottom: 10 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (tooltipItems) => fullTitles[tooltipItems[0].dataIndex]
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { size: 11 },
                        color: '#64748b',
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: true,
                        callback: function(value) {
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

/* ================= Show All Data 全量表格逻辑 ================= */
function renderAllDataTable(data) {
    const tbody = document.getElementById('all-data-tbody');
    const totalCountSpan = document.getElementById('total-count');
    if (!tbody) return;

    if (totalCountSpan) totalCountSpan.textContent = String(data.length);

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

/* ================= 2. ⚡ 文件夹重排配置逻辑 ================= */
async function initFolderSortSettings() {
    const radios = document.querySelectorAll('input[name="sortMode"]');

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
        allCustomFolders = [];
        function traverse(node, pathArr = []) {
            if (node.title === '🧊 BookmarkFlow Cold Vault') return;
            if (!node.url && node.id !== '0' && node.id !== '1' && node.id !== '2') {
                allCustomFolders.push({
                    id: node.id,
                    title: node.title,
                    pathArr: [...pathArr] // 父级路径数组
                });
            }
            if (node.children) {
                node.children.forEach(child => {
                    if (!node.url && node.id !== '0') {
                        traverse(child, [...pathArr, node.title]);
                    } else {
                        traverse(child, pathArr);
                    }
                });
            }
        }
        tree.forEach(node => traverse(node));

        renderFolderList(allCustomFolders, selectedFolders);
    });
}

// 💡 优化点 2：渲染文件夹列表，支持层级视觉淡化
function renderFolderList(folders, selectedFoldersSet) {
    const folderList = document.getElementById('folder-list');
    if (!folderList) return;

    folderList.innerHTML = '';
    if (folders.length === 0) {
        folderList.innerHTML = '<div style="text-align:center; padding: 20px; color: #94a3b8; font-size:12px;">No folders found.</div>';
        return;
    }

    folders.forEach(folder => {
        const div = document.createElement('div');
        div.className = 'folder-item';
        const isChecked = selectedFoldersSet.has(folder.id);

        // 面包屑处理：让上级路径变灰变小，突出当前的文件夹名称
        const pathPrefix = folder.pathArr.length > 0
            ? `<span class="folder-path-prefix">${folder.pathArr.join(' / ')} / </span>`
            : '';

        div.innerHTML = `
            <input type="checkbox" id="folder-${folder.id}" value="${folder.id}" ${isChecked ? 'checked' : ''} />
            <label for="folder-${folder.id}" style="cursor:pointer; flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                📁 ${pathPrefix}<span class="folder-name-current">${folder.title}</span>
            </label>
        `;

        div.querySelector('input')?.addEventListener('change', async () => {
            const checkboxes = folderList.querySelectorAll('input[type="checkbox"]:checked');
            const updatedSelected = Array.from(checkboxes).map(cb => cb.value);
            await chrome.storage.local.set({ selectedFolders: updatedSelected });
        });

        folderList.appendChild(div);
    });
}

// 💡 优化点 2：搜索/过滤框事件监听
function initFolderSearch() {
    const searchInput = document.getElementById('folder-search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', async (e) => {
        const query = (e.target.value || '').toLowerCase().trim();
        const config = await chrome.storage.local.get('selectedFolders');
        const selectedFolders = new Set(Array.isArray(config.selectedFolders) ? config.selectedFolders : []);

        const filtered = allCustomFolders.filter(f => {
            const fullPathStr = [...f.pathArr, f.title].join(' / ').toLowerCase();
            return fullPathStr.includes(query);
        });

        renderFolderList(filtered, selectedFolders);
    });
}

async function runSortNow() {
    const btn = document.getElementById('btn-run-sort');
    if (!btn) return;

    btn.disabled = true;
    const originalText = btn.innerText;
    btn.innerText = 'Sorting...';

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

/* ================= 3. 🧊 冷库归档部分（含冷启动观察期保护与进度条） ================= */
async function loadColdBookmarks() {
    const coldList = document.getElementById('cold-list');
    const archiveBtn = document.getElementById('btn-archive-all');
    if (!coldList || !archiveBtn) return;

    const storageData = await chrome.storage.local.get(['bookmarkStats', 'whitelist', 'installedAt']);
    const stats = storageData.bookmarkStats || {};
    const whitelist = storageData.whitelist || [];
    const installedAt = storageData.installedAt || Date.now();

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - THIRTY_DAYS_MS;

    const elapsedMs = now - installedAt;
    if (elapsedMs < THIRTY_DAYS_MS) {
        const installedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
        const remainingDays = Math.max(1, 30 - installedDays);
        // 💡 优化点 3：计算进度百分比
        const percent = Math.min(100, Math.max(2, Math.round((installedDays / 30) * 100)));

        coldList.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 4px;">
                    ⏳ Learning Your Habits (${installedDays}/30 Days)
                </div>
                <!-- 💡 优化点 3：增加可视化动画 Progress Bar -->
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${percent}%;"></div>
                </div>
                <div style="color: #64748b; font-size: 12px; line-height: 1.5; margin-top: 6px;">
                    BookmarkFlow needs 30 days to observe your bookmark usage.<br>
                    Cold vault recommendations will unlock in <strong>${remainingDays} day(s)</strong>.
                </div>
            </div>
        `;
        archiveBtn.disabled = true;
        archiveBtn.innerText = 'Learning in Progress...';
        return;
    }

    chrome.bookmarks.getTree(nodes => {
        const allBookmarks = getAllBookmarks(nodes);

        const coldBookmarks = allBookmarks.filter(bm => {
            const stat = stats[bm.id];
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
