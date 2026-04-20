const fs = require('fs');
const path = require('path');
const axios = require('axios');
const fetch = require('node-fetch');

const MAX_FILES_PER_INGEST = 300;
const MAX_BYTES_PER_FILE = 1024 * 1024 * 2;
const READABLE_EXTENSIONS = new Set([
    '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.html', '.htm',
    '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.js', '.ts', '.py', '.java',
    '.c', '.cpp', '.h', '.hpp', '.rb', '.go', '.rs', '.sql', '.rtf'
]);

const runtime = {
    dataDir: '',
    statePath: '',
    datasetsDir: '',
    config: {
        ollamaUrl: 'http://127.0.0.1:11434',
        embeddingModel: 'nomic-embed-text',
        chunkSize: 900,
        chunkOverlap: 120
    },
    state: null
};

function createDefaultState() {
    return {
        version: 1,
        active_mode_id: null,
        datasets: [],
        modes: [],
        updated_at: new Date().toISOString(),
        last_message: ''
    };
}

function normalizeState(raw) {
    const base = createDefaultState();
    const merged = { ...base, ...(raw || {}) };
    merged.datasets = Array.isArray(merged.datasets) ? merged.datasets : [];
    merged.modes = Array.isArray(merged.modes) ? merged.modes : [];
    return merged;
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'item';
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return fallback;
    }
}

function saveState(message = '') {
    runtime.state.updated_at = new Date().toISOString();
    if (message) runtime.state.last_message = message;
    fs.writeFileSync(runtime.statePath, JSON.stringify(runtime.state, null, 2), 'utf-8');
}

function datasetFilePath(datasetId) {
    return path.join(runtime.datasetsDir, `${datasetId}.json`);
}

function isTextLikeBuffer(buffer) {
    if (!buffer || buffer.length === 0) return true;
    const sample = buffer.slice(0, Math.min(buffer.length, 1024));
    for (const byte of sample) {
        if (byte === 0) return false;
    }
    return true;
}

function readTextFile(filePath) {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BYTES_PER_FILE) {
        return null;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (!READABLE_EXTENSIONS.has(ext) && ext !== '') {
        return null;
    }
    const buffer = fs.readFileSync(filePath);
    if (!isTextLikeBuffer(buffer)) {
        return null;
    }
    return buffer.toString('utf-8');
}

function walkReadableFiles(baseDir, files = []) {
    if (files.length >= MAX_FILES_PER_INGEST) return files;
    if (!fs.existsSync(baseDir)) return files;

    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
        if (files.length >= MAX_FILES_PER_INGEST) break;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(baseDir, entry.name);
        if (entry.isDirectory()) {
            walkReadableFiles(fullPath, files);
            continue;
        }
        files.push(fullPath);
    }
    return files;
}

function chunkText(text, maxChars, overlapChars) {
    const normalized = String(text || '').replace(/\r/g, '').trim();
    if (!normalized) return [];

    const safeMax = Math.max(300, Number(maxChars) || 900);
    const safeOverlap = Math.max(0, Math.min(safeMax - 50, Number(overlapChars) || 120));
    const chunks = [];
    let index = 0;

    while (index < normalized.length) {
        const end = Math.min(normalized.length, index + safeMax);
        const slice = normalized.slice(index, end).trim();
        if (slice.length > 0) {
            chunks.push(slice);
        }
        if (end >= normalized.length) break;
        index = Math.max(index + 1, end - safeOverlap);
    }

    return chunks;
}

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
        return -1;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return -1;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embedText(text) {
    const response = await axios.post(
        `${runtime.config.ollamaUrl}/api/embeddings`,
        {
            model: runtime.config.embeddingModel,
            prompt: text
        },
        { timeout: 45000 }
    );
    return response?.data?.embedding || [];
}

