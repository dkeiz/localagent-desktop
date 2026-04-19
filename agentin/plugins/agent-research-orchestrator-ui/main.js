const fs = require('fs');
const path = require('path');

const MAX_CHART_FILES = 24;
const MAX_DEPTH = 4;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
}

function listFiles(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
        .map(entry => {
            const fullPath = path.join(dirPath, entry.name);
            const stat = fs.statSync(fullPath);
            return {
                name: entry.name,
                size: stat.size,
                modifiedAt: stat.mtime
            };
        })
        .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

function renderFileChips(files, emptyText) {
    if (files.length === 0) {
        return `<div class="research-empty">${escapeHtml(emptyText)}</div>`;
    }
    return files.slice(0, 6).map(file => `
        <span class="research-file-chip" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
    `).join('');
}

function isInside(baseDir, targetPath) {
    if (!baseDir) return false;
    const base = path.resolve(baseDir || '');
    const target = path.resolve(targetPath || '');
    return target === base || target.startsWith(base + path.sep);
}

function isChartFile(fileName) {
    const lower = String(fileName || '').toLowerCase();
    return lower.endsWith('.chart.json')
        || lower.endsWith('.charts.json')
        || lower === 'chart.json'
        || lower === 'charts.json';
}

function walkChartFiles(baseDir, relativeDir = '', depth = 0, files = []) {
    if (!baseDir || !fs.existsSync(baseDir) || depth > MAX_DEPTH || files.length >= MAX_CHART_FILES) return files;
    const dirPath = path.join(baseDir, relativeDir);
    if (!isInside(baseDir, dirPath)) return files;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => !entry.name.startsWith('.'))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (files.length >= MAX_CHART_FILES) break;
        const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
        const fullPath = path.join(baseDir, relativePath);
        if (!isInside(baseDir, fullPath)) continue;

        if (entry.isDirectory()) {
            walkChartFiles(baseDir, relativePath, depth + 1, files);
        } else if (entry.isFile() && isChartFile(entry.name)) {
            const stat = fs.statSync(fullPath);
            files.push({ name: entry.name, relativePath, modifiedAt: stat.mtime });
        }
    }

    return files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

function readChartSpec(baseDir, relativePath) {
    const filePath = path.resolve(baseDir || '', String(relativePath || ''));
    if (!isInside(baseDir, filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return { error: 'Chart artifact was not found.' };
    }
    try {
        return { spec: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
    } catch (error) {
        return { error: `Invalid chart JSON: ${error.message}` };
    }
}

function renderChartHost(result) {
    if (!result?.spec) {
        return `<div class="agent-chart-empty">${escapeHtml(result?.error || 'No chart artifacts yet.')}</div>`;
    }
    return `<div class="agent-chart-host research-chart-host" data-agent-chart="${escapeAttribute(JSON.stringify(result.spec))}"></div>`;
}

function renderChartButtons(files) {
    return files.map(file => `
        <button type="button" title="${escapeHtml(file.relativePath)}" data-agent-ui-action="preview-chart" data-relative-path="${escapeHtml(file.relativePath)}">
            ${escapeHtml(file.relativePath)}
        </button>
    `).join('') || '<span>No chart artifacts yet.</span>';
}

function renderPanel(agentInfo) {
    const home = agentInfo.folderPath || '';
    const tasks = listFiles(path.join(home, 'tasks'));
    const outputs = listFiles(path.join(home, 'outputs'));
    const latest = outputs[0] || tasks[0] || null;
    const chartFiles = walkChartFiles(home);
    const firstChart = chartFiles[0]
        ? readChartSpec(home, chartFiles[0].relativePath)
        : { error: 'No chart artifacts yet.' };

    return `<section class="research-orchestrator-panel">
        <div class="research-agent-topbar">
            <strong>Research Orchestrator</strong>
            <button type="button" title="Refresh" data-agent-ui-action="refresh">Refresh</button>
        </div>
        <div class="research-agent-metrics">
            <div><strong>${tasks.length}</strong><span>Plans</span></div>
            <div><strong>${outputs.length}</strong><span>Outputs</span></div>
            <div><strong>${escapeHtml(latest ? latest.name : 'None')}</strong><span>Latest</span></div>
        </div>
        <div class="research-agent-lanes">
            <section>
                <h4>Tasks</h4>
                <div>${renderFileChips(tasks, 'No task files yet.')}</div>
            </section>
            <section>
                <h4>Outputs</h4>
                <div>${renderFileChips(outputs, 'No output files yet.')}</div>
            </section>
        </div>
        <section class="research-chart-section">
            <div class="research-chart-title">
                <h4>Charts</h4>
            </div>
            <div class="research-chart-layout">
                <div class="research-chart-files">${renderChartButtons(chartFiles)}</div>
                <div data-research-chart-preview>${renderChartHost(firstChart)}</div>
            </div>
        </section>
    </section>`;
}

const css = `
.research-orchestrator-panel {
    margin-bottom: 8px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--card-bg);
}
.research-agent-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border-color);
}
.research-agent-topbar button {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
}
.research-agent-metrics {
    display: grid;
    grid-template-columns: 80px 80px minmax(0, 1fr);
    gap: 8px;
    padding: 10px;
}
.research-agent-metrics div {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.research-agent-metrics strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.research-agent-metrics span,
.research-empty {
    color: var(--text-secondary);
    font-size: var(--text-xs);
}
.research-agent-lanes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 0 10px 10px;
}
.research-agent-lanes h4 {
    margin: 0 0 6px;
}
.research-chart-section {
    padding: 0 10px 10px;
}
.research-chart-title h4 {
    margin: 0 0 6px;
}
.research-chart-layout {
    display: grid;
    grid-template-columns: minmax(120px, 0.36fr) minmax(220px, 0.64fr);
    gap: 10px;
}
.research-chart-files {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 172px;
    overflow: auto;
    color: var(--text-secondary);
    font-size: var(--text-xs);
}
.research-chart-files button {
    min-height: 26px;
    padding: 0 7px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
}
.research-chart-files button:hover {
    background: rgba(74, 158, 255, 0.1);
}
.research-chart-host .agent-chart-svg {
    max-height: 180px;
}
.research-file-chip {
    display: inline-block;
    max-width: 100%;
    margin: 0 4px 4px 0;
    padding: 3px 7px;
    border-radius: 4px;
    background: rgba(74, 158, 255, 0.1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
`;

module.exports = {
    onEnable(context) {
        context.registerChatUI({
            title: 'Research Orchestrator',
            renderPanel,
            css,
            actions: {
                refresh({ render, pluginId }) {
                    return { success: true, pluginId, html: render(), css };
                },
                'preview-chart'({ agentInfo, payload }) {
                    const result = readChartSpec(agentInfo.folderPath || '', payload.relativePath);
                    return {
                        success: true,
                        replaceHtml: {
                            selector: '[data-research-chart-preview]',
                            html: renderChartHost(result)
                        }
                    };
                }
            },
            onTabActivated(agentInfo, payload, pluginContext) {
                pluginContext.log(`Research UI active for ${agentInfo.name}`);
            }
        });
        context.log('Research Orchestrator UI registered');
    },
    onDisable() {
        console.log('[agent-research-orchestrator-ui] Disabled');
    }
};
