/**
 * WorkflowEditor - Visual Node-based Workflow Editor
 * 
 * Provides a canvas-based interface for creating and editing workflows
 * using draggable, connectable tool nodes.
 */

class WorkflowEditor {
    constructor() {
        this.nodes = new Map();
        this.connections = [];
        this.selectedNode = null;
        this.draggingNode = null;
        this.connectingFrom = null;
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.nodeIdCounter = 0;
        this.toolGroups = [];
        this.tools = [];

        this.canvas = null;
        this.connectionsLayer = null;
        this.nodePalette = null;

        this.init();
    }

    async init() {
        this.canvas = document.getElementById('workflow-canvas');
        this.connectionsLayer = document.getElementById('workflow-connections');
        this.nodePalette = document.getElementById('node-palette');

        if (!this.canvas) return;

        await this.loadTools();
        this.setupEventListeners();
        this.renderNodePalette();
        await this.loadSavedWorkflows();

        // Listen for workflow updates from backend (copy, create, delete via IPC or LLM)
        window.electronAPI?.on?.('workflow-update', () => {
            this.loadSavedWorkflows();
        });
    }

    async loadTools() {
        try {
            this.tools = await window.electronAPI.getMCPTools?.() || [];
            this.toolGroups = await window.electronAPI.getToolGroups?.() || [];
        } catch (error) {
            console.error('Failed to load tools:', error);
        }
    }

    setupEventListeners() {
        // Add Node button toggle
        document.getElementById('add-node-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.nodePalette?.classList.toggle('visible');
        });

