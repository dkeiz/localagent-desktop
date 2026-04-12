(function () {
    class PluginStudioPanel {
        constructor() {
            this.overlay = document.getElementById('plugin-studio-overlay');
            this.panel = document.getElementById('plugin-studio-panel');
            this.list = document.getElementById('plugin-studio-list');
            this.empty = document.getElementById('plugin-studio-empty');
            this.content = document.getElementById('plugin-studio-content');
            this.title = document.getElementById('plugin-studio-title');
            this.meta = document.getElementById('plugin-studio-meta');
            this.toggleBtn = document.getElementById('plugin-studio-toggle');
            this.discoverBtn = document.getElementById('plugin-studio-discover');
            this.saveBtn = document.getElementById('plugin-studio-save');
            this.form = document.getElementById('plugin-studio-form');
            this.result = document.getElementById('plugin-studio-result');

            this.plugins = [];
            this.selectedPluginId = null;
            this.selectedDetail = null;

            if (!this.overlay || !this.panel) return;
            this._bindEvents();
        }

        _bindEvents() {
            this.overlay.addEventListener('mousedown', (event) => {
                if (event.target === this.overlay) this.hide();
            });

            this.panel.addEventListener('mousedown', (event) => event.stopPropagation());
            this.toggleBtn.addEventListener('click', () => this.toggleSelected());
            this.saveBtn.addEventListener('click', () => this.saveConfig());
            this.discoverBtn.addEventListener('click', () => this.runDiscover());

            window.electronAPI.on('plugins:open-studio', async (event, options) => {
                await this.show(options || {});
            });

            window.electronAPI.on('plugins:state-changed', async () => {
                if (this.overlay.classList.contains('hidden')) return;
                const focused = this.selectedPluginId;
                await this.loadPlugins(focused);
            });
        }

        setActionBusy(button, busy) {
            if (!button) return;
            button.disabled = !!busy;
            button.classList.toggle('is-busy', !!busy);
            if (busy) {
                button.dataset.originalText = button.textContent;
                button.textContent = 'Working...';
            } else if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
            }
        }

        setResult(payload) {
            this.result.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
        }

        hide() {
            this.overlay.classList.add('hidden');
        }

        async show(options = {}) {
            this.overlay.classList.remove('hidden');
            await this.loadPlugins(options.focusPluginId || null);
        }

        getSelectedPlugin() {
            return this.plugins.find((plugin) => plugin.id === this.selectedPluginId) || null;
        }

        async loadPlugins(focusPluginId = null) {
            this.plugins = await window.electronAPI.plugins.list();
            if (focusPluginId) this.selectedPluginId = focusPluginId;
            if (!this.selectedPluginId && this.plugins.length) this.selectedPluginId = this.plugins[0].id;
            if (this.selectedPluginId && !this.getSelectedPlugin() && this.plugins.length) {
                this.selectedPluginId = this.plugins[0].id;
            }
            this.renderList();
            await this.loadSelectedDetail();
        }

        renderList() {
            this.list.replaceChildren();
            if (!this.plugins.length) {
                const empty = document.createElement('div');
                empty.className = 'plugin-studio-item';
                empty.textContent = 'No plugins found';
                this.list.appendChild(empty);
                return;
            }

            this.plugins.forEach((plugin) => {
                const item = document.createElement('div');
                item.className = `plugin-studio-item${plugin.id === this.selectedPluginId ? ' active' : ''}`;
                item.addEventListener('click', async () => {
                    this.selectedPluginId = plugin.id;
                    this.renderList();
                    await this.loadSelectedDetail();
                });

                const title = document.createElement('div');
                title.className = 'plugin-studio-item-title';
                title.textContent = plugin.name;

                const sub = document.createElement('div');
                sub.className = 'plugin-studio-item-sub';
                sub.textContent = `${plugin.id} · ${plugin.status}`;

                item.appendChild(title);
                item.appendChild(sub);
                this.list.appendChild(item);
            });
        }

        async loadSelectedDetail() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) {
                this.empty.classList.remove('hidden');
                this.content.classList.add('hidden');
                this.selectedDetail = null;
                return;
            }

            this.selectedDetail = await window.electronAPI.plugins.inspect(plugin.id);
            this.empty.classList.add('hidden');
            this.content.classList.remove('hidden');

            this.title.textContent = this.selectedDetail?.manifest?.name || plugin.name;
            this.meta.textContent = `${plugin.id} · v${this.selectedDetail?.manifest?.version || '0.0.0'} · ${plugin.status}`;
            this.toggleBtn.textContent = plugin.status === 'enabled' ? 'Disable' : 'Enable';

            this.renderForm();
        }

        renderForm() {
            this.form.replaceChildren();
            const schema = this.selectedDetail?.manifest?.configSchema || {};
            const entries = Object.entries(schema);
            if (!entries.length) {
                const none = document.createElement('div');
                none.textContent = 'No configurable fields.';
                this.form.appendChild(none);
                return;
            }

            entries.forEach(([key, def]) => {
                const field = document.createElement('div');
                field.className = 'plugin-studio-field';

                const label = document.createElement('label');
                label.textContent = def?.description ? `${key} - ${def.description}` : key;

                const input = document.createElement('input');
                input.dataset.key = key;
                input.dataset.type = def?.type || 'string';
                const raw = this.selectedDetail?.config?.[key];
                if (def?.type === 'number') input.type = 'number';
                else if (def?.type === 'boolean') input.type = 'checkbox';
                else input.type = 'text';

                if (input.type === 'checkbox') {
                    input.checked = String(raw).toLowerCase() === 'true';
                } else {
                    input.value = raw == null ? '' : String(raw);
                }

                field.appendChild(label);
                field.appendChild(input);
                this.form.appendChild(field);
            });
        }

        async toggleSelected() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) return;
            this.setActionBusy(this.toggleBtn, true);
            try {
                const result = plugin.status === 'enabled'
                    ? await window.electronAPI.plugins.disable(plugin.id)
                    : await window.electronAPI.plugins.enable(plugin.id);
                if (!result?.success) {
                    this.setResult(result?.error || 'Toggle failed');
                    return;
                }
                await this.loadPlugins(plugin.id);
                this.setResult({ success: true, pluginId: plugin.id });
            } finally {
                this.setActionBusy(this.toggleBtn, false);
            }
        }

        parseInputValue(input) {
            const type = input.dataset.type || 'string';
            if (type === 'number') return Number(input.value || 0);
            if (type === 'boolean') return Boolean(input.checked);
            return input.value;
        }

        async saveConfig() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) return;
            const inputs = Array.from(this.form.querySelectorAll('input[data-key]'));
            this.setActionBusy(this.saveBtn, true);

            try {
                for (const input of inputs) {
                    const key = input.dataset.key;
                    const value = this.parseInputValue(input);
                    const result = await window.electronAPI.plugins.setConfig(plugin.id, key, value);
                    if (!result?.success) {
                        this.setResult(result?.error || `Failed to save ${key}`);
                        return;
                    }
                }

                await this.loadSelectedDetail();
                this.setResult({ success: true, saved: true, pluginId: plugin.id });
            } finally {
                this.setActionBusy(this.saveBtn, false);
            }
        }

        async runDiscover() {
            const plugin = this.getSelectedPlugin();
            if (!plugin) return;
            this.setActionBusy(this.discoverBtn, true);
            try {
                const result = await window.electronAPI.plugins.runAction(plugin.id, 'discover', {});
                this.setResult(result);
                await this.loadSelectedDetail();
            } finally {
                this.setActionBusy(this.discoverBtn, false);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new PluginStudioPanel());
    } else {
        new PluginStudioPanel();
    }
})();
