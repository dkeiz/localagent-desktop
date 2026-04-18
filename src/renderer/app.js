class App {
    static TYPE_SIZE_MIN = 11;
    static TYPE_SIZE_MAX = 18;
    static TYPE_SIZE_DEFAULT = 13;

    constructor() {
        // MainPanel is bootstrapped in components/main-panel.js.
        // Reuse the existing instance to avoid duplicate listener registration.
        this.mainPanel = window.mainPanel || new MainPanel();
        window.mainPanel = this.mainPanel;
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
        await this.initializeSettingsTab();
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

        // groups is an array of {id, name, description, icon, tools, active, toolCount}
        groups.forEach((group) => {
            const groupId = group.id; // Use the actual group ID from the object
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
                console.log(`[Frontend] Toggling group: ${groupId}, currently active: ${isActive}`);
                try {
                    if (isActive) {
                        console.log(`[Frontend] Calling deactivateToolGroup(${groupId})`);
                        await window.electronAPI.deactivateToolGroup(groupId);
                    } else {
                        console.log(`[Frontend] Calling activateToolGroup(${groupId})`);
                        const result = await window.electronAPI.activateToolGroup(groupId);
                        console.log(`[Frontend] activateToolGroup result:`, result);
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

    initializeTheme() {
        // Load saved theme or default to light
        const savedTheme = localStorage.getItem('theme') || 'light';
        this.setTheme(savedTheme);

        // Theme picker handlers
        const themePicker = document.getElementById('theme-picker');
        if (themePicker) {
            themePicker.querySelectorAll('.theme-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const theme = btn.dataset.theme;
                    this.setTheme(theme);
                });
            });
        }
    }

    setTheme(theme) {
        // Apply theme to document
        document.documentElement.setAttribute('data-theme', theme);

        // Update button states
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        // Save preference
        localStorage.setItem('theme', theme);
    }

    parseTypeSize(value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) {
            return App.TYPE_SIZE_DEFAULT;
        }
        return Math.min(App.TYPE_SIZE_MAX, Math.max(App.TYPE_SIZE_MIN, parsed));
    }

    applyTypeSize(sizePx) {
        const clamped = this.parseTypeSize(sizePx);
        const scale = clamped / App.TYPE_SIZE_DEFAULT;
        document.documentElement.style.setProperty('--type-base', `${clamped}px`);
        document.documentElement.style.setProperty('--type-scale', `${scale}`);
        const display = document.getElementById('type-size-display');
        if (display) {
            display.textContent = `${clamped}px`;
        }
        return clamped;
    }

    async initializeSettingsTab() {
        const autoStartCheckbox = document.getElementById('auto-start');
        const minimizeToTrayCheckbox = document.getElementById('minimize-to-tray');
        const typeSizeSlider = document.getElementById('type-size-slider');

        try {
            const settings = await window.electronAPI.getSettings();
            if (autoStartCheckbox) {
                autoStartCheckbox.checked = settings?.auto_start === 'true';
                autoStartCheckbox.addEventListener('change', async (event) => {
                    await window.electronAPI.saveSetting('auto_start', event.target.checked ? 'true' : 'false');
                });
            }

            if (minimizeToTrayCheckbox) {
                minimizeToTrayCheckbox.checked = settings?.minimize_to_tray === 'true';
                minimizeToTrayCheckbox.addEventListener('change', async (event) => {
                    await window.electronAPI.saveSetting('minimize_to_tray', event.target.checked ? 'true' : 'false');
                });
            }

            const savedFromSettings = settings?.['ui.typeSize'];
            const savedFromLocal = localStorage.getItem('uiTypeSize');
            const initialTypeSize = this.applyTypeSize(savedFromSettings || savedFromLocal || App.TYPE_SIZE_DEFAULT);

            if (typeSizeSlider) {
                typeSizeSlider.value = `${initialTypeSize}`;
                const saveTypeSize = async (event) => {
                    const nextSize = this.applyTypeSize(event.target.value);
                    localStorage.setItem('uiTypeSize', `${nextSize}`);
                    await window.electronAPI.saveSetting('ui.typeSize', `${nextSize}`);
                };
                typeSizeSlider.addEventListener('input', (event) => this.applyTypeSize(event.target.value));
                typeSizeSlider.addEventListener('change', saveTypeSize);
            }
        } catch (error) {
            console.error('Failed to initialize settings tab:', error);
            const fallbackTypeSize = this.applyTypeSize(localStorage.getItem('uiTypeSize') || App.TYPE_SIZE_DEFAULT);
            if (typeSizeSlider) {
                typeSizeSlider.value = `${fallbackTypeSize}`;
                typeSizeSlider.addEventListener('input', (event) => this.applyTypeSize(event.target.value));
                typeSizeSlider.addEventListener('change', (event) => {
                    const nextSize = this.applyTypeSize(event.target.value);
                    localStorage.setItem('uiTypeSize', `${nextSize}`);
                });
            }
        }
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.initializeTheme();

    // Privacy: Delete All Conversations modal handlers
    const deleteBtn = document.getElementById('delete-all-conversations-btn');
    const modal = document.getElementById('delete-confirm-modal');
    const cancelBtn = document.getElementById('cancel-delete-btn');
    const confirmBtn = document.getElementById('confirm-delete-btn');

    if (deleteBtn && modal) {
        deleteBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
        });

        cancelBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });

        confirmBtn.addEventListener('click', async () => {
            confirmBtn.textContent = 'Deleting...';
            confirmBtn.disabled = true;

            try {
                await window.electronAPI.deleteAllConversations();
                modal.classList.add('hidden');
                // Refresh the UI
                location.reload();
            } catch (error) {
                console.error('Failed to delete conversations:', error);
                confirmBtn.textContent = 'Error! Try Again';
                confirmBtn.disabled = false;
            }
        });
    }
});