        // Close palette on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.add-node-dropdown')) {
                this.nodePalette?.classList.remove('visible');
            }
        });

        // New workflow
        document.getElementById('new-workflow-btn')?.addEventListener('click', () => this.newWorkflow());

        // Save workflow
        document.getElementById('save-workflow-btn')?.addEventListener('click', () => this.saveWorkflow());

        // Run workflow
        document.getElementById('run-workflow-btn')?.addEventListener('click', () => this.runWorkflow());

        // Zoom controls
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.setZoom(this.zoom + 0.1));
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.setZoom(this.zoom - 0.1));

        // Saved workflows panel controls
        document.getElementById('collapse-workflows-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('saved-workflows-panel');
            const btn = document.getElementById('collapse-workflows-btn');
            panel?.classList.toggle('collapsed');
            if (btn) btn.textContent = panel?.classList.contains('collapsed') ? '▼' : '▲';
        });
        document.getElementById('compact-workflows-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('saved-workflows-panel');
            const btn = document.getElementById('compact-workflows-btn');
            panel?.classList.toggle('compact');
            if (btn) btn.textContent = panel?.classList.contains('compact') ? '▦' : '▤';
        });

        // Canvas events for dragging and connecting
        this.canvas?.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        this.canvas?.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        this.canvas?.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        this.canvas?.addEventListener('mouseleave', (e) => this.onCanvasMouseUp(e));
    }

    renderNodePalette() {
        if (!this.nodePalette) return;

        // Group tools by their tool group
        const groupedTools = new Map();
        const toolToGroup = new Map();

        this.toolGroups.forEach(group => {
            groupedTools.set(group.id, { ...group, tools: [] });
            group.tools.forEach(toolName => toolToGroup.set(toolName, group.id));
        });

        this.tools.forEach(tool => {
            const groupId = toolToGroup.get(tool.name);
            if (groupId && groupedTools.has(groupId)) {
                groupedTools.get(groupId).tools.push(tool);
            }
        });

        let html = '';
        for (const [groupId, group] of groupedTools) {
            if (group.tools.length === 0) continue;
            html += `
                <div class="palette-group">
                    <div class="palette-group-header">${group.icon} ${group.name}</div>
                    <div class="palette-group-items">
                        ${group.tools.map(tool => `
                            <div class="palette-item" data-tool="${tool.name}" title="${tool.description}">
                                ${tool.name}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        this.nodePalette.innerHTML = html;

        // Add click handlers to palette items
        this.nodePalette.querySelectorAll('.palette-item').forEach(item => {
            item.addEventListener('click', () => {
                const toolName = item.dataset.tool;
                this.addNode(toolName);
                this.nodePalette.classList.remove('visible');
            });
        });
    }

    addNode(toolName, x = null, y = null, presetParams = null) {
        const tool = this.tools.find(t => t.name === toolName);

        const id = `node-${++this.nodeIdCounter}`;
        const nodeX = x ?? 100 + (this.nodes.size * 220);
        const nodeY = y ?? 150;

        // Build schema from tool definition OR from preset params
        let inputSchema = tool?.inputSchema || null;
        if (!inputSchema && presetParams && Object.keys(presetParams).length > 0) {
            inputSchema = {
                type: 'object',
                properties: Object.fromEntries(
                    Object.keys(presetParams).map(k => [k, { type: 'string', description: k }])
                )
            };
        }

        const node = {
            id,
            tool: toolName,
            x: nodeX,
            y: nodeY,
            params: presetParams ? { ...presetParams } : {},
            inputSchema,
            description: tool?.description || toolName
        };

        this.nodes.set(id, node);
        this.renderNode(node);
        return node;
    }

    renderNode(node) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'workflow-node';
        nodeEl.id = node.id;
        nodeEl.style.left = `${node.x}px`;
        nodeEl.style.top = `${node.y}px`;

        const params = node.inputSchema?.properties || {};
        const paramKeys = Object.keys(params).slice(0, 3); // Show first 3 params

        nodeEl.innerHTML = `
            <div class="node-header" data-node="${node.id}">
                <span class="node-title">${node.tool}</span>
                <button class="node-delete-btn" data-node="${node.id}" title="Delete">×</button>
            </div>
            <div class="node-body">
                ${paramKeys.map(key => `
                    <div class="node-param">
                        <label>${key}</label>
                        <input type="text" class="node-param-input" 
                               data-node="${node.id}" 
                               data-param="${key}"
                               placeholder="${params[key].description || key}"
                               value="${node.params[key] || ''}">
                    </div>
                `).join('')}
                ${Object.keys(params).length > 3 ? `<div class="node-param-more">+${Object.keys(params).length - 3} more</div>` : ''}
            </div>
            <div class="node-connectors">
                <div class="node-connector input" data-node="${node.id}" data-type="input" title="Input"></div>
                <div class="node-connector output" data-node="${node.id}" data-type="output" title="Output"></div>
            </div>
        `;

        // Event: Delete node
        nodeEl.querySelector('.node-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteNode(node.id);
        });

        // Event: Drag node
        nodeEl.querySelector('.node-header').addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.startDragging(node.id, e);
        });

        // Event: Param change
        nodeEl.querySelectorAll('.node-param-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const nodeId = e.target.dataset.node;
                const paramName = e.target.dataset.param;
                const n = this.nodes.get(nodeId);
                if (n) {
                    n.params[paramName] = e.target.value;
                }
            });
        });

        // Event: Start connecting
        nodeEl.querySelectorAll('.node-connector').forEach(connector => {
            connector.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                const nodeId = e.target.dataset.node;
                const type = e.target.dataset.type;
                if (type === 'output') {
                    this.startConnecting(nodeId, e);
                }
            });
            connector.addEventListener('mouseup', (e) => {
                e.stopPropagation();
                const nodeId = e.target.dataset.node;
                const type = e.target.dataset.type;
                if (type === 'input' && this.connectingFrom) {
                    this.finishConnecting(nodeId);
                }
            });
        });

        this.canvas.appendChild(nodeEl);
    }

    deleteNode(nodeId) {
        const nodeEl = document.getElementById(nodeId);
        if (nodeEl) nodeEl.remove();
        this.nodes.delete(nodeId);
        this.connections = this.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
        this.renderConnections();
    }

    startDragging(nodeId, e) {
        this.draggingNode = {
            id: nodeId,
            startX: e.clientX,
            startY: e.clientY,
            nodeStartX: this.nodes.get(nodeId)?.x || 0,
            nodeStartY: this.nodes.get(nodeId)?.y || 0
        };
    }

    startConnecting(nodeId, e) {
        this.connectingFrom = nodeId;
        // Could show a preview line here
    }

    finishConnecting(toNodeId) {
        if (this.connectingFrom && this.connectingFrom !== toNodeId) {
            // Check for duplicate
            const exists = this.connections.some(c =>
                c.from === this.connectingFrom && c.to === toNodeId
            );
            if (!exists) {
                this.connections.push({ from: this.connectingFrom, to: toNodeId });
                this.renderConnections();
            }
        }
        this.connectingFrom = null;
    }

    onCanvasMouseDown(e) {
        // Deselect on canvas click
        if (e.target === this.canvas) {
            this.selectedNode = null;
        }
    }

    onCanvasMouseMove(e) {
        if (this.draggingNode) {
            const dx = e.clientX - this.draggingNode.startX;
            const dy = e.clientY - this.draggingNode.startY;
            const node = this.nodes.get(this.draggingNode.id);
            if (node) {
                node.x = this.draggingNode.nodeStartX + dx;
                node.y = this.draggingNode.nodeStartY + dy;
                const nodeEl = document.getElementById(this.draggingNode.id);
                if (nodeEl) {
                    nodeEl.style.left = `${node.x}px`;
                    nodeEl.style.top = `${node.y}px`;
                }
                this.renderConnections();
            }
        }
    }

    onCanvasMouseUp(e) {
        this.draggingNode = null;
        this.connectingFrom = null;
    }

    renderConnections() {
        if (!this.connectionsLayer) return;

        let svg = '';
        this.connections.forEach(conn => {
            const fromNode = this.nodes.get(conn.from);
            const toNode = this.nodes.get(conn.to);
            if (!fromNode || !toNode) return;

            const fromX = fromNode.x + 200; // Right side of node
            const fromY = fromNode.y + 40;  // Middle height
            const toX = toNode.x;            // Left side of node
            const toY = toNode.y + 40;

            // Bezier curve
            const cx1 = fromX + 50;
            const cy1 = fromY;
            const cx2 = toX - 50;
            const cy2 = toY;

            svg += `<path d="M ${fromX} ${fromY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${toX} ${toY}" 
                          class="connection-line" stroke="#4ade80" stroke-width="2" fill="none"/>`;
        });

        this.connectionsLayer.innerHTML = svg;
    }

    setZoom(level) {
        this.zoom = Math.max(0.5, Math.min(2, level));
        document.getElementById('zoom-level').textContent = `${Math.round(this.zoom * 100)}%`;
        this.canvas.style.transform = `scale(${this.zoom})`;
    }

    newWorkflow() {
        document.getElementById('workflow-name-input').value = '';
        this.nodes.clear();
        this.connections = [];
        this.canvas.innerHTML = '';
        this.connectionsLayer.innerHTML = '';
        this.nodeIdCounter = 0;
    }

    async saveWorkflow() {
        const name = document.getElementById('workflow-name-input')?.value.trim();
        if (!name) {
            window.mainPanel?.showNotification('Please enter a workflow name', 'error');
            return;
        }

        if (this.nodes.size === 0) {
            window.mainPanel?.showNotification('Add at least one node', 'error');
            return;
        }

        // Convert nodes to tool chain format
        const toolChain = this.getExecutionOrder().map(nodeId => {
            const node = this.nodes.get(nodeId);
            return { tool: node.tool, params: node.params };
        });

        const workflow = {
            name,
            description: `Visual workflow: ${Array.from(this.nodes.values()).map(n => n.tool).join(' → ')}`,
            tool_chain: toolChain,
            visual_data: {
                nodes: Array.from(this.nodes.values()),
                connections: this.connections
            }
        };

        try {
            await window.electronAPI.saveWorkflow(workflow);
            window.mainPanel?.showNotification('Workflow saved!');
            await this.loadSavedWorkflows();
        } catch (error) {
            console.error('Failed to save workflow:', error);
            window.mainPanel?.showNotification('Failed to save workflow', 'error');
        }
    }

    getExecutionOrder() {
        // Topological sort based on connections
        const inDegree = new Map();
        const adjacency = new Map();

        for (const [id] of this.nodes) {
            inDegree.set(id, 0);
            adjacency.set(id, []);
        }

        this.connections.forEach(conn => {
            adjacency.get(conn.from)?.push(conn.to);
            inDegree.set(conn.to, (inDegree.get(conn.to) || 0) + 1);
        });

        const queue = [];
        for (const [id, degree] of inDegree) {
            if (degree === 0) queue.push(id);
        }

        const order = [];
        while (queue.length > 0) {
            const current = queue.shift();
            order.push(current);
            for (const neighbor of adjacency.get(current) || []) {
                inDegree.set(neighbor, inDegree.get(neighbor) - 1);
                if (inDegree.get(neighbor) === 0) {
                    queue.push(neighbor);
                }
            }
        }

        return order;
    }

    async runWorkflow() {
        const toolChain = this.getExecutionOrder().map(nodeId => {
            const node = this.nodes.get(nodeId);
            return { tool: node.tool, params: node.params, nodeId: nodeId };
        });

        if (toolChain.length === 0) {
            window.mainPanel?.showNotification('No nodes to execute', 'error');
            return;
        }

        // Switch to chat tab and post workflow start
        window.sidebar?.switchTab?.('chat');
        const workflowName = document.getElementById('workflow-name-input')?.value || 'Unnamed Workflow';
        window.mainPanel?.addMessage('system', `▶️ **Running workflow: ${workflowName}** (${toolChain.length} tools)`);

        let allSuccess = true;

        for (const step of toolChain) {
            try {
                // Highlight executing node on canvas
                const nodeEl = document.getElementById(step.nodeId);
                if (nodeEl) nodeEl.classList.add('executing');

                const result = await window.electronAPI.executeMCPTool(step.tool, step.params);

                if (nodeEl) {
                    nodeEl.classList.remove('executing');
                    nodeEl.classList.add('executed');
                    setTimeout(() => nodeEl.classList.remove('executed'), 3000);
                }

                // Post result to chat
                const preview = typeof result === 'object' ? JSON.stringify(result, null, 2).slice(0, 500) : String(result).slice(0, 500);
                window.mainPanel?.addMessage('system', `✅ **${step.tool}**\n\`\`\`\n${preview}\n\`\`\``);
            } catch (error) {
                allSuccess = false;
                const nodeEl = document.getElementById(step.nodeId);
                if (nodeEl) {
                    nodeEl.classList.remove('executing');
                    nodeEl.classList.add('error');
                }
                window.mainPanel?.addMessage('system', `❌ **${step.tool}** failed: ${error.message}`);
                break;
            }
        }

        window.mainPanel?.addMessage('system', allSuccess
            ? `🎉 **Workflow "${workflowName}" completed successfully!**`
            : `⚠️ **Workflow "${workflowName}" stopped due to error**`);
    }

    async loadSavedWorkflows() {
        try {
            const workflows = await window.electronAPI.getWorkflows?.() || [];

            // 1) Workflow Tab panel — all workflows, full controls
            const tabListEl = document.getElementById('workflows-list');
            if (tabListEl) {
                if (workflows.length === 0) {
                    tabListEl.innerHTML = '<div class="no-workflows">No saved workflows yet.<br><small>Create one using the canvas above, or ask the AI to create one.</small></div>';
                } else {
                    this._renderWorkflowList(tabListEl, workflows, true);
                }
            }

            // 2) Right sidebar widget — only recently-used workflows (compact)
            const sidebarListEl = document.getElementById('saved-workflows-list');
            if (sidebarListEl) {
                const recentWorkflows = workflows
                    .filter(w => w.last_used || (w.success_count || 0) + (w.failure_count || 0) > 0)
                    .slice(0, 5);

                if (recentWorkflows.length === 0) {
                    sidebarListEl.innerHTML = '<div class="no-workflows" style="font-size:0.75rem;padding:0.5rem;">No active workflows</div>';
                } else {
                    this._renderWorkflowList(sidebarListEl, recentWorkflows, false);
                }
            }
        } catch (error) {
            console.error('Failed to load workflows:', error);
        }
    }

    /**
     * Render workflow items into a container
     * @param {HTMLElement} container - target element
     * @param {Array} workflows - workflow objects
     * @param {boolean} fullControls - show all buttons (tab panel) vs compact (sidebar)
     */
    _renderWorkflowList(container, workflows, fullControls) {
        container.innerHTML = workflows.map(w => {
            let tools = [];
            try { tools = typeof w.tool_chain === 'string' ? JSON.parse(w.tool_chain) : (w.tool_chain || []); } catch(e) {}
            const toolNames = tools.map(s => s.tool).join(' → ');
            const stats = (w.success_count || 0) + (w.failure_count || 0);
            const successRate = stats > 0 ? Math.round(((w.success_count || 0) / stats) * 100) : null;

            const actionBtns = fullControls
                ? `<button class="load-workflow-btn icon-btn" data-id="${w.id}" title="Load into editor">📂</button>
                   <button class="copy-workflow-btn icon-btn" data-id="${w.id}" title="Copy workflow">📋</button>
                   <button class="run-saved-workflow-btn icon-btn" data-id="${w.id}" title="Run workflow">▶️</button>
                   <button class="delete-workflow-btn icon-btn" data-id="${w.id}" title="Delete">🗑️</button>`
                : `<button class="run-saved-workflow-btn icon-btn" data-id="${w.id}" title="Run workflow">▶️</button>`;

            return `
            <div class="saved-workflow-item" data-id="${w.id}" title="${w.description || ''}">
                <div class="workflow-item-info">
                    <span class="workflow-item-name">🔄 ${w.name}</span>
                    <span class="workflow-item-tools">${toolNames || 'No tools'}</span>
                    ${stats > 0 ? `<span class="workflow-item-stats">${stats} runs${successRate !== null ? ` • ${successRate}% success` : ''}</span>` : ''}
                </div>
                <div class="workflow-item-actions">
                    ${actionBtns}
                </div>
            </div>
        `}).join('');

        // Wire event handlers
        if (fullControls) {
            container.querySelectorAll('.load-workflow-btn').forEach(btn => {
                btn.addEventListener('click', () => this.loadWorkflow(btn.dataset.id));
            });
            container.querySelectorAll('.copy-workflow-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await window.electronAPI.copyWorkflow(parseInt(btn.dataset.id));
                        window.mainPanel?.showNotification('Workflow copied!');
                        await this.loadSavedWorkflows();
                    } catch (error) {
                        console.error('Failed to copy workflow:', error);
                        window.mainPanel?.showNotification('Failed to copy workflow', 'error');
                    }
                });
            });
            container.querySelectorAll('.delete-workflow-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm('Delete this workflow?')) {
                        await window.electronAPI.deleteWorkflow(parseInt(btn.dataset.id));
                        await this.loadSavedWorkflows();
                    }
                });
            });
        }

        // Run button — available in both views
        container.querySelectorAll('.run-saved-workflow-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    btn.textContent = '⏳';
                    const wfId = parseInt(btn.dataset.id);

                    // Switch to chat and post start
                    window.sidebar?.switchTab?.('chat');
                    const wfItem = btn.closest('.saved-workflow-item');
                    const wfName = wfItem?.querySelector('.workflow-item-name')?.textContent?.replace('🔄 ', '') || `Workflow #${wfId}`;
                    window.mainPanel?.addMessage('system', `▶️ **Running workflow: ${wfName}**`);

                    const result = await window.electronAPI.runWorkflow(wfId);
                    btn.textContent = '▶️';

                    // Post each tool result to chat
                    if (result.results) {
                        for (const r of result.results) {
                            if (r.success) {
                                const preview = typeof r.result === 'object' ? JSON.stringify(r.result, null, 2).slice(0, 500) : String(r.result || '').slice(0, 500);
                                window.mainPanel?.addMessage('system', `✅ **${r.tool}**\n\`\`\`\n${preview}\n\`\`\``);
                            } else {
                                window.mainPanel?.addMessage('system', `❌ **${r.tool}** failed: ${r.error}`);
                            }
                        }
                    }

                    window.mainPanel?.addMessage('system', result.success
                        ? `🎉 **Workflow "${wfName}" completed!**`
                        : `⚠️ **Workflow "${wfName}" failed**`);

                    await this.loadSavedWorkflows();
                } catch (error) {
                    btn.textContent = '▶️';
                    console.error('Failed to run workflow:', error);
                    window.mainPanel?.addMessage('system', `❌ Workflow execution error: ${error.message}`);
                }
            });
        });
    }

    async loadWorkflow(workflowId) {
        try {
            const workflows = await window.electronAPI.getWorkflows?.() || [];
            const workflow = workflows.find(w => w.id == workflowId);
            if (!workflow) return;

            this.newWorkflow();
            document.getElementById('workflow-name-input').value = workflow.name;

            // Try to load visual data first
            if (workflow.visual_data) {
                const visualData = typeof workflow.visual_data === 'string'
                    ? JSON.parse(workflow.visual_data)
                    : workflow.visual_data;

                visualData.nodes?.forEach(node => {
                    const newNode = this.addNode(node.tool, node.x, node.y);
                    if (newNode && node.params) {
                        newNode.params = node.params;
                    }
                });

                this.connections = visualData.connections || [];
                this.renderConnections();
            } else {
                // Fall back to tool_chain format
                const toolChain = typeof workflow.tool_chain === 'string'
                    ? JSON.parse(workflow.tool_chain)
                    : workflow.tool_chain;

                toolChain.forEach((step, idx) => {
                    const node = this.addNode(step.tool, 100 + idx * 220, 150, step.params || {});
                });

                // Auto-connect in sequence
                const nodeIds = Array.from(this.nodes.keys());
                for (let i = 0; i < nodeIds.length - 1; i++) {
                    this.connections.push({ from: nodeIds[i], to: nodeIds[i + 1] });
                }
                this.renderConnections();
            }

            window.mainPanel?.showNotification('Workflow loaded');
        } catch (error) {
            console.error('Failed to load workflow:', error);
        }
    }
}

// Export for use
window.WorkflowEditor = WorkflowEditor;
