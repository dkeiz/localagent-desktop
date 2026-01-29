class App {
    constructor() {
        this.mainPanel = new MainPanel();
        this.initializeApp();
        this.initializePanelToggles();
        this.initializeToolGroups();
    }

    async initializeApp() {
        // Listen for provider changes to refresh models
        const providerSelect = document.getElementById('ai-provider');
        if (providerSelect) {
            providerSelect.addEventListener('change', async (e) => {
                await this.mainPanel.loadModelsForProvider(e.target.value);
            });
        }
    }

    initializePanelToggles() {
        const appContainer = document.querySelector('.app-container');
        const leftSidebar = document.getElementById('left-sidebar');
        const rightPanel = document.getElementById('right-panel');
        const leftToggle = document.getElementById('toggle-left-sidebar');
        const rightToggle = document.getElementById('toggle-right-panel');

        // Restore saved panel states
        const leftCollapsed = localStorage.getItem('leftSidebarCollapsed') === 'true';
        const rightCollapsed = localStorage.getItem('rightPanelCollapsed') === 'true';

        if (leftCollapsed) {
            appContainer.classList.add('left-collapsed');
            leftSidebar.classList.add('collapsed');
            leftToggle.textContent = '▶';
        }

        if (rightCollapsed) {
            appContainer.classList.add('right-collapsed');
            rightPanel.classList.add('collapsed');
            rightToggle.textContent = '◀';
        }

        // Left sidebar toggle
        leftToggle.addEventListener('click', () => {
            const isCollapsed = leftSidebar.classList.toggle('collapsed');
            appContainer.classList.toggle('left-collapsed', isCollapsed);
            leftToggle.textContent = isCollapsed ? '▶' : '◀';
            localStorage.setItem('leftSidebarCollapsed', isCollapsed);
        });

        // Right panel toggle
        rightToggle.addEventListener('click', () => {
            const isCollapsed = rightPanel.classList.toggle('collapsed');
            appContainer.classList.toggle('right-collapsed', isCollapsed);
            rightToggle.textContent = isCollapsed ? '◀' : '▶';
            localStorage.setItem('rightPanelCollapsed', isCollapsed);
        });
    }

    async initializeToolGroups() {
        const container = document.getElementById('tool-groups-container');
        if (!container) return;

        try {
            const groups = await window.electronAPI.getToolGroups();
            this.renderToolGroups(container, groups);
        } catch (error) {
            console.error('Failed to load tool groups:', error);
        }
    }

    renderToolGroups(container, groups) {
        container.innerHTML = '';

        Object.entries(groups).forEach(([groupId, group]) => {
            const item = document.createElement('div');
            item.className = `tool-group-item ${group.active ? 'active' : ''}`;
            item.dataset.groupId = groupId;

            item.innerHTML = `
                <button class="tool-group-settings" title="Configure ${group.name}">⚙</button>
                <span class="tool-group-icon">${group.icon}</span>
                <span class="tool-group-label">${group.name}</span>
                <span class="tool-group-count">${group.tools.length}</span>
            `;

            // Click on main area toggles the group
            item.addEventListener('click', async (e) => {
                if (e.target.classList.contains('tool-group-settings')) return;

                const isActive = item.classList.contains('active');
                try {
                    if (isActive) {
                        await window.electronAPI.deactivateToolGroup(groupId);
                    } else {
                        await window.electronAPI.activateToolGroup(groupId);
                    }
                    item.classList.toggle('active');
                } catch (error) {
                    console.error(`Failed to toggle group ${groupId}:`, error);
                }
            });

            // Settings button navigates to MCP page
            const settingsBtn = item.querySelector('.tool-group-settings');
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Switch to MCP tools tab
                const mcpTab = document.querySelector('[data-tab="mcp"]');
                if (mcpTab) mcpTab.click();
            });

            container.appendChild(item);
        });
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});

