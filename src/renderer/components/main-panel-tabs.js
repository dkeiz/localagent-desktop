(function () {
    function getMessagesContainer() {
        return document.getElementById('messages-container');
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
            await window.electronAPI.clearChatSession(sessionId);

            const tab = panel.chatTabs.get(sessionId);
            if (tab) {
                resetTabState(tab, sessionId);
            }

            if (sessionId === panel.activeTabId) {
                const container = getMessagesContainer();
                if (container) {
                    container.innerHTML = '';
                }
                panel.updateContextUsage(null);
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
                agentIcon: agent ? agent.icon : '🤖',
                messagesHTML: '',
                isSending: false,
                loadingId: null,
                scrollTop: 0,
                followOutput: true
            });

            panel.activeTabId = sessionId;

            await loadTabConversations(panel, sessionId);
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
