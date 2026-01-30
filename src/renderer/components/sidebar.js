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
                await this.loadWorkflows();
                break;
        }
    }

    async loadMCPTools() {
        try {
            const tools = await window.electronAPI.getMCPTools();
            const customTools = await window.electronAPI.getCustomTools?.() || [];
            const toolGroups = await window.electronAPI.getToolGroups() || [];
            const container = document.getElementById('mcp-tools-container');
            const toolSelect = document.getElementById('tool-select');
            const activityContainer = document.getElementById('tool-activity');

            if (!container) return;

            container.innerHTML = '';
            if (toolSelect) {
                toolSelect.innerHTML = '<option value="">Select a tool...</option>';
                tools.forEach(tool => {
                    const option = document.createElement('option');
                    option.value = tool.name;
                    option.textContent = tool.name;
                    toolSelect.appendChild(option);
                });
            }

            // Get tool activation states
            let toolStates = {};
            try {
                toolStates = await window.electronAPI.getToolStates?.() || {};
            } catch (error) {
                console.warn('Could not load tool states, using defaults:', error);
            }

            const customToolNames = new Set(customTools.map(t => t.name));

            // Create a map of tool name -> group info with colors
            const groupColors = {
                storage: '#8b5cf6',  // purple
                web: '#3b82f6',      // blue
                agent: '#10b981',    // green
                call: '#f59e0b',     // amber
                system: '#6b7280',   // gray
                media: '#ec4899'     // pink
            };

            const toolToGroup = new Map();
            toolGroups.forEach(group => {
                group.tools.forEach(toolName => {
                    toolToGroup.set(toolName, {
                        id: group.id,
                        name: group.name,
                        icon: group.icon,
                        active: group.active,
                        color: groupColors[group.id] || '#6b7280'
                    });
                });
            });

            // Render all tools in flat grid
            tools.forEach(tool => {
                const toolElement = document.createElement('div');
                const isActive = toolStates[tool.name]?.active !== false;
                const isCustom = customToolNames.has(tool.name);
                const groupInfo = toolToGroup.get(tool.name);
                const groupColor = groupInfo?.color || '#6b7280';
                const groupIcon = groupInfo?.icon || '🔧';

                toolElement.className = 'mcp-tool-card';
                toolElement.style.borderLeft = `3px solid ${groupColor}`;
                toolElement.setAttribute('data-full-description', tool.description);
                toolElement.setAttribute('data-group', groupInfo?.id || 'custom');
                toolElement.innerHTML = `
                    <div class="tool-card-header">
                        <h4 class="tool-card-name"><span class="tool-group-badge" title="${groupInfo?.name || 'Custom'}">${groupIcon}</span> ${isCustom ? '🔧 ' : ''}${tool.name}</h4>
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            ${isCustom ? '<button class="delete-tool-btn" data-tool="' + tool.name + '" title="Delete custom tool">🗑️</button>' : ''}
                            <label class="tool-toggle">
                                <input type="checkbox" class="tool-active-checkbox"
                                       data-tool="${tool.name}"
                                       ${isActive ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="tool-card-description">${tool.description}</div>
                    ${tool.inputSchema?.properties ? `<div class="tool-card-params">Params: ${Object.keys(tool.inputSchema.properties).join(', ')}</div>` : ''}
                `;

                // Toggle handler
                const checkbox = toolElement.querySelector('.tool-active-checkbox');
                checkbox.addEventListener('change', async (e) => {
                    const toolName = e.target.dataset.tool;
                    const active = e.target.checked;
                    try {
                        await window.electronAPI.setToolActive?.(toolName, active);
                        console.log(`${toolName} ${active ? 'enabled' : 'disabled'}`);
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
                        const toolName = e.target.dataset.tool;
                        if (confirm(`Delete custom tool "${toolName}"?`)) {
                            try {
                                await window.electronAPI.deleteCustomTool(toolName);
                                await this.loadMCPTools();
                                if (window.mainPanel) {
                                    window.mainPanel.showNotification(`Tool "${toolName}" deleted`);
                                }
                            } catch (error) {
                                console.error('Failed to delete tool:', error);
                                if (window.mainPanel) {
                                    window.mainPanel.showNotification('Failed to delete tool', 'error');
                                }
                            }
                        }
                    });
                }

                container.appendChild(toolElement);
            });

            // Setup tool tester
            document.getElementById('test-tool-btn')?.addEventListener('click', () => this.testTool());

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
                const paramsJson = JSON.stringify(item.params, null, 2);
                const resultJson = item.success
                    ? JSON.stringify(item.result, null, 2)
                    : item.error || 'Unknown error';

                return `
                <div class="tool-activity-item ${item.success ? 'success' : 'error'}" data-index="${index}">
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

            if (sessions.length === 0) {
                container.innerHTML = '<div class="no-sessions">No chats</div>';
                return;
            }

            container.innerHTML = sessions.map(session => {
                const preview = session.first_message ?
                    (session.first_message.length > 15 ? session.first_message.substring(0, 15) + '...' : session.first_message) :
                    'Empty';
                const time = new Date(session.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                return `
                    <div class="chat-session-compact" data-session-id="${session.id}" title="${session.first_message || 'Empty chat'}">
                        <span class="session-time">${time}</span>
                        <span class="session-preview">${preview}</span>
                        <button class="delete-session-btn" data-session-id="${session.id}" title="Delete chat">×</button>
                    </div>
                `;
            }).join('');

            // Add click handlers
            container.querySelectorAll('.chat-session-compact').forEach(item => {
                const sessionId = parseInt(item.dataset.sessionId);

                // Click on item (not delete button)
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('delete-session-btn')) {
                        return;
                    }
                    this.loadSession(sessionId);
                });

                // Delete button
                const deleteBtn = item.querySelector('.delete-session-btn');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.deleteSession(sessionId);
                    });
                }
            });
        } catch (error) {
            console.error('Error loading chat sessions:', error);
        }
    }

    async loadSession(sessionId) {
        try {
            // Switch to this session in the database
            await window.electronAPI.switchChatSession(sessionId);

            // Load conversations for this session
            const conversations = await window.electronAPI.loadChatSession(sessionId);
            this.currentSessionId = sessionId;

            // Clear and load messages
            const messagesContainer = document.getElementById('messages-container');
            if (!messagesContainer) return;

            messagesContainer.innerHTML = '';

            if (!conversations || conversations.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'no-messages';
                emptyDiv.textContent = 'No messages in this chat';
                emptyDiv.style.cssText = 'text-align: center; padding: 2rem; color: #999;';
                messagesContainer.appendChild(emptyDiv);
            } else {
                // Add all messages from this session
                conversations.forEach(conv => {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = `message ${conv.role} `;
                    messageDiv.textContent = conv.content;
                    messagesContainer.appendChild(messageDiv);
                });
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }

            // Calculate and show context usage
            if (window.mainPanel && window.mainPanel.calculateContextUsage) {
                await window.mainPanel.calculateContextUsage();
            }

            // Switch to chat tab
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
