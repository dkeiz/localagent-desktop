/**
 * CapabilityPanel - UI Controller for Nested Toggle System
 * 
 * Manages:
 * - Main Pad (master toggle)
 * - 6 Group Pads (unsafe, web, files, terminal, ports, visual)
 * - Files 3-mode switching (off/read/full)
 * - Sync with backend CapabilityManager
 */
class CapabilityPanel {
    constructor() {
        this.mainPad = document.getElementById('capability-main-toggle');
        this.groupsContainer = document.getElementById('capability-groups');
        this.toolCountEl = document.getElementById('active-tool-count');
        this.safeInfoEl = document.getElementById('safe-tools-info');
        this.contextBadgeEl = null;
        this.activeContext = { sessionId: null, agentId: null };

        this.state = {
            mainEnabled: true,
            groups: {}
        };

        this.init();
    }

    async init() {
        this.ensureContextBadge();
        // Load initial state from backend
        await this.loadState();
        await this.refreshContextView();

        // Setup event listeners
        this.setupMainPadToggle();
        this.setupGroupToggles();

        // Listen for capability updates from backend
        if (window.electronAPI?.onCapabilityUpdate) {
            window.electronAPI.onCapabilityUpdate((event, newState) => {
                this.updateUI(newState);
            });
        }

        document.addEventListener('chat-tab-switched', async (event) => {
            this.activeContext = {
                sessionId: event?.detail?.sessionId ?? null,
                agentId: event?.detail?.agentId ?? null
            };
            await this.refreshContextView();
        });
    }

    ensureContextBadge() {
        if (this.contextBadgeEl) return;
        if (!this.mainPad || !this.mainPad.parentElement) return;
        const badge = document.createElement('div');
        badge.id = 'capability-context-badge';
        badge.style.cssText = 'margin:0.25rem 0 0.15rem 0.2rem;font-size:0.72rem;opacity:0.85;';
        this.mainPad.parentElement.insertBefore(badge, this.mainPad.nextSibling);
        this.contextBadgeEl = badge;
    }

    resolveUiContext() {
        const panel = window.mainPanel || window.app?.mainPanel || null;
        const sessionId = panel?.activeTabId ?? this.activeContext.sessionId ?? null;
        const tab = panel?.chatTabs?.get?.(sessionId);
        const agentId = tab?.agentId ?? this.activeContext.agentId ?? null;
        return { sessionId, agentId };
    }

    async refreshContextView() {
        const context = this.resolveUiContext();
        this.activeContext = context;
        if (this.contextBadgeEl && window.electronAPI?.permissions?.getContext) {
            try {
                const resolved = await window.electronAPI.permissions.getContext(context);
                const scope = resolved?.scope === 'agent' ? `Agent #${resolved.agentId}` : 'Global';
                this.contextBadgeEl.textContent = `Resolved Context: ${scope}`;
            } catch (error) {
                this.contextBadgeEl.textContent = 'Resolved Context: Global';
            }
        }
        await this.updateToolCount();
    }

    async loadState() {
        try {
            const state = await window.electronAPI?.capability?.getState?.();
            if (state && !state.error) {
                this.state = state;
                this.updateUI(state);
            }
        } catch (error) {
            console.error('Failed to load capability state:', error);
        }
    }

    setupMainPadToggle() {
        if (!this.mainPad) return;

        this.mainPad.addEventListener('click', async (event) => {
            const clickedToggle = Boolean(event.target.closest('.main-toggle-indicator'));
            if (!clickedToggle) {
                const mcpNavButton = document.querySelector('.nav-btn[data-tab="mcp"]');
                if (mcpNavButton) {
                    mcpNavButton.click();
                } else if (window.sidebar?.switchTab) {
                    window.sidebar.switchTab('mcp');
                }
                return;
            }

            const newState = !this.state.mainEnabled;
            try {
                await window.electronAPI?.capability?.setMain?.(newState);
                this.state.mainEnabled = newState;
                this.updateMainPad();
            } catch (error) {
                console.error('Failed to toggle main switch:', error);
            }
        });
    }