async function fetchUrlText(urlValue) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(urlValue, { signal: controller.signal });
        if (!response.ok) {
            return null;
        }
        return await response.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function collectSourceBlocks(payload = {}) {
    const blocks = [];
    const text = String(payload.text || '').trim();
    if (text) {
        blocks.push({ source: 'inline:text', text });
    }

    const filePaths = Array.isArray(payload.file_paths) ? payload.file_paths : [];
    for (const filePath of filePaths) {
        try {
            const content = readTextFile(String(filePath));
            if (content && content.trim()) {
                blocks.push({ source: `file:${filePath}`, text: content });
            }
        } catch {
            // Skip unreadable file.
        }
    }

    const directoryPaths = Array.isArray(payload.directory_paths) ? payload.directory_paths : [];
    for (const directoryPath of directoryPaths) {
        const files = walkReadableFiles(String(directoryPath), []);
        for (const filePath of files) {
            try {
                const content = readTextFile(filePath);
                if (content && content.trim()) {
                    blocks.push({ source: `file:${filePath}`, text: content });
                }
            } catch {
                // Skip unreadable file.
            }
        }
    }

    const urls = Array.isArray(payload.urls) ? payload.urls : [];
    for (const urlValue of urls) {
        const body = await fetchUrlText(String(urlValue));
        if (body && body.trim()) {
            blocks.push({ source: `url:${urlValue}`, text: body });
        }
    }

    return blocks;
}

function getMode(modeId) {
    return runtime.state.modes.find((mode) => String(mode.id) === String(modeId)) || null;
}

function resolveActiveMode(modeId = null) {
    if (modeId) {
        return getMode(modeId);
    }
    if (runtime.state.active_mode_id) {
        return getMode(runtime.state.active_mode_id);
    }
    return runtime.state.modes[0] || null;
}

function matchHardRule(rule, query) {
    const pattern = String(rule.pattern || '');
    const text = String(query || '');
    const mode = String(rule.match_type || 'contains').toLowerCase();
    if (!pattern || !text) return false;

    if (mode === 'exact') {
        return pattern.trim().toLowerCase() === text.trim().toLowerCase();
    }
    if (mode === 'regex') {
        try {
            return new RegExp(pattern, 'i').test(text);
        } catch {
            return false;
        }
    }
    return text.toLowerCase().includes(pattern.toLowerCase());
}

function trimSnippet(text, maxLen = 240) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    if (source.length <= maxLen) return source;
    return `${source.slice(0, maxLen - 1)}…`;
}

function summarizeMatches(query, mode, matches) {
    if (!matches.length) {
        return `No relevant indexed chunks found for "${query}". Add better source data or lower min_score.`;
    }
    const lines = [`Mode "${mode?.name || 'Default'}" retrieved ${matches.length} chunk(s):`];
    for (const match of matches.slice(0, 3)) {
        lines.push(`- [${match.dataset_id}] score=${match.score.toFixed(3)} ${trimSnippet(match.text, 200)}`);
    }
    return lines.join('\n');
}

async function ingestDataset(payload) {
    const sourceBlocks = await collectSourceBlocks(payload);
    if (sourceBlocks.length === 0) {
        throw new Error('No readable source data found for ingest');
    }

    const datasetId = String(payload.dataset_id || `ds-${Date.now()}-${slugify(payload.title || 'dataset')}`);
    const title = String(payload.title || datasetId);
    const chunkSize = Number(payload.chunk_size) || runtime.config.chunkSize;
    const chunkOverlap = Number(payload.chunk_overlap) || runtime.config.chunkOverlap;

    const chunks = [];
    for (const block of sourceBlocks) {
        const split = chunkText(block.text, chunkSize, chunkOverlap);
        for (const chunk of split) {
            chunks.push({
                id: `ch-${chunks.length + 1}`,
                source: block.source,
                text: chunk
            });
        }
    }

    if (chunks.length === 0) {
        throw new Error('Data was collected but no chunks were produced');
    }

    for (const chunk of chunks) {
        chunk.embedding = await embedText(chunk.text);
    }

    const now = new Date().toISOString();
    const datasetRecord = {
        id: datasetId,
        title,
        source_count: sourceBlocks.length,
        chunk_count: chunks.length,
        created_at: now,
        updated_at: now,
        embedding_model: runtime.config.embeddingModel
    };

    fs.writeFileSync(
        datasetFilePath(datasetId),
        JSON.stringify({
            ...datasetRecord,
            chunks
        }, null, 2),
        'utf-8'
    );

    const existingIndex = runtime.state.datasets.findIndex((dataset) => dataset.id === datasetId);
    if (existingIndex >= 0) {
        runtime.state.datasets[existingIndex] = datasetRecord;
    } else {
        runtime.state.datasets.push(datasetRecord);
    }
    saveState(`Dataset "${title}" ingested with ${chunks.length} chunks.`);

    return {
        success: true,
        action: 'ingest',
        dataset: datasetRecord
    };
}

