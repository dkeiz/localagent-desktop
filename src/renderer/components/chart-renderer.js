(function () {
    const MAX_POINTS = 40;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toFiniteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    function normalizeChartSpec(spec) {
        const raw = Array.isArray(spec?.charts) ? spec.charts[0] : spec;
        if (!raw || typeof raw !== 'object') return null;

        let labels = [];
        let values = [];
        const data = Array.isArray(raw.data) ? raw.data : null;

        if (Array.isArray(raw.labels)) {
            labels = raw.labels.map(value => String(value));
        } else if (data) {
            labels = data.map((point, index) => {
                if (point && typeof point === 'object') {
                    return String(point.label ?? point.name ?? point.x ?? index + 1);
                }
                return String(index + 1);
            });
        }

        if (Array.isArray(raw.values)) {
            values = raw.values.map(toFiniteNumber);
        } else if (data) {
            values = data.map(point => {
                if (point && typeof point === 'object') {
                    return toFiniteNumber(point.value ?? point.y ?? point.count ?? 0);
                }
                return toFiniteNumber(point);
            });
        } else if (Array.isArray(raw.series?.[0]?.data)) {
            values = raw.series[0].data.map(toFiniteNumber);
            if (labels.length === 0 && Array.isArray(raw.series[0].labels)) {
                labels = raw.series[0].labels.map(value => String(value));
            }
        }

        values = values.slice(0, MAX_POINTS);
        labels = values.map((value, index) => labels[index] || String(index + 1));

        return {
            type: ['bar', 'line', 'table'].includes(String(raw.type || '').toLowerCase())
                ? String(raw.type).toLowerCase()
                : 'bar',
            title: String(raw.title || spec?.title || 'Chart'),
            labels,
            values
        };
    }

    function renderEmpty(message) {
        return `<div class="agent-chart-empty">${escapeHtml(message || 'No chart data.')}</div>`;
    }

    function renderBars(chart) {
        const maxValue = Math.max(...chart.values.map(value => Math.abs(value)), 1);
        const width = Math.max(320, chart.values.length * 42 + 58);
        const height = 190;
        const plotHeight = 118;
        const step = (width - 64) / Math.max(chart.values.length, 1);
        const barWidth = Math.max(14, Math.floor(step) - 8);
        const bars = chart.values.map((value, index) => {
            const barHeight = Math.max(1, Math.round((Math.abs(value) / maxValue) * plotHeight));
            const x = 36 + index * step + Math.max(0, (step - barWidth) / 2);
            const y = height - 38 - barHeight;
            return `<g>
                <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3"></rect>
                <text x="${x + barWidth / 2}" y="${height - 18}" text-anchor="middle">${escapeHtml(chart.labels[index])}</text>
                <text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle">${escapeHtml(value)}</text>
            </g>`;
        }).join('');

        return `<svg class="agent-chart-svg bar" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.title)}">
            <line x1="30" y1="22" x2="30" y2="${height - 38}"></line>
            <line x1="30" y1="${height - 38}" x2="${width - 18}" y2="${height - 38}"></line>
            ${bars}
        </svg>`;
    }

    function renderLine(chart) {
        const width = Math.max(320, chart.values.length * 42 + 58);
        const height = 190;
        const maxValue = Math.max(...chart.values.map(value => Math.abs(value)), 1);
        const span = Math.max(chart.values.length - 1, 1);
        const points = chart.values.map((value, index) => {
            const x = 34 + ((width - 70) / span) * index;
            const y = height - 38 - ((Math.abs(value) / maxValue) * 118);
            return `${x},${y}`;
        }).join(' ');
        const dots = chart.values.map((value, index) => {
            const x = 34 + ((width - 70) / span) * index;
            const y = height - 38 - ((Math.abs(value) / maxValue) * 118);
            return `<circle cx="${x}" cy="${y}" r="4"></circle>
                <text x="${x}" y="${height - 18}" text-anchor="middle">${escapeHtml(chart.labels[index])}</text>`;
        }).join('');

        return `<svg class="agent-chart-svg line" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.title)}">
            <line x1="30" y1="22" x2="30" y2="${height - 38}"></line>
            <line x1="30" y1="${height - 38}" x2="${width - 18}" y2="${height - 38}"></line>
            <polyline points="${points}"></polyline>
            ${dots}
        </svg>`;
    }

    function renderTable(chart) {
        const rows = chart.values.map((value, index) => `
            <tr><th>${escapeHtml(chart.labels[index])}</th><td>${escapeHtml(value)}</td></tr>
        `).join('');
        return `<table class="agent-chart-table"><tbody>${rows}</tbody></table>`;
    }

    function renderChart(spec) {
        const chart = normalizeChartSpec(spec);
        if (!chart || chart.values.length === 0) {
            return renderEmpty('No chart data.');
        }

        const body = chart.type === 'line'
            ? renderLine(chart)
            : chart.type === 'table'
                ? renderTable(chart)
                : renderBars(chart);

        return `<div class="agent-chart-frame">
            <h4>${escapeHtml(chart.title)}</h4>
            ${body}
        </div>`;
    }

    function readHostSpec(host) {
        const raw = host?.dataset?.agentChart || host?.dataset?.chartSpec || '';
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (error) {
            return { __chartError: error.message };
        }
    }

    function hydrate(root) {
        const scope = root || (typeof document !== 'undefined' ? document : null);
        if (!scope?.querySelectorAll) return;

        scope.querySelectorAll('[data-agent-chart], [data-chart-spec]').forEach(host => {
            const spec = readHostSpec(host);
            if (spec?.__chartError) {
                host.innerHTML = renderEmpty(`Invalid chart JSON: ${spec.__chartError}`);
                return;
            }
            host.classList?.add('agent-chart-host');
            host.innerHTML = renderChart(spec);
            host.dataset.agentChartRendered = 'true';
        });
    }

    const api = {
        hydrate,
        normalize: normalizeChartSpec,
        render: renderChart
    };

    const target = typeof window !== 'undefined' ? window : globalThis;
    target.agentChartRenderer = api;
})();
