/**
 * AgentPickerWidget — Splits agent display by type:
 * - Pro agents in the left sidebar.
 * - Sub-agents in the right widget panel.
 */
class AgentPickerWidget {
    constructor() {
        this.agents = [];
        this.initializeEvents();
    }

    initializeEvents() {
        this.loadAgents();

        const addBtn = document.getElementById('add-agent-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAgentConfigModal());
        }

        // Listen for agent updates from backend
        window.electronAPI.onAgentUpdate(() => {
            this.loadAgents();
        });
    }

    async loadAgents() {
        try {
            this.agents = await window.electronAPI.agents.list();
            this.renderAgents();
        } catch (error) {
            console.error('Error loading agents:', error);
        }
    }

    renderAgents() {
        const proContainer = document.getElementById('agent-list');
        const subContainer = document.getElementById('subagent-list');
        if (proContainer) proContainer.innerHTML = '';
        if (subContainer) subContainer.innerHTML = '';

        const proAgents = this.agents.filter(a => a.type === 'pro');
        const subAgents = this.agents.filter(a => a.type === 'sub');

        if (proContainer && proAgents.length > 0) {
            const proGrid = document.createElement('div');
            proGrid.className = 'agent-grid';
            proAgents.forEach(agent => {
                proGrid.appendChild(this._createAgentItem(agent));
            });
            proContainer.appendChild(proGrid);
        } else if (proContainer) {
            proContainer.innerHTML = '<p class="no-agents">No pro agents configured</p>';
        }

        if (subContainer && subAgents.length > 0) {
            const subGrid = document.createElement('div');
            subGrid.className = 'agent-grid';
            subAgents.forEach(agent => {
                subGrid.appendChild(this._createAgentItem(agent));
            });
            subContainer.appendChild(subGrid);
        } else if (subContainer) {
            subContainer.innerHTML = '<p class="no-agents">No sub-agents configured</p>';
        }
    }

    _createAgentItem(agent) {
        const item = document.createElement('div');
        item.className = `agent-item ${agent.status === 'active' ? 'active' : ''}`;
        item.dataset.agentId = agent.id;
        item.title = `${agent.name}\n${agent.description || ''}`;

        item.innerHTML = `
            <span class="agent-icon">${agent.icon}</span>
            <span class="agent-name">${agent.name}</span>
            <span class="agent-status-dot ${agent.status}"></span>
        `;

        // Click to activate and open agent chat
        item.addEventListener('click', (e) => {
            if (e.target.closest('.agent-config-btn')) return;
            this.activateAgent(agent.id);
        });

        // Right-click for config
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showAgentConfigModal(agent.id);
        });

        return item;
    }

    async activateAgent(agentId) {
        try {
            const result = await window.electronAPI.agents.activate(agentId);
            if (result && result.sessionId) {
                // Open or switch to the agent's chat tab
                if (window.app && window.app.mainPanel) {
                    await window.app.mainPanel.openAgentChat(agentId, result.sessionId, result.agent);
                }
            }
        } catch (error) {
            console.error('Error activating agent:', error);
        }
    }

    showAgentConfigModal(agentId = null) {
        const isEdit = agentId !== null;
        const existingAgent = isEdit ? this.agents.find(a => a.id === agentId) : null;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content agent-config-modal">
                <h3>${isEdit ? 'Edit Agent' : 'Create Agent'}</h3>
                <form id="agent-config-form">
                    <label>
                        Name:
                        <input type="text" name="name" value="${existingAgent?.name || ''}" required>
                    </label>
                    <label>
                        Type:
                        <select name="type">
                            <option value="pro" ${(!existingAgent || existingAgent.type === 'pro') ? 'selected' : ''}>Pro Agent</option>
                            <option value="sub" ${existingAgent?.type === 'sub' ? 'selected' : ''}>Sub Agent</option>
                        </select>
                    </label>
                    <label>
                        Icon:
                        <div class="icon-picker" id="icon-picker">
                            ${this._renderIconPicker(existingAgent?.icon || '🤖')}
                        </div>
                        <input type="hidden" name="icon" value="${existingAgent?.icon || '🤖'}">
                    </label>
                    <label>
                        Description:
                        <input type="text" name="description" value="${existingAgent?.description || ''}" placeholder="Brief description...">
                    </label>
                    <label>
                        System Prompt:
                        <textarea name="system_prompt" rows="8" placeholder="Define this agent's behavior...">${existingAgent?.system_prompt || ''}</textarea>
                    </label>
                    <div class="modal-actions">
                        ${isEdit ? '<button type="button" class="danger-btn delete-agent-btn">Delete</button>' : ''}
                        <button type="button" class="secondary-btn cancel-btn">Cancel</button>
                        <button type="submit" class="primary-btn">${isEdit ? 'Save' : 'Create'}</button>
                    </div>
                </form>
            </div>
        `;

        // Modal styling
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex; align-items: center; justify-content: center;
            z-index: 1000;
        `;

        const content = modal.querySelector('.modal-content');
        content.style.cssText = `
            background: var(--bg-primary, #fff); color: var(--text-primary, #222);
            padding: 1.5rem; border-radius: 8px;
            width: 500px; max-width: 90%; max-height: 80vh; overflow-y: auto;
        `;

        // Icon picker click handler
        modal.querySelectorAll('.icon-option').forEach(opt => {
            opt.addEventListener('click', () => {
                modal.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                modal.querySelector('input[name="icon"]').value = opt.dataset.icon;
            });
        });

        // Form submit
        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {
                name: formData.get('name'),
                type: formData.get('type'),
                icon: formData.get('icon'),
                description: formData.get('description'),
                system_prompt: formData.get('system_prompt')
            };

            try {
                if (isEdit) {
                    await window.electronAPI.agents.update(agentId, data);
                } else {
                    await window.electronAPI.agents.create(data);
                }
                modal.remove();
            } catch (error) {
                console.error('Error saving agent:', error);
                alert('Error saving agent: ' + error.message);
            }
        });

        // Delete button
        const deleteBtn = modal.querySelector('.delete-agent-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                if (confirm(`Delete agent "${existingAgent.name}"?`)) {
                    try {
                        await window.electronAPI.agents.delete(agentId);
                        modal.remove();
                    } catch (error) {
                        console.error('Error deleting agent:', error);
                    }
                }
            });
        }

        // Cancel
        modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        document.body.appendChild(modal);
    }

    _renderIconPicker(selectedIcon) {
        const icons = ['🤖', '🔍', '🔬', '📂', '📊', '🌐', '💻', '🧠', '📝', '🎯', '⚡', '🛡️', '🔧', '📡', '🎨', '📈'];
        return icons.map(icon =>
            `<span class="icon-option ${icon === selectedIcon ? 'selected' : ''}" data-icon="${icon}">${icon}</span>`
        ).join('');
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.agentPicker = new AgentPickerWidget();
});
