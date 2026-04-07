/**
 * PluginPanel — Renderer component for the plugins widget in the right column.
 * Loads plugin list via IPC, renders items with enable/disable toggles.
 */
(function () {
    const { ipcRenderer } = require('electron');

    class PluginPanel {
        constructor() {
            this.listEl = document.getElementById('plugins-list');
            this.manageBtn = document.getElementById('manage-plugins-btn');
            this.widgetHeader = document.getElementById('toggle-plugins-widget');
            this.widgetContent = document.getElementById('plugins-widget-content');
            this.plugins = [];

            if (!this.listEl) return;

            this._bindEvents();
            this.load();
        }

        _bindEvents() {
            // Collapsible widget toggle
            if (this.widgetHeader) {
                this.widgetHeader.addEventListener('click', () => {
                    const widget = this.widgetHeader.closest('.plugins-widget');
                    if (widget) widget.classList.toggle('collapsed');
                });
            }

            // Manage button — for now just reloads
            if (this.manageBtn) {
                this.manageBtn.addEventListener('click', () => this.load());
            }
        }

        async load() {
            try {
                this.plugins = await ipcRenderer.invoke('plugins:list');
                this.render();
            } catch (e) {
                console.error('[PluginPanel] Failed to load plugins:', e);
            }
        }

        render() {
            if (!this.listEl) return;

            if (this.plugins.length === 0) {
                this.listEl.innerHTML = '<div class="no-plugins">No plugins installed</div>';
                return;
            }

            this.listEl.innerHTML = this.plugins.map(p => `
                <div class="plugin-item" data-id="${p.id}">
                    <div class="plugin-info">
                        <span class="plugin-status ${p.status}"></span>
                        <span class="plugin-name">${p.name}</span>
                    </div>
                    <button class="plugin-toggle-btn ${p.status === 'enabled' ? 'active' : ''}" 
                            data-id="${p.id}" data-status="${p.status}"
                            title="${p.status === 'enabled' ? 'Disable' : 'Enable'}">
                        ${p.status === 'enabled' ? 'ON' : 'OFF'}
                    </button>
                </div>
            `).join('');

            // Bind toggle buttons
            this.listEl.querySelectorAll('.plugin-toggle-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.target.dataset.id;
                    const currentStatus = e.target.dataset.status;
                    try {
                        if (currentStatus === 'enabled') {
                            await ipcRenderer.invoke('plugins:disable', id);
                        } else {
                            await ipcRenderer.invoke('plugins:enable', id);
                        }
                        await this.load(); // Refresh
                    } catch (err) {
                        console.error('[PluginPanel] Toggle failed:', err);
                    }
                });
            });
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new PluginPanel());
    } else {
        new PluginPanel();
    }
})();
