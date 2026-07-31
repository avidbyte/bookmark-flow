let chartInstance = null;
let currentRange = '1'; // 默认看 24 小时

document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    loadAnalytics('1');
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
        else timeThreshold = 0; // All time

        // 计算指定时间范围内的点击数
        const analytics = allBookmarks.map(bm => {
            const stat = stats[bm.id] || { visits: 0, timestamps: [] };

            let count = 0;
            if (range === 'all') {
                count = stat.visits || 0;
            } else {
                // 过滤出符合时间戳阈值的点击次数
                const timestamps = stat.timestamps || [];
                count = timestamps.filter(ts => ts >= timeThreshold).length;
            }

            return {
                title: bm.title || bm.url,
                count: count
            };
        });

        // 过滤掉点击为 0 的，并按点击量排序取前 10
        const topData = analytics
            .filter(item => item.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        renderChart(topData);
    });
}

function renderChart(data) {
    const ctx = document.getElementById('topChart').getContext('2d');

    if (chartInstance) {
        chartInstance.destroy(); // 销毁旧图表再重绘
    }

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
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}
