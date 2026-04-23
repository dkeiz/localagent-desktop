(function () {
    function getTab(panel, sessionId) {
        if (!panel || !sessionId) return null;
        return panel.chatTabs?.get?.(sessionId) || null;
    }

    function markInterrupted(tab, type, reason) {
        if (!tab) return;
        tab.interruptionState = {
            type,
            reason: String(reason || '').trim() || 'Interrupted',
            at: new Date().toISOString()
        };
    }

    function clearInterrupted(tab) {
        if (!tab) return;
        tab.interruptionState = null;
    }

    function install() {
        if (!window.mainPanel || !window.electronAPI || window.__chatContinuityInstalled) {
            return;
        }
        window.__chatContinuityInstalled = true;
        const panel = window.mainPanel;

        const originalSendMessage = window.electronAPI.sendMessage;
        window.electronAPI.sendMessage = async (message, sessionId) => {
            const tab = getTab(panel, sessionId);
            if (tab && String(message || '').trim()) {
                tab.hasChanges = true;
            }
            try {
                const response = await originalSendMessage(message, sessionId);
                if (tab) {
                    if (response?.stopped) {
                        markInterrupted(tab, 'manual_stop', 'Generation was stopped');
                    } else if (response?.chainExhausted) {
                        markInterrupted(tab, 'chain_exhausted', 'Chain exhausted before completion');
                    } else {
                        clearInterrupted(tab);
                    }
                }
                return response;
            } catch (error) {
                const tab = getTab(panel, sessionId);
                markInterrupted(tab, 'error', error?.message || 'Generation failed');
                throw error;
            }
        };

        window.electronAPI.onConversationUpdate((event, data) => {
            const sessionId = data?.sessionId;
            if (!sessionId) return;
            const tab = getTab(panel, sessionId);
            if (!tab) return;
            tab.hasChanges = true;
            if (sessionId === panel.activeTabId) return;
            tab.needsReload = true;
            tab.hasUnread = true;
            panel.renderTabs?.();
        });

        const stopBtn = document.getElementById('stop-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                const tab = getTab(panel, panel.activeTabId);
                markInterrupted(tab, 'manual_stop', 'Stopped by user');
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const maxAttempts = 80;
        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;
            if (window.mainPanel) {
                clearInterval(timer);
                install();
                return;
            }
            if (attempts >= maxAttempts) {
                clearInterval(timer);
            }
        }, 100);
    });
})();
