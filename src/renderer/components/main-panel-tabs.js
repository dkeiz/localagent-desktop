(function () {
    function getMessagesContainer() {
        return document.getElementById('messages-container');
    }

    function getAgentChatPanel() {
        let panel = document.getElementById('agent-chat-ui-panel');
        if (panel) return panel;

        const messages = getMessagesContainer();
        if (!messages?.parentElement) return null;

        panel = document.createElement('div');
        panel.id = 'agent-chat-ui-panel';
        panel.className = 'agent-chat-ui-panel';
        panel.hidden = true;
        messages.parentElement.insertBefore(panel, messages);
        return panel;
    }

    function updateAgentPanelStyle(css = '') {
        let styleEl = document.getElementById('agent-chat-ui-plugin-style');
        if (!css) {
            if (styleEl) styleEl.remove();
            return;
        }
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'agent-chat-ui-plugin-style';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;
    }

    function hydrateAgentCharts(root) {
        if (window.agentChartRenderer?.hydrate) {
            window.agentChartRenderer.hydrate(root);
        }
    }

    function activateAgentPanelTab(root, tabName) {
        root.querySelectorAll('[data-agent-ui-tab]').forEach(button => {
            button.classList.toggle('active', button.dataset.agentUiTab === tabName);
        });
        root.querySelectorAll('[data-agent-ui-section]').forEach(section => {
            section.hidden = section.dataset.agentUiSection !== tabName;
        });
    }

    function readActionPayload(element) {
        const payload = {};
        const rawPayload = element.dataset.agentUiPayload || element.dataset.pluginPayload || '';
        if (rawPayload) {
            try {
                Object.assign(payload, JSON.parse(rawPayload));
            } catch (error) {
                payload.rawPayload = rawPayload;
            }
        }

        for (const [key, value] of Object.entries(element.dataset || {})) {
            if (['agentUiAction', 'pluginAction', 'agentUiPayload', 'pluginPayload', 'agentUiBound', 'agentUiTabBound'].includes(key)) {
                continue;
            }
            payload[key] = value;
        }

        const pluginRoot = element.closest('[data-agent-ui-plugin-id]');
        if (pluginRoot?.dataset.agentUiPluginId) {
            payload.pluginId = pluginRoot.dataset.agentUiPluginId;
        }
        return payload;
    }

    function applyAgentActionResult(root, result, fallbackPluginId = '') {
        if (!result || result.success === false) {
            if (result?.error) console.warn('Agent UI action failed:', result.error);
            return;
        }
        if (result.css !== undefined) {
            updateAgentPanelStyle(result.css);
        }
        const pluginId = result.pluginId || fallbackPluginId;

        if (result.replaceHtml) {
            const replacements = Array.isArray(result.replaceHtml) ? result.replaceHtml : [result.replaceHtml];
            replacements.forEach(item => {
                const target = root.querySelector(item.selector);
                if (target) target.innerHTML = item.html || '';
            });
        }
        if (result.text) {
            const updates = Array.isArray(result.text) ? result.text : [result.text];
            updates.forEach(item => {
                const target = root.querySelector(item.selector);
                if (target) {
                    target.hidden = item.hidden === undefined ? false : Boolean(item.hidden);
                    target.textContent = item.text || '';
                }
            });
        }
        if (result.show) {
            root.querySelectorAll(result.show).forEach(target => { target.hidden = false; });
        }
        if (result.hide) {
            root.querySelectorAll(result.hide).forEach(target => { target.hidden = true; });
        }
        if (result.html !== undefined) {
            const wrapper = pluginId
                ? root.querySelector(`[data-agent-ui-plugin-id="${pluginId}"]`)
                : null;
            if (wrapper) wrapper.innerHTML = result.html;
            else root.innerHTML = result.html;
        }
        hydrateAgentCharts(root);
    }

    async function sendAgentUiEvent(panel, sessionId, eventName) {
        const tab = panel.chatTabs.get(sessionId);
        if (!tab?.agentId || !window.electronAPI?.agents?.chatUIEvent) return;
        try {
            await window.electronAPI.agents.chatUIEvent(tab.agentId, eventName, { sessionId });
        } catch (error) {
            console.warn(`Agent UI ${eventName} event failed:`, error);
        }
    }

    function bindAgentPanelActions(panel, root, agentId) {
        root.querySelectorAll('[data-agent-ui-tab]').forEach(button => {
            if (button.dataset.agentUiTabBound === 'true') return;
            button.dataset.agentUiTabBound = 'true';
            button.addEventListener('click', () => activateAgentPanelTab(root, button.dataset.agentUiTab));
        });

        root.querySelectorAll('[data-agent-ui-action], [data-plugin-action]').forEach(element => {
            if (element.dataset.agentUiBound === 'true') return;
            element.dataset.agentUiBound = 'true';
            const runAction = async (event) => {
                event.preventDefault();
                const action = element.dataset.agentUiAction || element.dataset.pluginAction;
                const payload = readActionPayload(element);
                const pluginId = payload.pluginId || '';
                try {
                    const result = await window.electronAPI.agents.runChatUIAction(agentId, action, payload);
                    applyAgentActionResult(root, result, pluginId);
                    bindAgentPanelActions(panel, root, agentId);
                    if (result?.refresh === true) {
                        await renderAgentPanel(panel, panel.activeTabId);
                    }
                } catch (error) {
                    console.warn(`Agent UI action "${action}" failed:`, error);
                }
            };
            element.addEventListener(element.tagName === 'FORM' ? 'submit' : 'click', runAction);
        });
    }

    async function renderAgentPanel(panel, sessionId) {
        const root = getAgentChatPanel();
        if (!root) return;

        const tab = panel.chatTabs.get(sessionId);
        if (!tab?.agentId) {
            root.hidden = true;
            root.innerHTML = '';
            updateAgentPanelStyle('');
            return;
        }

        try {
            const ui = await window.electronAPI.agents.getChatUI(tab.agentId);
            if (!ui?.html) {
                root.hidden = true;
                root.innerHTML = '';
                updateAgentPanelStyle('');
                return;
            }
            root.innerHTML = ui.html;
            root.hidden = false;
            updateAgentPanelStyle(ui.css || '');
            hydrateAgentCharts(root);
            bindAgentPanelActions(panel, root, tab.agentId);
            await sendAgentUiEvent(panel, sessionId, 'activated');
        } catch (error) {
            console.warn('Failed to render agent chat UI:', error);
            root.hidden = true;
            root.innerHTML = '';
            updateAgentPanelStyle('');
        }
    }

    async function resolveAgentType(tab) {
        if (!tab?.agentId) {
            return null;
        }
        if (tab.agentType) {
            return tab.agentType;
        }
        try {
            const agent = await window.electronAPI.agents.get(tab.agentId);
            return agent?.type || null;
        } catch (error) {
            console.warn('Failed to resolve agent type during tab close:', error);
            return null;
        }
    }

    async function maybeDeactivateAgentAfterTabClose(panel, closingSessionId, closingTab) {
        const agentId = closingTab?.agentId;
        if (!agentId) {
            return;
        }
        const isSubtaskSession = String(closingSessionId).startsWith('subtask-');
        if (isSubtaskSession) {
            return;
        }

        const agentType = await resolveAgentType(closingTab);
        if (agentType !== 'pro') {
            return;
        }

        const hasAnotherTabForSameAgent = [...panel.chatTabs.entries()]
            .some(([sessionId, tab]) =>
                sessionId !== closingSessionId
                && Number(tab?.agentId) === Number(agentId)
                && !String(sessionId).startsWith('subtask-')
            );
        if (hasAnotherTabForSameAgent) {
            return;
        }

        try {
            await window.electronAPI.agents.deactivate(agentId);
        } catch (error) {
            console.warn(`Failed to auto-deactivate agent ${agentId}:`, error);
        }
    }

    function getClearedTabTitle(tab, sessionId) {
        const isAgentTab = Boolean(tab?.agentId) || String(sessionId).startsWith('subtask-');
        return isAgentTab ? (tab.title || 'Agent Chat') : 'New Chat';
    }

    function resetTabState(tab, sessionId) {
        tab.title = getClearedTabTitle(tab, sessionId);
        tab.messagesHTML = '';
        tab.isSending = false;
        tab.loadingId = null;
        tab.scrollTop = 0;
        tab.followOutput = true;
        tab.subagentRunning = false;
        tab.subagentPulse = false;
    }

    async function clearTab(panel, sessionId) {
        if (!sessionId || !panel.chatTabs.has(sessionId)) {
            return;
        }

        try {
            const oldTab = panel.chatTabs.get(sessionId);
            const isAgentTab = Boolean(oldTab?.agentId) || String(sessionId).startsWith('subtask-');

            // For agent/subagent tabs: wipe messages in-place (no new session)
            if (isAgentTab) {
                await window.electronAPI.clearChatSession(sessionId);
                if (oldTab) {
                    resetTabState(oldTab, sessionId);
                }
                if (sessionId === panel.activeTabId) {
                    const container = getMessagesContainer();
                    if (container) container.innerHTML = '';
                    await renderAgentPanel(panel, sessionId);
                    panel.updateContextUsage(null);
                }
                renderTabs(panel);
                saveOpenTabIds(panel);
                if (window.sidebar) window.sidebar.loadChatSessions();
                return;
            }

            // For regular chat tabs: preserve old session in history, create fresh one
            const newSession = await window.electronAPI.invoke('create-chat-session');
            const newSessionId = newSession.id;

            // Remove old tab entry, keep old session untouched in DB (visible in Recent Chats)
            panel.chatTabs.delete(sessionId);

            // Create tab for new session
            panel.chatTabs.set(newSessionId, {
                title: 'New Chat',
                messagesHTML: '',
                isSending: false,
                loadingId: null,
                scrollTop: 0,
                followOutput: true
            });

            // Switch to new tab if the cleared tab was active
            if (sessionId === panel.activeTabId) {
                panel.activeTabId = newSessionId;
                const container = getMessagesContainer();
                if (container) container.innerHTML = '';
                await renderAgentPanel(panel, newSessionId);
                panel.updateContextUsage(null);
                await window.electronAPI.switchChatSession(newSessionId);
            }

            renderTabs(panel);
            saveOpenTabIds(panel);

            if (window.sidebar) {
                window.sidebar.loadChatSessions();
            }
        } catch (error) {
            console.error('Error clearing chat:', error);
        }
    }

    async function clearCurrentChat(panel) {
        return clearTab(panel, panel.activeTabId);
    }

    async function newChat(panel) {
        try {
            const session = await window.electronAPI.invoke('create-chat-session');
            const sessionId = session.id;

            saveCurrentTabMessages(panel);

            panel.chatTabs.set(sessionId, {
                title: `Chat ${panel.chatTabs.size + 1}`,
                messagesHTML: '',
                isSending: false,
                loadingId: null,
                scrollTop: 0,
                followOutput: true
            });

            panel.activeTabId = sessionId;
            const container = getMessagesContainer();
            if (container) {
                container.innerHTML = '';
            }
            await renderAgentPanel(panel, sessionId);

            renderTabs(panel);
            saveOpenTabIds(panel);

            if (window.sidebar) {
                window.sidebar.loadChatSessions();
            }
        } catch (error) {
            console.error('Error starting new chat:', error);
        }
    }

    async function openAgentChat(panel, agentId, sessionId, agent) {
        try {
            if (panel.chatTabs.has(sessionId)) {
                await switchTab(panel, sessionId);
                return;
            }

            saveCurrentTabMessages(panel);

            panel.chatTabs.set(sessionId, {
                title: agent ? agent.name : `Agent ${agentId}`,
                agentId,
                agentType: agent?.type || null,
                agentIcon: agent ? agent.icon : '🤖',
                messagesHTML: '',
                isSending: false,
                loadingId: null,
                scrollTop: 0,
                followOutput: true
            });

            panel.activeTabId = sessionId;

            await loadTabConversations(panel, sessionId);
            await renderAgentPanel(panel, sessionId);
            renderTabs(panel);
            saveOpenTabIds(panel);

            await window.electronAPI.switchChatSession(sessionId);
            await panel.calculateContextUsage();
        } catch (error) {
            console.error('Error opening agent chat:', error);
        }
    }

    async function ensureSubagentChat(panel, eventPayload, { activate = false } = {}) {
        const sessionId = eventPayload?.childSessionId || eventPayload?.child_session_id;
        if (!sessionId) return;

        const agentId = eventPayload?.subagentId || eventPayload?.subagent_id || null;
        const agentName = eventPayload?.agentName || eventPayload?.agent_name || `Subagent ${agentId || ''}`.trim();

        if (!panel.chatTabs.has(sessionId)) {
            saveCurrentTabMessages(panel);
            panel.chatTabs.set(sessionId, {
                title: agentName,
                agentId,
                agentType: 'sub',
                agentIcon: '🛰️',
                messagesHTML: '',
                isSending: false,
                loadingId: null,
                scrollTop: 0,
                followOutput: true,
                subagentRunning: true,
                subagentPulse: true
            });
        }

        const tab = panel.chatTabs.get(sessionId);
        if (!tab) return;

        tab.subagentRunning = true;
        tab.subagentPulse = true;
        tab.agentId = tab.agentId || agentId;
        tab.title = tab.title || agentName;

        if (activate) {
            await switchTab(panel, sessionId);
            await loadTabConversations(panel, sessionId);
        } else {
            renderTabs(panel);
            saveOpenTabIds(panel);
        }
    }

    async function updateSubagentChatState(panel, eventPayload) {
        const sessionId = eventPayload?.childSessionId || eventPayload?.child_session_id;
        if (!sessionId || !panel.chatTabs.has(sessionId)) {
            return;
        }

        const tab = panel.chatTabs.get(sessionId);
        const eventType = eventPayload.__eventType || '';
        if (eventType === 'subagent:completed' || eventType === 'subagent:failed') {
            tab.subagentRunning = false;
            tab.subagentPulse = true;
            setTimeout(() => {
                const t = panel.chatTabs.get(sessionId);
                if (!t) return;
                t.subagentPulse = false;
                renderTabs(panel);
            }, 1400);
        }

        if (panel.activeTabId === sessionId) {
            await loadTabConversations(panel, sessionId);
        } else {
            renderTabs(panel);
        }
    }

    function openNewWindow() {
        window.electronAPI.invoke('open-new-window').catch(error => {
            console.error('Failed to open new window:', error);
        });
    }

    async function restoreOpenTabs(panel) {
        try {
            const settings = await window.electronAPI.getSettings();
            const openTabsRaw = settings?.open_chat_tabs;
            const activeRaw = settings?.active_chat_tab;
            let tabIds = [];

            if (openTabsRaw) {
                try {
                    tabIds = JSON.parse(openTabsRaw);
                } catch (error) {
                    tabIds = [];
                }
            }

            if (tabIds.length === 0) {
                const sessions = await window.electronAPI.getChatSessions(null, 1);
                if (sessions && sessions.length > 0) {
                    tabIds = [sessions[0].id];
                } else {
                    const session = await window.electronAPI.invoke('create-chat-session');
                    tabIds = [session.id];
                }
            }

            const regularTabIds = [];
            for (const sessionId of tabIds) {
                await window.electronAPI.loadChatSession(sessionId);
                regularTabIds.push(sessionId);
            }

            if (regularTabIds.length === 0) {
                const session = await window.electronAPI.invoke('create-chat-session');
                regularTabIds.push(session.id);
            }

            for (let index = 0; index < regularTabIds.length; index++) {
                const sessionId = regularTabIds[index];
                panel.chatTabs.set(sessionId, {
                    title: `Chat ${index + 1}`,
                    messagesHTML: '',
                    isSending: false,
                    loadingId: null,
                    scrollTop: 0,
                    followOutput: true
                });
            }

            const activeId = activeRaw ? parseInt(activeRaw) : null;
            panel.activeTabId = (activeId && panel.chatTabs.has(activeId)) ? activeId : regularTabIds[0];

            await loadTabConversations(panel, panel.activeTabId);
            await renderAgentPanel(panel, panel.activeTabId);
            await window.electronAPI.switchChatSession(panel.activeTabId);

            for (const sessionId of regularTabIds) {
                await autoTitleTab(panel, sessionId);
            }

            renderTabs(panel);
            saveOpenTabIds(panel);
        } catch (error) {
            console.error('Error restoring tabs:', error);
            await newChat(panel);
        }
    }

    async function autoTitleTab(panel, sessionId) {
        try {
            const conversations = await window.electronAPI.loadChatSession(sessionId);
            const firstUserMessage = conversations.find(conversation => conversation.role === 'user');
            if (!firstUserMessage) {
                return;
            }

            const title = firstUserMessage.content.substring(0, 30)
                + (firstUserMessage.content.length > 30 ? '…' : '');
            const tab = panel.chatTabs.get(sessionId);
            if (tab) {
                tab.title = title;
            }
        } catch (error) {
            console.error('Error auto-titling tab:', error);
        }
    }

    function saveCurrentTabMessages(panel) {
        if (!panel.activeTabId || !panel.chatTabs.has(panel.activeTabId)) {
            return;
        }

        const container = getMessagesContainer();
        if (container) {
            panel.chatTabs.get(panel.activeTabId).messagesHTML = container.innerHTML;
            panel.chatTabs.get(panel.activeTabId).scrollTop = container.scrollTop;
            panel.chatTabs.get(panel.activeTabId).followOutput = panel._isNearBottom(container);
        }
    }

    async function switchTab(panel, sessionId) {
        if (sessionId === panel.activeTabId || !panel.chatTabs.has(sessionId)) {
            return;
        }

        const previousTabId = panel.activeTabId;
        await sendAgentUiEvent(panel, previousTabId, 'deactivated');
        saveCurrentTabMessages(panel);
        panel.activeTabId = sessionId;

        const tab = panel.chatTabs.get(sessionId);
        const container = getMessagesContainer();
        if (!container) {
            return;
        }

        if (tab.messagesHTML) {
            container.innerHTML = tab.messagesHTML;
        } else {
            await loadTabConversations(panel, sessionId);
        }
        await renderAgentPanel(panel, sessionId);

        if (tab.followOutput === false && typeof tab.scrollTop === 'number') {
            container.scrollTop = tab.scrollTop;
        } else {
            container.scrollTop = container.scrollHeight;
        }
        renderTabs(panel);

        await window.electronAPI.saveSetting('active_chat_tab', sessionId.toString());
        await window.electronAPI.switchChatSession(sessionId);
        await panel.calculateContextUsage();
    }

    async function loadTabConversations(panel, sessionId) {
        try {
            const conversations = await window.electronAPI.loadChatSession(sessionId);
            const container = getMessagesContainer();
            if (!container) {
                return;
            }

            panel._suspendMessageAutoscroll = true;
            container.innerHTML = '';
            conversations.forEach(conversation => {
                panel.addMessage(conversation.role, conversation.content);
            });
            const tab = panel.chatTabs.get(sessionId);
            if (tab && tab.followOutput === false && typeof tab.scrollTop === 'number') {
                container.scrollTop = tab.scrollTop;
            } else {
                container.scrollTop = container.scrollHeight;
            }
        } catch (error) {
            console.error('Error loading tab conversations:', error);
        } finally {
            panel._suspendMessageAutoscroll = false;
            panel._storeActiveTabScrollState();
        }
    }

    async function closeTab(panel, sessionId) {
        if (panel.chatTabs.size <= 1) {
            return;
        }

        const closingTab = panel.chatTabs.get(sessionId);
        if (sessionId === panel.activeTabId) {
            await sendAgentUiEvent(panel, sessionId, 'deactivated');
        }
        await maybeDeactivateAgentAfterTabClose(panel, sessionId, closingTab);
        panel.chatTabs.delete(sessionId);

        if (sessionId === panel.activeTabId) {
            const remaining = [...panel.chatTabs.keys()];
            await switchTab(panel, remaining[remaining.length - 1]);
        }

        renderTabs(panel);
        saveOpenTabIds(panel);
    }

    function renderTabs(panel) {
        const list = document.getElementById('chat-tabs-list');
        if (!list) {
            return;
        }

        list.innerHTML = '';

        for (const [sessionId, tab] of panel.chatTabs) {
            const tabEl = document.createElement('div');
            tabEl.className = `chat-tab${sessionId === panel.activeTabId ? ' active' : ''}${tab.subagentPulse ? ' subagent-pulse' : ''}`;
            tabEl.dataset.sessionId = sessionId;

            const clearBtn = document.createElement('button');
            clearBtn.className = 'chat-tab-reset';
            clearBtn.type = 'button';
            clearBtn.title = 'Clear Chat';
            clearBtn.textContent = '🖌';
            clearBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                clearTab(panel, sessionId);
            });

            const statusDot = document.createElement('span');
            const isSubagent = String(sessionId).startsWith('subtask-');
            statusDot.className = `chat-tab-status${tab.isSending || tab.subagentRunning ? ' thinking' : ''}${isSubagent && !tab.subagentRunning ? ' subagent-done' : ''}`;

            const label = document.createElement('span');
            label.className = 'chat-tab-label';
            const agentPrefix = tab.agentIcon ? `${tab.agentIcon} ` : '';
            label.textContent = agentPrefix + (tab.title || `Chat ${sessionId}`);

            tabEl.appendChild(clearBtn);
            tabEl.appendChild(statusDot);
            tabEl.appendChild(label);

            if (panel.chatTabs.size > 1) {
                const closeBtn = document.createElement('button');
                closeBtn.className = 'chat-tab-close';
                closeBtn.type = 'button';
                closeBtn.title = 'Close Tab';
                closeBtn.textContent = '×';
                closeBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    closeTab(panel, sessionId);
                });
                tabEl.appendChild(closeBtn);
            }

            tabEl.addEventListener('click', () => switchTab(panel, sessionId));
            list.appendChild(tabEl);
        }
    }

    async function saveOpenTabIds(panel) {
        const ids = [...panel.chatTabs.keys()];
        try {
            await window.electronAPI.saveSetting('open_chat_tabs', JSON.stringify(ids));
            if (panel.activeTabId) {
                await window.electronAPI.saveSetting('active_chat_tab', panel.activeTabId.toString());
            }
        } catch (error) {
            console.error('Error saving open tabs:', error);
        }
    }

    window.mainPanelTabs = {
        autoTitleTab,
        clearTab,
        clearCurrentChat,
        closeTab,
        ensureSubagentChat,
        loadTabConversations,
        newChat,
        openAgentChat,
        openNewWindow,
        renderTabs,
        restoreOpenTabs,
        saveCurrentTabMessages,
        saveOpenTabIds,
        switchTab,
        updateSubagentChatState
    };
})();
