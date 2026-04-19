const fs = require('fs');
const path = require('path');

const MAX_FILES = 80;
const MAX_DEPTH = 4;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isInside(baseDir, targetPath) {
    if (!baseDir) return false;
    const base = path.resolve(baseDir);
    const target = path.resolve(targetPath);
    return target === base || target.startsWith(base + path.sep);
}

function walkFiles(baseDir, relativeDir = '', depth = 0, files = []) {
    if (files.length >= MAX_FILES || depth > MAX_DEPTH) return files;
    const dirPath = path.join(baseDir, relativeDir);
    if (!isInside(baseDir, dirPath) || !fs.existsSync(dirPath)) return files;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => !entry.name.startsWith('.'))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (files.length >= MAX_FILES) break;
        const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
        const fullPath = path.join(baseDir, relativePath);
        if (!isInside(baseDir, fullPath)) continue;

        if (entry.isDirectory()) {
            files.push({ type: 'directory', relativePath, name: entry.name, size: 0 });
            walkFiles(baseDir, relativePath, depth + 1, files);
            continue;
        }

        const stat = fs.statSync(fullPath);
        files.push({ type: 'file', relativePath, name: entry.name, size: stat.size });
    }
    return files;
}

function formatSize(size) {
    if (!size) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderRows(files, emptyText) {
    const rows = files.map(file => {
        const isFile = file.type === 'file';
        const tag = isFile ? 'button' : 'div';
        const attrs = isFile
            ? ` type="button" data-agent-ui-action="preview-file" data-relative-path="${escapeHtml(file.relativePath)}"`
            : '';
        return `<${tag} class="agent-file-row ${file.type}"${attrs}>
            <span class="agent-file-name">${escapeHtml(file.relativePath)}</span>
            <span class="agent-file-size">${escapeHtml(formatSize(file.size))}</span>
        </${tag}>`;
    }).join('');
    return rows || `<div class="agent-file-empty">${escapeHtml(emptyText)}</div>`;
}

function readAgentFile(agentInfo, relativePath) {
    const baseDir = path.resolve(agentInfo.folderPath || '');
    const filePath = path.resolve(baseDir, String(relativePath || ''));
    if (!baseDir || !isInside(baseDir, filePath)) {
        return { success: false, error: 'Requested path is outside the agent folder' };
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return { success: false, error: 'Requested file was not found' };
    }
    return {
        success: true,
        content: fs.readFileSync(filePath, 'utf-8')
    };
}

function renderPanel(agentInfo) {
    const folderPath = agentInfo?.folderPath;
    const allFiles = folderPath ? walkFiles(folderPath) : [];
    const artifacts = allFiles.filter(file =>
        file.type === 'file'
        && (/^(tasks|outputs)\//.test(file.relativePath) || /\.(html|md|json|csv|svg)$/i.test(file.relativePath))
    );
    const title = escapeHtml(agentInfo?.name || 'Agent');

    return `<section class="agent-files-shell" aria-label="${title} files">
        <div class="agent-files-tabs">
            <button type="button" class="agent-files-tab active" data-agent-ui-tab="artifacts">Artifacts</button>
            <button type="button" class="agent-files-tab" data-agent-ui-tab="files">Files for Conversation</button>
            <button type="button" class="agent-files-refresh" title="Refresh" data-agent-ui-action="refresh">Refresh</button>
        </div>
        <div class="agent-files-body">
            <div class="agent-files-list" data-agent-ui-section="artifacts">
                ${renderRows(artifacts, 'No artifacts yet.')}
            </div>
            <div class="agent-files-list" data-agent-ui-section="files" hidden>
                ${renderRows(allFiles, 'No files yet.')}
            </div>
            <pre class="agent-file-preview" data-agent-file-preview hidden></pre>
        </div>
    </section>`;
}

module.exports = {
    onEnable(context) {
        context.registerChatUI({
            title: 'Agent Files',
            renderPanel,
            actions: {
                refresh({ render }) {
                    return { success: true, html: render() };
                },
                'preview-file'({ agentInfo, payload }) {
                    const result = readAgentFile(agentInfo, payload.relativePath);
                    if (!result.success) {
                        return {
                            success: true,
                            text: { selector: '[data-agent-file-preview]', text: result.error }
                        };
                    }
                    return {
                        success: true,
                        text: { selector: '[data-agent-file-preview]', text: result.content }
                    };
                }
            },
            onTabActivated(agentInfo, payload, pluginContext) {
                pluginContext.log(`Files panel active for ${agentInfo.name}`);
            }
        });
        context.log('Agent file browser UI registered');
    },
    onDisable() {
        console.log('[agent-file-browser] Disabled');
    }
};