    setupGroupToggles() {
        const groupPads = document.querySelectorAll('.capability-group-pad');

        groupPads.forEach(pad => {
            const groupId = pad.dataset.group;

            pad.addEventListener('click', async (e) => {
                // Special handling for Files group (3-mode cycle)
                if (groupId === 'files') {
                    await this.cycleFilesMode(pad);
                    return;
                }

                // Special handling for Ports (show config dialog)
                if (groupId === 'ports') {
                    // For now, just toggle. Later: show config modal
                    const newState = !pad.classList.contains('active');
                    try {
                        await window.electronAPI?.capability?.setGroup?.(groupId, newState);
                        pad.classList.toggle('active', newState);
                        this.autoEnableMainIfNeeded();
                    } catch (error) {
                        console.error('Failed to toggle group:', error);
                    }
                    return;
                }

                // Standard toggle for other groups
                const newState = !pad.classList.contains('active');
                try {
                    await window.electronAPI?.capability?.setGroup?.(groupId, newState);
                    pad.classList.toggle('active', newState);
                    this.autoEnableMainIfNeeded();
                } catch (error) {
                    console.error('Failed to toggle group:', error);
                }
            });
        });
    }

    async cycleFilesMode(pad) {
        const currentMode = pad.dataset.mode || 'off';
        const modes = ['off', 'read', 'full'];
        const currentIndex = modes.indexOf(currentMode);
        const nextMode = modes[(currentIndex + 1) % 3];

        try {
            await window.electronAPI?.capability?.setFilesMode?.(nextMode);
            pad.dataset.mode = nextMode;
            pad.classList.toggle('active', nextMode !== 'off');
            this.updateFilesIndicator(pad, nextMode);
            this.autoEnableMainIfNeeded();
        } catch (error) {
            console.error('Failed to cycle files mode:', error);
        }
    }

    updateFilesIndicator(pad, mode) {
        const dots = pad.querySelectorAll('.mode-dot');
        dots.forEach((dot, index) => {
            if (mode === 'off') {
                dot.style.background = 'var(--border-color, #d1d5db)';
            } else if (mode === 'read') {
                dot.style.background = index < 2 ? '#f59e0b' : 'var(--border-color, #d1d5db)';
            } else if (mode === 'full') {
                dot.style.background = '#10b981';
            }
        });
    }

    autoEnableMainIfNeeded() {
        // If any group is active and main is off, enable main
        const anyActive = document.querySelector('.capability-group-pad.active');
        if (anyActive && !this.state.mainEnabled) {
            this.state.mainEnabled = true;
            this.updateMainPad();
            window.electronAPI?.capability?.setMain?.(true);
        }
    }

    updateMainPad() {
        if (!this.mainPad) return;

        this.mainPad.classList.toggle('active', this.state.mainEnabled);
        this.mainPad.classList.toggle('inactive', !this.state.mainEnabled);

        // Update safe tools info
        if (this.safeInfoEl) {
            this.safeInfoEl.classList.toggle('inactive', !this.state.mainEnabled);
        }

        // Update tool count
        this.updateToolCount();
    }

    async updateToolCount() {
        try {
            const activeTools = await window.electronAPI?.capability?.getActiveTools?.(this.resolveUiContext());
            if (this.toolCountEl && Array.isArray(activeTools)) {
                this.toolCountEl.textContent = `${activeTools.length} active`;
            }
        } catch (error) {
            console.error('Failed to get active tools count:', error);
        }
    }

    updateUI(state) {
        if (!state) return;

        this.state = state;

        // Update main pad
        this.updateMainPad();

        // Update group states
        if (state.groups) {
            Object.entries(state.groups).forEach(([groupId, value]) => {
                const pad = document.querySelector(`.capability-group-pad[data-group="${groupId}"]`);
                if (!pad) return;

                if (groupId === 'files') {
                    // Files uses mode string
                    const mode = typeof value === 'string' ? value : 'off';
                    pad.dataset.mode = mode;
                    pad.classList.toggle('active', mode !== 'off');
                    this.updateFilesIndicator(pad, mode);
                } else {
                    // Others use boolean
                    pad.classList.toggle('active', !!value);
                }
            });
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.capabilityPanel = new CapabilityPanel();
});
