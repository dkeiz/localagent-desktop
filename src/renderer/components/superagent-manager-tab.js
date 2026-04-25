(function () {
    async function renderSubagentManagerTab(panel, deps = {}) {
        const container = deps.getMessagesContainer ? deps.getMessagesContainer() : null;
        if (!container) return;

        const runs = window.electronAPI?.subagents?.listRuns
            ? await window.electronAPI.subagents.listRuns({ limit: 100 })
            : [];

        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'subagent-manager-tab';

        const title = document.createElement('h3');
        title.className = 'subagent-manager-title';
        title.textContent = 'Subagent Manager';
        root.appendChild(title);

        if (!runs.length) {
            const empty = document.createElement('div');
            empty.className = 'subagent-manager-empty';
            empty.textContent = 'No subagent runs yet.';
            root.appendChild(empty);
            container.appendChild(root);
            return;
        }

        const list = document.createElement('div');
        list.className = 'subagent-manager-list';
        runs.forEach((run) => {
            const item = document.createElement('div');
            item.className = 'subagent-manager-item';

            const agentName = String(run.agent_name || `Subagent ${run.subagent_id || ''}`.trim());
            const status = String(run.status || 'unknown');
            const normalizedStatus = status.toLowerCase();
            const taskText = String(run.task || '').trim() || 'No task';
            const statusClass = normalizedStatus.replace(/[^a-z0-9_-]/g, '-');

            item.innerHTML = `
                <div class="subagent-manager-item-head">
                    <strong>${agentName}</strong>
                    <span class="subagent-manager-status status-${statusClass}">${status}</span>
                </div>
                <div class="subagent-manager-item-meta">id: ${run.run_id} | parent: ${run.parent_session_id ?? 'none'} | sub: ${run.subagent_id ?? 'n/a'}</div>
                <div class="subagent-manager-item-task">${taskText}</div>
            `;

            const actions = document.createElement('div');
            actions.className = 'subagent-manager-item-actions';

            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'compact-btn';
            openBtn.textContent = 'Open Chat';
            openBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!deps.ensureSubagentChat) return;
                await deps.ensureSubagentChat(panel, {
                    runId: run.run_id,
                    childSessionId: run.child_session_id,
                    child_session_id: run.child_session_id,
                    subagentId: run.subagent_id,
                    subagent_id: run.subagent_id,
                    agentName,
                    agent_name: agentName,
                    parentSessionId: run.parent_session_id,
                    parent_session_id: run.parent_session_id,
                    subagentMode: run.subagent_mode || 'no_ui',
                    subagent_mode: run.subagent_mode || 'no_ui',
                    __eventType: status === 'queued' || status === 'running' ? 'subagent:started' : 'subagent:completed'
                }, { activate: true });
            });

            const stopBtn = document.createElement('button');
            stopBtn.type = 'button';
            stopBtn.className = 'compact-btn';
            stopBtn.textContent = 'Stop';
            const runStatus = normalizedStatus;
            const canStop = runStatus === 'queued' || runStatus === 'running' || runStatus === 'cancelling';
            stopBtn.disabled = !canStop;
            stopBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!canStop || !window.electronAPI?.subagents?.stopRun) return;
                const result = await window.electronAPI.subagents.stopRun(run.run_id);
                if (!result?.success && panel?.showNotification) {
                    panel.showNotification(result?.error || 'Failed to stop subagent run', 'error');
                }
                if (deps.refreshSubagentManagerTab) {
                    await deps.refreshSubagentManagerTab(panel);
                }
            });

            actions.appendChild(openBtn);
            actions.appendChild(stopBtn);
            item.appendChild(actions);
            list.appendChild(item);
        });

        root.appendChild(list);
        container.appendChild(root);
    }

    function getAgentConfigSummary(agent) {
        if (!agent || !agent.config) return '';
        const config = typeof agent.config === 'string'
            ? (() => {
                try { return JSON.parse(agent.config); } catch (error) { return null; }
            })()
            : agent.config;
        if (!config || typeof config !== 'object') return '';

        const provider = config.provider || config.llm_provider || config.model_provider || '';
        const model = config.model || config.llm_model || config.model_name || '';
        if (provider && model) return `${provider} / ${model}`;
        return provider || model || '';
    }

    function openAgentSettings(agentId) {
        const normalized = Number(agentId);
        if (!Number.isFinite(normalized)) return;
        document.dispatchEvent(new CustomEvent('open-agent-config', {
            detail: { agentId: normalized }
        }));
    }

    async function openSuperagentChat(panel, agent) {
        if (!window.electronAPI?.agents?.activate || !panel?.openAgentChat) return;
        const result = await window.electronAPI.agents.activate(agent.id);
        if (result && result.sessionId) {
            await panel.openAgentChat(agent.id, result.sessionId, result.agent || agent);
        }
    }

    async function renderSuperagentManagerTab(panel, deps = {}) {
        const container = deps.getMessagesContainer ? deps.getMessagesContainer() : null;
        if (!container) return;

        const agents = window.electronAPI?.agents?.list
            ? await window.electronAPI.agents.list('pro')
            : [];

        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'superagent-manager-tab';

        const title = document.createElement('h3');
        title.className = 'superagent-manager-title';
        title.textContent = 'Superagent Manager';
        root.appendChild(title);

        if (!agents.length) {
            const empty = document.createElement('div');
            empty.className = 'superagent-manager-empty';
            empty.textContent = 'No superagents configured.';
            root.appendChild(empty);
            container.appendChild(root);
            return;
        }

        const list = document.createElement('div');
        list.className = 'superagent-manager-list';
        agents.forEach((agent) => {
            const item = document.createElement('div');
            item.className = 'superagent-manager-item';

            const status = String(agent.status || 'idle');
            const normalizedStatus = status.toLowerCase();
            const statusClass = normalizedStatus.replace(/[^a-z0-9_-]/g, '-');
            const description = String(agent.description || '').trim() || 'No description';
            const configLine = getAgentConfigSummary(agent);

            item.innerHTML = `
                <div class="superagent-manager-item-head">
                    <strong>${agent.icon || '🤖'} ${agent.name || `Agent ${agent.id}`}</strong>
                    <span class="superagent-manager-status status-${statusClass}">${status}</span>
                </div>
                <div class="superagent-manager-item-meta">id: ${agent.id} | type: ${agent.type || 'pro'}${configLine ? ` | model: ${configLine}` : ''}</div>
                <div class="superagent-manager-item-task">${description}</div>
            `;

            const actions = document.createElement('div');
            actions.className = 'superagent-manager-item-actions';

            const openChatBtn = document.createElement('button');
            openChatBtn.type = 'button';
            openChatBtn.className = 'compact-btn';
            openChatBtn.textContent = 'Open Chat';
            openChatBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                await openSuperagentChat(panel, agent);
            });

            const settingsBtn = document.createElement('button');
            settingsBtn.type = 'button';
            settingsBtn.className = 'compact-btn';
            settingsBtn.textContent = 'Settings';
            settingsBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                openAgentSettings(agent.id);
            });

            const stopBtn = document.createElement('button');
            stopBtn.type = 'button';
            stopBtn.className = 'compact-btn';
            stopBtn.textContent = 'Stop';
            const canStop = normalizedStatus === 'active' || normalizedStatus === 'busy' || normalizedStatus === 'running';
            stopBtn.disabled = !canStop;
            stopBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!canStop || !window.electronAPI?.agents?.deactivate) return;
                const result = await window.electronAPI.agents.deactivate(agent.id);
                if (result?.success === false && panel?.showNotification) {
                    panel.showNotification(result?.error || 'Failed to stop superagent', 'error');
                }
                if (deps.refreshSuperagentManagerTab) {
                    await deps.refreshSuperagentManagerTab(panel);
                }
            });

            actions.appendChild(openChatBtn);
            actions.appendChild(settingsBtn);
            actions.appendChild(stopBtn);
            item.appendChild(actions);
            list.appendChild(item);
        });

        root.appendChild(list);
        container.appendChild(root);
    }

    async function openSuperagentManagerTab(panel, deps = {}) {
        const tabId = deps.tabId || 'superagent-manager';
        if (!panel.chatTabs.has(tabId)) {
            deps.saveCurrentTabMessages?.(panel);
            panel.chatTabs.set(tabId, deps.createTabState?.({
                title: 'Superagent Manager',
                agentIcon: '🧠',
                isSuperagentManager: true
            }) || {
                title: 'Superagent Manager',
                agentIcon: '🧠',
                isSuperagentManager: true
            });
        }
        if (deps.switchTab) {
            await deps.switchTab(panel, tabId);
        }
    }

    async function refreshSuperagentManagerTab(panel, deps = {}) {
        const tabId = deps.tabId || 'superagent-manager';
        if (panel.activeTabId !== tabId) return;
        if (deps.renderSuperagentManagerTab) {
            await deps.renderSuperagentManagerTab(panel);
            panel._storeActiveTabScrollState();
        }
    }

    window.superagentManagerTab = {
        renderSubagentManagerTab,
        openSuperagentManagerTab,
        refreshSuperagentManagerTab,
        renderSuperagentManagerTab
    };
})();
