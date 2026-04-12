class Sidebar {
    constructor() {
        this.currentTab = 'chat';
        this.toolActivity = [];
        this.unseenToolCount = 0;  // Track unseen tool activities
        this.currentSessionId = null;
        this.selectedDate = null;
        this.initializeEvents();
        this.setupToolListeners();
        this.loadChatSessions();
        this.setupCollapsibleSections();  // Added collapsible functionality
        this.setupCapabilityListener();   // Keep MCP tab in sync with capability changes
    }

    resetUnseenToolCount() {
        this.unseenToolCount = 0;
        this.updateToolIndicators();
    }

    setupCollapsibleSections() {
        document.querySelectorAll('.collapsible-section').forEach(section => {
            const header = section.querySelector('.section-header');
            const content = section.querySelector('.section-content');
            const toggleIcon = header.querySelector('.toggle-icon');

            header.addEventListener('click', () => {
                section.classList.toggle('collapsed');
                toggleIcon.textContent = section.classList.contains('collapsed') ? '◀' : '▶';

                // Save state to localStorage
                const sectionId = section.getAttribute('data-section');
                localStorage.setItem(`section-${sectionId}-collapsed`, section.classList.contains('collapsed'));
            });

            // Restore saved state
            const sectionId = section.getAttribute('data-section');
            const isCollapsed = localStorage.getItem(`section-${sectionId}-collapsed`) === 'true';
            if (isCollapsed) {
                section.classList.add('collapsed');
                toggleIcon.textContent = '◀';
            }
        });
    }

    initializeEvents() {
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                this.switchTab(tab);
            });
        });
    }

    switchTab(tabName) {
        // Update active button
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(button => {
            button.classList.remove('active');
            if (button.dataset.tab === tabName) {
                button.classList.add('active');
            }
        });

        // Reset unseen tool count when switching to tools tab
        if (tabName === 'tools') {
            this.resetUnseenToolCount();
        }

        // Update tab content
        const tabContents = document.querySelectorAll('.tab-content');
        tabContents.forEach(content => {
            content.classList.remove('active');
            if (content.id === `${tabName}-tab`) {
                content.classList.add('active');
            }
        });

        this.currentTab = tabName;

        // Load tab-specific data if needed
        this.loadTabData(tabName);

        // Dispatch custom event for tab activation
        const event = new CustomEvent('tab-activated', { detail: { tab: tabName } });
        document.dispatchEvent(event);
    }

    async loadTabData(tabName) {
        switch (tabName) {
            case 'mcp':
                await this.loadMCPTools();
                break;
            case 'llm':
                await this.loadSystemPrompt();
                break;
            case 'api':
                await this.loadAPIKeys();
                break;
            case 'tools':
                this.updateToolActivityTab();
                break;
            case 'workflows':
                if (!this.workflowEditor) {
                    this.workflowEditor = new window.WorkflowEditor();
                }
                break;
        }
    }

    async loadMCPTools() {
        try {
            const tools = await window.electronAPI.getMCPTools();
            const customTools = await window.electronAPI.getCustomTools?.() || [];
            // Use capability groups as the single source of truth for group info
            const capabilityGroups = await window.electronAPI.capability?.getGroups?.() || [];
            const container = document.getElementById('mcp-tools-container');
            const toolSelect = document.getElementById('tool-select');
            const activityContainer = document.getElementById('tool-activity');

            if (!container) return;

            container.innerHTML = '';

            // Get DB tool activation states
            let toolStates = {};
            try {
                toolStates = await window.electronAPI.getToolStates?.() || {};
            } catch (error) {
                console.warn('Could not load tool states, using defaults:', error);
            }

            // Also get the active tools list from CapabilityManager
            let activeToolNames = new Set();
            try {
                const activeTools = await window.electronAPI.capability?.getActiveTools?.() || [];
                activeToolNames = new Set(activeTools);
            } catch (e) { /* graceful fallback */ }

            const customToolNames = new Set(customTools.map(t => t.name));

            // Build tool -> group map from capability groups (dynamic, not hard-coded)
            const groupColorPalette = [
                '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
                '#ec4899', '#6b7280', '#ef4444', '#14b8a6'
            ];
            const toolToGroup = new Map();
            capabilityGroups.forEach((group, idx) => {
                const color = groupColorPalette[idx % groupColorPalette.length];
                // allTools covers all tools in any mode for this group
                const allTools = group.allTools || group.tools || [];
                allTools.forEach(toolName => {
                    toolToGroup.set(toolName, {
                        id: group.id,
                        name: group.name,
                        icon: group.icon,
                        enabled: group.enabled,
                        color
                    });
                });
            });

            // Group tools visually by their capability group
            // Sort: enabled groups first, then disabled, then ungrouped
            const groupOrder = capabilityGroups.map(g => g.id);
            const toolsByGroup = new Map(); // groupId -> tools[]
            const ungroupedTools = [];

            tools.forEach(tool => {
                const groupInfo = toolToGroup.get(tool.name);
                if (groupInfo) {
                    if (!toolsByGroup.has(groupInfo.id)) toolsByGroup.set(groupInfo.id, []);
                    toolsByGroup.get(groupInfo.id).push({ tool, groupInfo });
                } else if (customToolNames.has(tool.name)) {
                    // Custom tools go into a virtual "custom" group
                    if (!toolsByGroup.has('custom')) toolsByGroup.set('custom', []);
                    toolsByGroup.get('custom').push({ tool, groupInfo: { id: 'custom', name: 'Custom Tools', icon: '🔧', enabled: true, color: '#6b7280' } });
                } else {
                    ungroupedTools.push({ tool, groupInfo: null });
                }
            });

            // Render groups
            const renderOrder = [...groupOrder, 'custom'];
            renderOrder.forEach(groupId => {
                const groupTools = toolsByGroup.get(groupId);
                if (!groupTools || groupTools.length === 0) return;

                const groupInfo = groupTools[0].groupInfo;
                const groupEnabled = groupId === 'custom' ? true : (groupInfo?.enabled ?? true);

                // Group header
                const groupHeader = document.createElement('div');
                groupHeader.className = `mcp-group-header ${groupEnabled ? '' : 'group-disabled'}`;
                groupHeader.style.cssText = `
                    display: flex; align-items: center; gap: 0.5rem;
                    padding: 0.4rem 0.6rem; margin: 0.6rem 0 0.2rem 0;
                    border-radius: 6px;
                    background: ${groupEnabled ? `${groupInfo.color}18` : 'rgba(100,100,100,0.08)'};
                    border-left: 3px solid ${groupEnabled ? groupInfo.color : '#9ca3af'};
                    font-size: 0.82rem; font-weight: 600; color: ${groupEnabled ? 'inherit' : '#9ca3af'};
                `;
                groupHeader.innerHTML = `
                    <span>${groupInfo.icon}</span>
                    <span>${groupInfo.name}</span>
                    ${groupEnabled ? '' : '<span style="margin-left:auto;font-size:0.75rem;">🔒 disabled</span>'}
                `;
                container.appendChild(groupHeader);

                // Tools in this group
                groupTools.forEach(({ tool, groupInfo: gi }) => {
                    const toolElement = document.createElement('div');
                    const isCustom = customToolNames.has(tool.name);
                    const isCapabilityActive = activeToolNames.size > 0 ? activeToolNames.has(tool.name) : true;
                    const isDbActive = toolStates[tool.name]?.active !== false;
                    const isActive = isCapabilityActive && isDbActive;
                    const groupColor = gi?.color || '#6b7280';

                    toolElement.className = `mcp-tool-card ${!groupEnabled ? 'tool-group-disabled' : ''}`;
                    toolElement.style.borderLeft = `3px solid ${groupEnabled ? groupColor : '#9ca3af'}`;
                    toolElement.setAttribute('data-full-description', tool.description);
                    toolElement.setAttribute('data-group', gi?.id || 'custom');

                    toolElement.innerHTML = `
                        <div class="tool-card-header">
                            <h4 class="tool-card-name">
                                ${isCustom ? '🔧 ' : ''}${tool.name}
                                ${!groupEnabled ? '<span class="tool-disabled-badge" title="Group disabled">🔒</span>' : ''}
                            </h4>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                ${isCustom ? '<button class="delete-tool-btn" data-tool="' + tool.name + '" title="Delete custom tool">🗑️</button>' : ''}
                                <label class="tool-toggle" title="${!groupEnabled ? 'Enable group to allow this tool' : ''}">
                                    <input type="checkbox" class="tool-active-checkbox"
                                           data-tool="${tool.name}"
                                           data-group="${gi?.id || ''}"
                                           data-group-enabled="${groupEnabled}"
                                           ${isActive ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <div class="tool-card-description">${tool.description}</div>
                        ${tool.inputSchema?.properties ? `<div class="tool-card-params">Params: ${Object.keys(tool.inputSchema.properties).join(', ')}</div>` : ''}
                    `;

                    // Toggle handler — auto-enables group if needed
                    const checkbox = toolElement.querySelector('.tool-active-checkbox');
                    checkbox.addEventListener('change', async (e) => {
                        const tName = e.target.dataset.tool;
                        const active = e.target.checked;
                        const gId = e.target.dataset.group;
                        const gEnabled = e.target.dataset.groupEnabled === 'true';

                        if (active && !gEnabled && gId) {
                            const confirmed = confirm(`The "${gi?.name || gId}" group is currently disabled.\nEnable the group to allow this tool?`);
                            if (!confirmed) {
                                e.target.checked = false;
                                return;
                            }
                            // Enable the capability group
                            await window.electronAPI.capability?.setGroup?.(gId, true);
                        }
                        try {
                            await window.electronAPI.setToolActive?.(tName, active);
                            // Ensure UI reflects final persisted state after possible
                            // capability-update mid-flight reloads.
                            await this.loadMCPTools();
                        } catch (error) {
                            console.error('Failed to update tool state:', error);
                            e.target.checked = !active;
                        }
                    });

                    // Delete handler for custom tools
                    const deleteBtn = toolElement.querySelector('.delete-tool-btn');
                    if (deleteBtn) {
                        deleteBtn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const tName = e.currentTarget.dataset.tool;
                            if (confirm(`Delete custom tool "${tName}"?`)) {
                                try {
                                    await window.electronAPI.deleteCustomTool(tName);
                                    await this.loadMCPTools();
                                    window.mainPanel?.showNotification?.(`Tool "${tName}" deleted`);
                                } catch (error) {
                                    console.error('Failed to delete tool:', error);
                                    window.mainPanel?.showNotification?.('Failed to delete tool', 'error');
                                }
                            }
                        });
                    }

                    container.appendChild(toolElement);
                });
            });

            // Render any ungrouped tools at the bottom
            if (ungroupedTools.length > 0) {
                const ugHeader = document.createElement('div');
                ugHeader.style.cssText = 'padding:0.3rem 0.6rem;margin:0.6rem 0 0.2rem;font-size:0.78rem;color:#9ca3af;';
                ugHeader.textContent = 'Other';
                container.appendChild(ugHeader);
                ungroupedTools.forEach(({ tool }) => {
                    const toolElement = document.createElement('div');
                    toolElement.className = 'mcp-tool-card';
                    toolElement.style.borderLeft = '3px solid #6b7280';
                    toolElement.innerHTML = `
                        <div class="tool-card-header">
                            <h4 class="tool-card-name">${tool.name}</h4>
                        </div>
                        <div class="tool-card-description">${tool.description}</div>
                    `;
                    container.appendChild(toolElement);
                });
            }

            // Update tool tester dropdown
            if (toolSelect) {
                toolSelect.innerHTML = '<option value="">Select a tool...</option>';
                tools.forEach(tool => {
                    const option = document.createElement('option');
                    option.value = tool.name;
                    option.textContent = tool.name;
                    toolSelect.appendChild(option);
                });
            }

            // Setup tool tester button
            const testBtn = document.getElementById('test-tool-btn');
            if (testBtn && !testBtn._listenerAdded) {
                testBtn.addEventListener('click', () => this.testTool());
                testBtn._listenerAdded = true;
            }

            if (activityContainer) {
                if (this.toolActivity.length === 0) {
                    activityContainer.innerHTML = '<div class="no-activity">No tool activity yet</div>';
                } else {
                    this.updateToolIndicators();
                }
            }
        } catch (error) {
            console.error('Error loading MCP tools:', error);
        }
    }

    // Called on capability-update events to refresh MCP tab if it's visible
    setupCapabilityListener() {
        if (window.electronAPI?.onCapabilityUpdate) {
            window.electronAPI.onCapabilityUpdate(() => {
                if (this.currentTab === 'mcp') {
                    this.loadMCPTools();
                }
            });
        }
    }

    async loadWorkflows() {
        try {
            const workflows = await window.electronAPI.getWorkflows?.() || [];
            const tools = await window.electronAPI.getMCPTools?.() || [];
            const container = document.getElementById('workflows-container');
            const toolSelect = document.getElementById('workflow-tool-select');
            const selectedToolsDiv = document.getElementById('selected-workflow-tools');

            if (!container) return;

            // Populate tool select dropdown
            if (toolSelect) {
                toolSelect.innerHTML = '';
                tools.forEach(tool => {
                    const option = document.createElement('option');
                    option.value = tool.name;
                    option.textContent = `${tool.name}`;
                    toolSelect.appendChild(option);
                });

                // Track selected tools in order
                this.selectedWorkflowTools = [];

                toolSelect.addEventListener('dblclick', (e) => {
                    const toolName = e.target.value;
                    if (toolName && !this.selectedWorkflowTools.includes(toolName)) {
                        this.selectedWorkflowTools.push(toolName);
                        this.updateSelectedToolsDisplay(selectedToolsDiv);
                    }
                });
            }

            // Setup save button
            document.getElementById('save-workflow-btn')?.addEventListener('click', () => this.saveWorkflow());
            document.getElementById('clear-workflow-form-btn')?.addEventListener('click', () => this.clearWorkflowForm());

            // Render saved workflows
            container.innerHTML = '';
            if (workflows.length === 0) {
                container.innerHTML = '<div class="no-workflows">No workflows saved yet. Create one above!</div>';
                return;
            }

            workflows.forEach(workflow => {
                const workflowCard = document.createElement('div');
                workflowCard.className = 'workflow-card';
                const toolChain = Array.isArray(workflow.tool_chain)
                    ? workflow.tool_chain
                    : JSON.parse(workflow.tool_chain || '[]');

                workflowCard.innerHTML = `
                    <div class="workflow-card-header">
                        <h4 class="workflow-name">🔄 ${workflow.name}</h4>
                        <div class="workflow-actions">
                            <button class="run-workflow-btn icon-btn" data-id="${workflow.id}" title="Run Workflow">▶️</button>
                            <button class="delete-workflow-btn icon-btn" data-id="${workflow.id}" title="Delete">🗑️</button>
                        </div>
                    </div>
                    <div class="workflow-description">${workflow.description || 'No description'}</div>
                    <div class="workflow-tools">
                        <span class="tools-label">Tools:</span>
                        ${toolChain.map(t => `<span class="workflow-tool-badge">${t.tool || t}</span>`).join(' → ')}
                    </div>
                    <div class="workflow-stats">
                        <span>Runs: ${workflow.execution_count || 0}</span>
                        <span>Success: ${workflow.success_count || 0}</span>
                    </div>
                `;

                // Run workflow handler
                workflowCard.querySelector('.run-workflow-btn').addEventListener('click', async () => {
                    try {
                        const result = await window.electronAPI.runWorkflow?.(workflow.id);
                        if (window.mainPanel) {
                            window.mainPanel.showNotification(result.success ? 'Workflow executed!' : 'Workflow failed');
                        }
                        await this.loadWorkflows(); // Refresh to update stats
                    } catch (error) {
                        console.error('Failed to run workflow:', error);
                    }
                });

                // Delete workflow handler
                workflowCard.querySelector('.delete-workflow-btn').addEventListener('click', async () => {
                    if (confirm(`Delete workflow "${workflow.name}"?`)) {
                        try {
                            await window.electronAPI.deleteWorkflow?.(workflow.id);
                            await this.loadWorkflows();
                            if (window.mainPanel) {
                                window.mainPanel.showNotification('Workflow deleted');
                            }
                        } catch (error) {
                            console.error('Failed to delete workflow:', error);
                        }
                    }
                });

                container.appendChild(workflowCard);
            });
        } catch (error) {
            console.error('Error loading workflows:', error);
        }
    }

    updateSelectedToolsDisplay(container) {
        if (!container) return;
        container.innerHTML = this.selectedWorkflowTools.map((tool, idx) => `
            <span class="selected-tool-chip" data-index="${idx}">
                ${idx + 1}. ${tool}
                <button class="remove-tool-btn" data-index="${idx}">×</button>
            </span>
        `).join(' → ');

        container.querySelectorAll('.remove-tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                this.selectedWorkflowTools.splice(idx, 1);
                this.updateSelectedToolsDisplay(container);
            });
        });
    }

    async saveWorkflow() {
        const name = document.getElementById('workflow-name')?.value.trim();
        const description = document.getElementById('workflow-description')?.value.trim();

        if (!name) {
            if (window.mainPanel) window.mainPanel.showNotification('Please enter a workflow name', 'error');
            return;
        }

        if (!this.selectedWorkflowTools || this.selectedWorkflowTools.length === 0) {
            if (window.mainPanel) window.mainPanel.showNotification('Please select at least one tool', 'error');
            return;
        }

        try {
            const workflow = {
                name,
                description,
                tool_chain: this.selectedWorkflowTools.map(t => ({ tool: t, params: {} }))
            };

            await window.electronAPI.saveWorkflow?.(workflow);
            if (window.mainPanel) window.mainPanel.showNotification('Workflow saved!');
            this.clearWorkflowForm();
            await this.loadWorkflows();
        } catch (error) {
            console.error('Failed to save workflow:', error);
            if (window.mainPanel) window.mainPanel.showNotification('Failed to save workflow', 'error');
        }
    }

    clearWorkflowForm() {
        document.getElementById('workflow-name').value = '';
        document.getElementById('workflow-description').value = '';
        this.selectedWorkflowTools = [];
        const container = document.getElementById('selected-workflow-tools');
        if (container) container.innerHTML = '';
    }

    selectTool(toolName) {
        const toolSelect = document.getElementById('tool-select');
        if (toolSelect) toolSelect.value = toolName;
        this.switchTab('mcp');
    }

    async testTool() {
        const toolName = document.getElementById('tool-select')?.value;
        const paramsText = document.getElementById('tool-params')?.value || '{}';
        const resultDiv = document.getElementById('tool-result');

        if (!toolName) {
            resultDiv.innerHTML = '<div class="error">Please select a tool</div>';
            return;
        }

        try {
            const params = JSON.parse(paramsText);
            resultDiv.innerHTML = '<div class="loading">Executing...</div>';

            const result = await window.electronAPI.executeMCPTool(toolName, params);

            if (result.success) {
                resultDiv.innerHTML = `<div class="success"><strong>Success:</strong><pre>${JSON.stringify(result.result, null, 2)}</pre></div>`;
            } else {
                resultDiv.innerHTML = `<div class="error"><strong>Error:</strong> ${result.error}</div>`;
            }
        } catch (error) {
            resultDiv.innerHTML = `<div class="error"><strong>Error:</strong> ${error.message}</div>`;
        }
    }

    async loadSystemPrompt() {
        try {
            const prompt = await window.electronAPI.getSystemPrompt();
            const promptTextarea = document.getElementById('system-prompt');
            if (promptTextarea) {
                promptTextarea.value = prompt || '';
            }

            // Also load prompt rules
            if (window.mainPanel && window.mainPanel.loadPromptRules) {
                await window.mainPanel.loadPromptRules();
            }
        } catch (error) {
            console.error('Error loading system prompt:', error);
        }
    }

    async loadAPIKeys() {
        try {
            const settings = await window.electronAPI.getSettings();
            Object.keys(settings.apiKeys || {}).forEach(provider => {
                const input = document.getElementById(`${provider}-key`);
                if (input) {
                    input.value = settings.apiKeys[provider] || '';
                }
            });
        } catch (error) {
            console.error('Error loading API keys:', error);
        }
    }

    getCurrentTab() {
        return this.currentTab;
    }

    setupToolListeners() {
        window.electronAPI.onToolUpdate((event, data) => {
            this.toolActivity.unshift({
                tool: data.toolName,
                time: new Date().toLocaleTimeString(),
                success: data.success,
                params: data.params || {},
                result: data.result,
                error: data.error
            });

            // Keep only last 10 activities
            this.toolActivity = this.toolActivity.slice(0, 10);

            // Increment unseen tool count
            this.unseenToolCount++;
            this.updateToolIndicators();
        });

        // Listen for conversation updates to refresh chat list
        window.electronAPI.onConversationUpdate(() => {
            this.loadChatSessions();
        });
    }

    updateToolIndicators() {
        // Update badge count based on unseen activities
        const badge = document.getElementById('tool-count-badge');
        if (badge) {
            badge.textContent = this.unseenToolCount > 0 ? this.unseenToolCount : '';
            badge.style.display = this.unseenToolCount > 0 ? 'inline-block' : 'none';
        }

        // Update MCP tab activity
        const mcpContainer = document.getElementById('tool-activity');
        if (mcpContainer) {
            mcpContainer.innerHTML = this.toolActivity.map(item => `
                <div class="tool-indicator ${item.success ? 'success' : 'error'}">
                    <span class="tool-name">${item.tool}</span>
                    <span class="tool-time">${item.time}</span>
                </div>
            `).join('');
        }

        // Update Tool Activity tab
        this.updateToolActivityTab();
    }

    updateToolActivityTab() {
        const list = document.getElementById('tool-activity-list');
        if (!list) return;

        if (this.toolActivity.length === 0) {
            list.innerHTML = '<div class="no-activity">No tool activity yet</div>';
        } else {
            list.innerHTML = this.toolActivity.map((item, index) => {
                const isSearxngSearch = item.tool === 'plugin_searxng_search_search';
                const paramsJson = JSON.stringify(item.params, null, 2);
                const resultJson = item.success
                    ? JSON.stringify(item.result, null, 2)
                    : item.error || 'Unknown error';

                return `
                <div class="tool-activity-item ${item.success ? 'success' : 'error'}${isSearxngSearch && item.success ? ' searxng-complete' : ''}" data-index="${index}">
                    <div class="tool-header" onclick="window.sidebar.toggleToolDetails(${index})">
                        <span class="tool-expand">▶</span>
                        <strong>${item.tool}</strong>
                        <span class="tool-time">${item.time}</span>
                        <span class="tool-status-badge">${item.success ? '✓' : '✗'}</span>
                    </div>
                    <div class="tool-details" style="display: none;">
                        <div class="tool-section">
                            <div class="tool-section-label">Parameters:</div>
                            <pre class="tool-json">${this.escapeHtml(paramsJson)}</pre>
                        </div>
                        <div class="tool-section">
                            <div class="tool-section-label">${item.success ? 'Result:' : 'Error:'}</div>
                            <pre class="tool-json ${item.success ? '' : 'error-text'}">${this.escapeHtml(resultJson)}</pre>
                        </div>
                    </div>
                </div>
            `}).join('');
        }
    }

    toggleToolDetails(index) {
        const items = document.querySelectorAll('.tool-activity-item');
        const item = items[index];
        if (!item) return;

        const details = item.querySelector('.tool-details');
        const expand = item.querySelector('.tool-expand');

        if (details.style.display === 'none') {
            details.style.display = 'block';
            expand.textContent = '▼';
        } else {
            details.style.display = 'none';
            expand.textContent = '▶';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async loadChatSessions(date = null) {
        try {
            // Always get last 6, unless date is specified and has more than 6
            let sessions = await window.electronAPI.getChatSessions(null, 6);

            if (date) {
                const dateSessions = await window.electronAPI.getChatSessions(date, 100);
                if (dateSessions.length > 0) {
                    sessions = dateSessions.slice(0, 6);
                }
            }
            const container = document.getElementById('chat-sessions-list');

            if (!container) return;
            container.replaceChildren();

            if (sessions.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'no-sessions';
                empty.textContent = 'No chats';
                container.appendChild(empty);
                return;
            }

            sessions.forEach((session) => {
                const preview = session.first_message ?
                    (session.first_message.length > 15 ? session.first_message.substring(0, 15) + '...' : session.first_message) :
                    'Empty';
                const time = new Date(session.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                const item = document.createElement('div');
                item.className = 'chat-session-compact';
                item.dataset.sessionId = String(session.id);
                item.title = session.first_message || 'Empty chat';

                const timeEl = document.createElement('span');
                timeEl.className = 'session-time';
                timeEl.textContent = time;
                item.appendChild(timeEl);

                const previewEl = document.createElement('span');
                previewEl.className = 'session-preview';
                previewEl.textContent = preview;
                item.appendChild(previewEl);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-session-btn';
                deleteBtn.dataset.sessionId = String(session.id);
                deleteBtn.title = 'Delete chat';
                deleteBtn.textContent = '×';
                item.appendChild(deleteBtn);

                const rawSessionId = item.dataset.sessionId;
                const sessionId = /^\d+$/.test(rawSessionId) ? parseInt(rawSessionId, 10) : rawSessionId;

                // Click on item (not delete button)
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('delete-session-btn')) {
                        return;
                    }
                    this.loadSession(sessionId);
                });

                // Delete button
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteSession(sessionId);
                });

                container.appendChild(item);
            });
        } catch (error) {
            console.error('Error loading chat sessions:', error);
        }
    }

    async loadSession(sessionId) {
        try {
            // Route through MainPanel's tab system for proper tab management
            if (window.app && window.app.mainPanel) {
                const mainPanel = window.app.mainPanel;

                // Check if this tab is already open — just switch to it
                if (mainPanel.chatTabs.has(sessionId)) {
                    await mainPanel.switchTab(sessionId);
                    this.switchTab('chat');
                    return;
                }

                // Save current tab messages before switching
                mainPanel.saveCurrentTabMessages();

                // Create a new tab for this session
                mainPanel.chatTabs.set(sessionId, {
                    title: `Chat`,
                    messagesHTML: '',
                    isSending: false,
                    loadingId: null
                });

                mainPanel.activeTabId = sessionId;
                await mainPanel.loadTabConversations(sessionId);
                await mainPanel.autoTitleTab(sessionId);
                mainPanel.renderTabs();
                mainPanel.saveOpenTabIds();

                await window.electronAPI.switchChatSession(sessionId);
                await mainPanel.calculateContextUsage();
            }

            // Switch to chat tab in sidebar
            this.switchTab('chat');
        } catch (error) {
            console.error('Error loading session:', error);
        }
    }

    async deleteSession(sessionId) {
        if (confirm('Delete this chat? This cannot be undone.')) {
            try {
                await window.electronAPI.deleteChatSession(sessionId);
                await this.loadChatSessions();
            } catch (error) {
                console.error('Error deleting session:', error);
            }
        }
    }
}

// Initialize sidebar when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.sidebar = new Sidebar();
});
