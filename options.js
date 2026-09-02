let chartInstance = null;
let currentRange = '1';
let coldBookmarkIds = [];
let cachedAnalyticsData = [];
let allCustomFolders = [];

// 通用工具：递归获取所有书签节点
function getAllBookmarks(nodes) {
    const allBookmarks = [];
    function traverse(node) {
        if (node.title === '🧊 BookmarkFlow Cold Vault' || node.title === '🧊 BookmarkFlow 冷库') return;
        if (node.url) allBookmarks.push(node);
        if (node.children) node.children.forEach(traverse);
    }
    nodes.forEach(traverse);
    return allBookmarks;
}

// 统一更新 DOM 中含有 i18n 标识的元素
function applyI18nTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.innerHTML = msg;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.setAttribute('placeholder', msg);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    applyI18nTranslations();
    initFilters();
    initAllDataToggle();
    initFolderSearch();
    initColdDaysSelect();
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
    const yearPlaceholder = chrome.i18n.getMessage('rangeYearPlaceholder') || 'By Year...';
    const yearSuffix = chrome.i18n.getMessage('yearSuffix') || ' Year';

    yearSelect.innerHTML = `<option value="" disabled selected>${yearPlaceholder}</option>`;
    for (let y = currentYear; y >= currentYear - 9; y--) {
        const opt = document.createElement('option');
        opt.value = `year_${y}`;
        opt.textContent = `${y}${yearSuffix}`;
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

    const existingOverlay = container.querySelector('.chart-empty-overlay');
    if (existingOverlay) existingOverlay.remove();

    if (!data || data.length === 0) {
        if (chartInstance) chartInstance.destroy();
        const emptyOverlay = document.createElement('div');
        emptyOverlay.className = 'chart-empty-overlay';
        const emptyText = chrome.i18n.getMessage('chartEmpty') || 'No visits recorded in this period';
        emptyOverlay.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 6px;">📊</div>
            <div>${emptyText}</div>
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
    const visitsLabel = chrome.i18n.getMessage('visitsLabel') || 'Visits';

    const bgColors = counts.map((_, index) => {
        if (index === 0) return '#2563eb';
        if (index < 3) return '#3b82f6';
        return '#93c5fd';
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
                label: visitsLabel,
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
                        autoSkip: false,
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
        const noBookmarksText = chrome.i18n.getMessage('noBookmarksFound') || 'No bookmarks found.';
        tbody.innerHTML = `<tr><td colspan="4" class="empty-state">${noBookmarksText}</td></tr>`;
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
            if (node.title === '🧊 BookmarkFlow Cold Vault' || node.title === '🧊 BookmarkFlow 冷库') return;
            if (!node.url && node.id !== '0' && node.id !== '1' && node.id !== '2') {
                allCustomFolders.push({
                    id: node.id,
                    title: node.title,
                    pathArr: [...pathArr]
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

function renderFolderList(folders, selectedFoldersSet) {
    const folderList = document.getElementById('folder-list');
    if (!folderList) return;

    folderList.innerHTML = '';
    if (folders.length === 0) {
        const noFoldersText = chrome.i18n.getMessage('noFoldersFound') || 'No folders found.';
        folderList.innerHTML = `<div style="text-align:center; padding: 20px; color: #94a3b8; font-size:12px;">${noFoldersText}</div>`;
        return;
    }

    folders.forEach(folder => {
        const div = document.createElement('div');
        div.className = 'folder-item';
        const isChecked = selectedFoldersSet.has(folder.id);

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
    btn.innerText = chrome.i18n.getMessage('sorting') || 'Sorting...';

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
            btn.innerText = chrome.i18n.getMessage('sortDone') || 'Done!';
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

/* ================= 3. 🧊 冷库归档部分 ================= */
async function initColdDaysSelect() {
    const select = document.getElementById('cold-days-select');
    if (!select) return;

    const storage = await chrome.storage.local.get('coldThresholdDays');
    if (storage.coldThresholdDays) {
        select.value = String(storage.coldThresholdDays);
    }

    select.addEventListener('change', async (e) => {
        const days = parseInt(e.target.value, 10);
        await chrome.storage.local.set({ coldThresholdDays: days });
        await loadColdBookmarks();
    });
}

async function loadColdBookmarks() {
    const coldList = document.getElementById('cold-list');
    const archiveBtn = document.getElementById('btn-archive-all');
    if (!coldList || !archiveBtn) return;

    const storageData = await chrome.storage.local.get(['bookmarkStats', 'whitelist', 'installedAt', 'coldThresholdDays']);
    const stats = storageData.bookmarkStats || {};
    const whitelist = storageData.whitelist || [];
    const installedAt = storageData.installedAt || Date.now();
    const thresholdDays = storageData.coldThresholdDays || 30; // 默认 30 天

    const now = Date.now();
    const THRESHOLD_MS = thresholdDays * 24 * 60 * 60 * 1000;
    const thresholdAgo = now - THRESHOLD_MS;

    const elapsedMs = now - installedAt;

    // 如果“实际安装时长”小于“配置的判定天数”，显示学习观察期
    if (elapsedMs < THRESHOLD_MS) {
        const installedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
        const remainingDays = Math.max(1, thresholdDays - installedDays);
        const percent = Math.min(100, Math.max(2, Math.round((installedDays / thresholdDays) * 100)));

        const learningTitle = chrome.i18n.getMessage('learningTitle', [String(installedDays), String(thresholdDays)]) || `⏳ Learning Your Habits (${installedDays}/${thresholdDays} Days)`;
        const learningDesc = chrome.i18n.getMessage('learningDesc', [String(thresholdDays), String(remainingDays)]) || `BookmarkFlow needs ${thresholdDays} days to observe your bookmark usage.<br>Cold vault recommendations will unlock in <strong>${remainingDays} day(s)</strong>.`;

        coldList.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 4px;">
                    ${learningTitle}
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${percent}%;"></div>
                </div>
                <div style="color: #64748b; font-size: 12px; line-height: 1.5; margin-top: 6px;">
                    ${learningDesc}
                </div>
            </div>
        `;
        archiveBtn.disabled = true;
        archiveBtn.innerText = chrome.i18n.getMessage('learningInProgress') || 'Learning in Progress...';
        return;
    }

    chrome.bookmarks.getTree(nodes => {
        const allBookmarks = getAllBookmarks(nodes);

        const coldBookmarks = allBookmarks.filter(bm => {
            const stat = stats[bm.id];
            const lastVisited = stat ? stat.lastVisited : 0;
            return lastVisited < thresholdAgo;
        });

        coldBookmarkIds = [];
        coldList.innerHTML = '';

        if (coldBookmarks.length === 0) {
            const noColdText = chrome.i18n.getMessage('noColdBookmarks') || `🎉 Great! No unvisited bookmarks found in the last ${thresholdDays} days.`;
            coldList.innerHTML = `<div class="empty-state">${noColdText}</div>`;
            archiveBtn.disabled = true;
            archiveBtn.innerText = chrome.i18n.getMessage('moveToColdVault') || 'Move to Cold Vault';
            return;
        }

        const protectedText = chrome.i18n.getMessage('protected') || '⭐ Protected';
        const whitelistText = chrome.i18n.getMessage('whitelist') || '☆ Whitelist';

        coldBookmarks.forEach(bm => {
            const isWhitelisted = whitelist.includes(bm.id);
            if (!isWhitelisted) coldBookmarkIds.push(bm.id);

            const li = document.createElement('li');
            li.className = 'item-row';
            li.innerHTML = `
                <div class="item-title" title="${bm.url}">${bm.title || bm.url}</div>
                <div>
                  <button class="btn-small ${isWhitelisted ? 'pinned' : ''}" data-id="${bm.id}">
                    ${isWhitelisted ? protectedText : whitelistText}
                  </button>
                </div>
            `;

            li.querySelector('.btn-small')?.addEventListener('click', async () => {
                await toggleWhitelist(bm.id);
            });
            coldList.appendChild(li);
        });

        archiveBtn.disabled = coldBookmarkIds.length === 0;
        archiveBtn.innerText = chrome.i18n.getMessage('moveXToColdVault', [String(coldBookmarkIds.length)]) || `Move ${coldBookmarkIds.length} Bookmarks to Cold Vault`;
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
    archiveBtn.innerText = chrome.i18n.getMessage('archiving') || 'Archiving...';

    chrome.runtime.sendMessage({ action: 'archiveBookmarks', bookmarkIds: coldBookmarkIds }).then((response) => {
        if (response && response.status === 'success') {
            loadColdBookmarks().catch(console.error);
        }
    }).catch(console.error);
}