function listDatasets() {
    return runtime.state.datasets.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function inspectDataset(datasetId) {
    const metadata = runtime.state.datasets.find((dataset) => dataset.id === datasetId);
    if (!metadata) {
        throw new Error(`Dataset "${datasetId}" not found`);
    }
    const full = safeReadJson(datasetFilePath(datasetId), null);
    if (!full) {
        throw new Error(`Dataset file for "${datasetId}" is missing`);
    }
    return {
        ...metadata,
        sample_chunks: (full.chunks || []).slice(0, 5).map((chunk) => ({
            id: chunk.id,
            source: chunk.source,
            text: trimSnippet(chunk.text, 220)
        }))
    };
}

function deleteDataset(datasetId) {
    const beforeCount = runtime.state.datasets.length;
    runtime.state.datasets = runtime.state.datasets.filter((dataset) => dataset.id !== datasetId);
    if (beforeCount === runtime.state.datasets.length) {
        throw new Error(`Dataset "${datasetId}" not found`);
    }

    const filePath = datasetFilePath(datasetId);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    for (const mode of runtime.state.modes) {
        if (Array.isArray(mode.dataset_ids)) {
            mode.dataset_ids = mode.dataset_ids.filter((id) => id !== datasetId);
        }
    }
    saveState(`Dataset "${datasetId}" deleted.`);

    return { success: true, action: 'delete', dataset_id: datasetId };
}

function modeList() {
    return runtime.state.modes.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function createMode(payload) {
    const name = String(payload.name || '').trim();
    if (!name) {
        throw new Error('Mode name is required');
    }
    const modeId = String(payload.mode_id || `mode-${Date.now()}-${slugify(name)}`);
    const now = new Date().toISOString();
    const mode = {
        id: modeId,
        name,
        guidance: String(payload.guidance || '').trim(),
        top_k: Math.max(1, Number(payload.top_k) || 4),
        min_score: Number.isFinite(Number(payload.min_score)) ? Number(payload.min_score) : 0.12,
        dataset_ids: Array.isArray(payload.dataset_ids) ? payload.dataset_ids.map(String) : [],
        hard_rules: [],
        created_at: now,
        updated_at: now
    };
    runtime.state.modes = runtime.state.modes.filter((item) => item.id !== modeId);
    runtime.state.modes.push(mode);
    if (!runtime.state.active_mode_id) {
        runtime.state.active_mode_id = modeId;
    }
    saveState(`Mode "${name}" created.`);
    return mode;
}

function updateMode(payload) {
    const mode = getMode(payload.mode_id);
    if (!mode) {
        throw new Error(`Mode "${payload.mode_id}" not found`);
    }

    if (payload.name !== undefined) mode.name = String(payload.name || mode.name);
    if (payload.guidance !== undefined) mode.guidance = String(payload.guidance || '');
    if (payload.top_k !== undefined) mode.top_k = Math.max(1, Number(payload.top_k) || mode.top_k || 4);
    if (payload.min_score !== undefined) mode.min_score = Number(payload.min_score);
    if (payload.dataset_ids !== undefined && Array.isArray(payload.dataset_ids)) {
        mode.dataset_ids = payload.dataset_ids.map(String);
    }
    mode.updated_at = new Date().toISOString();
    saveState(`Mode "${mode.name}" updated.`);
    return mode;
}

function activateMode(modeId) {
    const mode = getMode(modeId);
    if (!mode) {
        throw new Error(`Mode "${modeId}" not found`);
    }
    runtime.state.active_mode_id = mode.id;
    saveState(`Mode "${mode.name}" activated.`);
    return mode;
}

function deleteMode(modeId) {
    const mode = getMode(modeId);
    if (!mode) {
        throw new Error(`Mode "${modeId}" not found`);
    }
    runtime.state.modes = runtime.state.modes.filter((item) => item.id !== modeId);
    if (runtime.state.active_mode_id === modeId) {
        runtime.state.active_mode_id = runtime.state.modes[0]?.id || null;
    }
    saveState(`Mode "${mode.name}" deleted.`);
    return { success: true, mode_id: modeId };
}

function addModeRule(payload) {
    const mode = getMode(payload.mode_id);
    if (!mode) {
        throw new Error(`Mode "${payload.mode_id}" not found`);
    }
    const pattern = String(payload.pattern || '').trim();
    const answer = String(payload.answer || '').trim();
    if (!pattern || !answer) {
        throw new Error('pattern and answer are required for add_rule');
    }
    const rule = {
        id: `rule-${Date.now()}-${slugify(pattern).slice(0, 20)}`,
        pattern,
        answer,
        match_type: ['contains', 'exact', 'regex'].includes(payload.match_type) ? payload.match_type : 'contains',
        created_at: new Date().toISOString()
    };
    mode.hard_rules = Array.isArray(mode.hard_rules) ? mode.hard_rules : [];
    mode.hard_rules.push(rule);
    mode.updated_at = new Date().toISOString();
    saveState(`Rule added to mode "${mode.name}".`);
    return rule;
}

function removeModeRule(payload) {
    const mode = getMode(payload.mode_id);
    if (!mode) {
        throw new Error(`Mode "${payload.mode_id}" not found`);
    }
    const before = (mode.hard_rules || []).length;
    mode.hard_rules = (mode.hard_rules || []).filter((rule) => rule.id !== payload.rule_id);
    if (before === mode.hard_rules.length) {
        throw new Error(`Rule "${payload.rule_id}" not found`);
    }
    mode.updated_at = new Date().toISOString();
    saveState(`Rule removed from mode "${mode.name}".`);
    return { success: true, rule_id: payload.rule_id };
}

async function runQuery(payload) {
    const query = String(payload.query || '').trim();
    if (!query) {
        throw new Error('query is required');
    }

    const mode = resolveActiveMode(payload.mode_id);
    if (!mode) {
        return {
            success: false,
            answer: 'No RAG mode is configured. Create a mode first.',
            matches: []
        };
    }

    const hardRules = Array.isArray(mode.hard_rules) ? mode.hard_rules : [];
    for (const rule of hardRules) {
        if (matchHardRule(rule, query)) {
            return {
                success: true,
                source: 'hard_rule',
                mode: {
                    id: mode.id,
                    name: mode.name
                },
                rule,
                answer: rule.answer,
                matches: []
            };
        }
    }

    const queryEmbedding = await embedText(query);
    const selectedDatasetIds = Array.isArray(mode.dataset_ids) && mode.dataset_ids.length > 0
        ? mode.dataset_ids
        : runtime.state.datasets.map((dataset) => dataset.id);
    const scored = [];

    for (const datasetId of selectedDatasetIds) {
        const dataset = safeReadJson(datasetFilePath(datasetId), null);
        if (!dataset || !Array.isArray(dataset.chunks)) continue;
        for (const chunk of dataset.chunks) {
            if (!Array.isArray(chunk.embedding)) continue;
            const score = cosineSimilarity(queryEmbedding, chunk.embedding);
            scored.push({
                dataset_id: datasetId,
                dataset_title: dataset.title || datasetId,
                chunk_id: chunk.id,
                source: chunk.source,
                text: chunk.text,
                score
            });
        }
    }

    const minScore = Number.isFinite(Number(mode.min_score)) ? Number(mode.min_score) : 0.12;
    const topK = Math.max(1, Number(payload.top_k) || Number(mode.top_k) || 4);
    const matches = scored
        .filter((item) => item.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((item) => ({
            ...item,
            text: trimSnippet(item.text, 360)
        }));

    const answer = summarizeMatches(query, mode, matches);
    runtime.state.last_message = answer;
    saveState();

    return {
        success: true,
        source: 'vector_search',
        mode: {
            id: mode.id,
            name: mode.name,
            guidance: mode.guidance
        },
        answer,
        matches,
        used_dataset_ids: selectedDatasetIds
    };
}

function summary() {
    const activeMode = resolveActiveMode();
    return {
        datasetCount: runtime.state.datasets.length,
        modeCount: runtime.state.modes.length,
        activeModeId: runtime.state.active_mode_id || null,
        activeModeName: activeMode ? activeMode.name : null,
        datasets: listDatasets().slice(0, 12),
        modes: modeList().slice(0, 12),
        lastMessage: runtime.state.last_message || ''
    };
}

async function handleDatasetOp(payload) {
    const action = String(payload.action || '').toLowerCase();
    if (action === 'ingest') return ingestDataset(payload);
    if (action === 'list') return { success: true, action: 'list', datasets: listDatasets() };
    if (action === 'inspect') return { success: true, action: 'inspect', dataset: inspectDataset(String(payload.dataset_id || '')) };
    if (action === 'delete') return deleteDataset(String(payload.dataset_id || ''));
    throw new Error(`Unsupported dataset action "${action}"`);
}

async function handleModeOp(payload) {
    const action = String(payload.action || '').toLowerCase();
    if (action === 'list') return { success: true, action: 'list', modes: modeList(), active_mode_id: runtime.state.active_mode_id };
    if (action === 'create') return { success: true, action: 'create', mode: createMode(payload) };
    if (action === 'update') return { success: true, action: 'update', mode: updateMode(payload) };
    if (action === 'activate') return { success: true, action: 'activate', mode: activateMode(String(payload.mode_id || '')) };
    if (action === 'delete') return deleteMode(String(payload.mode_id || ''));
    if (action === 'add_rule') return { success: true, action: 'add_rule', rule: addModeRule(payload) };
    if (action === 'remove_rule') return { success: true, action: 'remove_rule', result: removeModeRule(payload) };
    throw new Error(`Unsupported mode action "${action}"`);
}

async function initialize(payload) {
    runtime.dataDir = path.resolve(String(payload.dataDir || path.join(__dirname, 'data')));
    runtime.datasetsDir = path.join(runtime.dataDir, 'datasets');
    runtime.statePath = path.join(runtime.dataDir, 'state.json');

    ensureDir(runtime.dataDir);
    ensureDir(runtime.datasetsDir);

    const cfg = payload.config || {};
    runtime.config = {
        ollamaUrl: String(cfg.ollamaUrl || runtime.config.ollamaUrl),
        embeddingModel: String(cfg.embeddingModel || runtime.config.embeddingModel),
        chunkSize: Math.max(300, Number(cfg.chunkSize) || runtime.config.chunkSize),
        chunkOverlap: Math.max(0, Number(cfg.chunkOverlap) || runtime.config.chunkOverlap)
    };

    runtime.state = normalizeState(safeReadJson(runtime.statePath, createDefaultState()));
    saveState('RAG runtime initialized.');

    return {
        success: true,
        config: runtime.config,
        summary: summary()
    };
}

async function route(action, payload) {
    if (action === 'init') return initialize(payload);
    if (!runtime.state) {
        throw new Error('RAG runtime is not initialized');
    }
    if (action === 'status') {
        return {
            success: true,
            config: runtime.config,
            summary: summary()
        };
    }
    if (action === 'summary') return summary();
    if (action === 'dataset_op') return handleDatasetOp(payload || {});
    if (action === 'mode_op') return handleModeOp(payload || {});
    if (action === 'query') return runQuery(payload || {});
    if (action === 'shutdown') {
        saveState('RAG runtime shutdown.');
        return { success: true };
    }
    throw new Error(`Unknown runtime action "${action}"`);
}

process.on('message', async (message) => {
    if (!message || typeof message !== 'object' || !message.id) {
        return;
    }
    const { id, action, payload } = message;
    try {
        const result = await route(action, payload || {});
        process.send?.({ id, ok: true, result });
    } catch (error) {
        process.send?.({ id, ok: false, error: error.message || String(error) });
    }
});
