class MainPanel {
    constructor() {
        this.isSending = false;
        this.attachedFiles = [];
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.autoSpeak = false;

        // Multi-chat tab management
        this.chatTabs = new Map(); // sessionId -> { title, messagesHTML, isSending, loadingId }
        this.activeTabId = null;

        // Initialize immediately since we're already in DOMContentLoaded
        this.commandHandler = new CommandHandler(this);
        this.initializeEvents();
        this.initializeVoice();
        this.initContextSettings();
        this.restoreOpenTabs();
    }

    async loadSystemPrompt() {
        try {
            const prompt = await window.electronAPI.getSystemPrompt();
            const promptTextarea = document.getElementById('system-prompt');
            if (promptTextarea) {
                promptTextarea.value = prompt || '';
            }
        } catch (error) {
            console.error('Error loading system prompt:', error);
        }
    }

    initializeEvents() {
        // Chat send functionality
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        const messageInput = document.getElementById('message-input');
        const newChatBtn = document.getElementById('new-chat-btn');
        const attachBtn = document.getElementById('attach-btn');
        const voiceBtn = document.getElementById('voice-btn');
        const speakBtn = document.getElementById('speak-btn');
        const dropZone = document.getElementById('drop-zone');

        sendBtn.addEventListener('click', () => this.sendMessage());

        // Stop generation button
        if (stopBtn) {
            stopBtn.addEventListener('click', async () => {
                console.log('[UI] Stop button clicked');
                try {
                    await window.electronAPI.stopGeneration();
                    stopBtn.classList.add('hidden');
                    sendBtn.classList.remove('hidden');
                    this.isSending = false;
                    this.addMessage('system', '[Generation stopped]');
                } catch (error) {
                    console.error('Failed to stop generation:', error);
                }
            });
        }

        if (newChatBtn) newChatBtn.addEventListener('click', () => this.newChat());

        const newSessionBtn = document.getElementById('new-session-btn');
        if (newSessionBtn) newSessionBtn.addEventListener('click', () => this.clearCurrentChat());
        attachBtn.addEventListener('click', () => this.attachFile());
        voiceBtn.addEventListener('click', () => this.toggleVoiceInput());
        speakBtn.addEventListener('click', () => this.toggleAutoSpeak());

        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.hideCommandAutocomplete();
                this.sendMessage();
            }
        });

        // Autocomplete for /commands
        messageInput.addEventListener('input', () => {
            const val = messageInput.value;
            if (val.startsWith('/') && !val.includes(' ')) {
                const completions = this.commandHandler.getCompletions(val);
                this.showCommandAutocomplete(completions);
            } else {
                this.hideCommandAutocomplete();
            }
        });

        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.hideCommandAutocomplete();
            if (e.key === 'Tab' && this._autocompleteVisible) {
                e.preventDefault();
                this.acceptFirstAutocomplete();
            }
        });

        // Drag and drop
        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes('Files')) {
                dropZone.classList.add('active');
            }
        });

        dropZone.addEventListener('dragover', (e) => e.preventDefault());

        dropZone.addEventListener('dragleave', (e) => {
            if (e.target === dropZone) {
                dropZone.classList.remove('active');
            }
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('active');
            this.handleFileDrop(e.dataTransfer.files);
        });

        // Settings tab events
        document.getElementById('save-prompt-btn').addEventListener('click', () => this.saveSystemPrompt());

        // MCP tab events
        const addProxyBtn = document.getElementById('add-proxy-btn');
        if (addProxyBtn) {
            addProxyBtn.addEventListener('click', () => this.addProxyServer());
        }

        // Listen for updates from main process
        this.setupEventListeners();

        // Reinitialize context slider when API tab is opened
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tab === 'api') {
                    setTimeout(() => this.initContextSettings(), 100);
                }
            });
        });
    }

    initializeVoice() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.lang = 'en-US';

            this.recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                document.getElementById('message-input').value = transcript;
                document.getElementById('voice-btn').classList.remove('recording');
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                document.getElementById('voice-btn').classList.remove('recording');
                if (event.error !== 'no-speech') {
                    this.showNotification(`Voice error: ${event.error}`, 'error');
                }
            };

            this.recognition.onend = () => {
                document.getElementById('voice-btn').classList.remove('recording');
            };
        } else {
            console.warn('Speech recognition not supported in this browser');
        }
    }

    toggleVoiceInput() {
        if (!this.recognition) {
            this.showNotification('Voice input not supported in this browser. Try Chrome/Edge.', 'error');
            return;
        }

        const voiceBtn = document.getElementById('voice-btn');
        if (voiceBtn.classList.contains('recording')) {
            this.recognition.stop();
        } else {
            try {
                voiceBtn.classList.add('recording');
                this.recognition.start();
            } catch (error) {
                console.error('Failed to start recognition:', error);
                voiceBtn.classList.remove('recording');
                this.showNotification('Failed to start voice input', 'error');
            }
        }
    }

    toggleAutoSpeak() {
        this.autoSpeak = !this.autoSpeak;
        const speakBtn = document.getElementById('speak-btn');
        speakBtn.style.opacity = this.autoSpeak ? '1' : '0.6';
        speakBtn.title = this.autoSpeak ? 'Auto-speak ON' : 'Auto-speak OFF';
        this.showNotification(`Auto-speak ${this.autoSpeak ? 'enabled' : 'disabled'}`);
    }

    speakText(text) {
        this.synthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        this.synthesis.speak(utterance);
    }

    attachFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (e) => this.handleFileDrop(e.target.files);
        input.click();
    }

    async handleFileDrop(files) {
        for (const file of files) {
            const filePath = file.path || file.name;
            const ext = file.name.split('.').pop().toLowerCase();
            const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext);
            const isAudio = ['mp3', 'wav', 'ogg', 'm4a'].includes(ext);

            // Show user message with file attachment
            this.addMessageWithAttachment('user', `Analyze this file`, {
                name: file.name,
                type: isImage ? 'image' : isAudio ? 'audio' : 'document'
            });

            const loadingId = this.addMessage('assistant', '...');

            // Process file
            try {
                const result = await window.electronAPI.handleFileDrop(filePath);
                this.removeMessage(loadingId);
                if (result.success) {
                    this.addMessage('assistant', result.response.content);
                    this.updateContextUsage(result.response);
                    if (this.autoSpeak) this.speakText(result.response.content);
                }
            } catch (error) {
                this.removeMessage(loadingId);
                this.showNotification(`Error processing ${file.name}`, 'error');
            }
        }
    }

    showAttachedFile(fileName) {
        const container = document.querySelector('.input-container');
        const fileDiv = document.createElement('div');
        fileDiv.className = 'attached-file';
        fileDiv.innerHTML = `
            <span>📎 ${fileName}</span>
            <span class="remove-file" onclick="this.parentElement.remove()">✕</span>
        `;
        container.insertBefore(fileDiv, container.firstChild);
    }

    async sendMessage() {
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        const message = messageInput.value.trim();

        if (!message && this.attachedFiles.length === 0) return;

        // Intercept /commands
        if (this.commandHandler.isCommand(message)) {
            messageInput.value = '';
            this.addMessage('user', message);
            const result = await this.commandHandler.execute(message);

            // If the command returns a passthrough, send that to the AI instead
            if (result.passthrough) {
                messageInput.value = result.passthrough;
                return this.sendMessage();
            }

            if (result.output) {
                this.addMessage('system', result.output, result.style);
            }
            return;
        }

        const sessionId = this.activeTabId;
        const tab = this.chatTabs.get(sessionId);

        // Add user message to UI immediately
        if (message) this.addMessage('user', message);
        messageInput.value = '';
        this.attachedFiles = [];
        document.querySelectorAll('.attached-file').forEach(el => el.remove());
        messageInput.focus();

        // Show stop button, hide send button
        if (sendBtn) sendBtn.classList.add('hidden');
        if (stopBtn) stopBtn.classList.remove('hidden');
        this.isSending = true;
        if (tab) { tab.isSending = true; this.renderTabs(); }

        // Auto-title the tab from first user message
        if (tab && (tab.title.startsWith('Chat ') || !tab.title)) {
            tab.title = message.substring(0, 30) + (message.length > 30 ? '…' : '');
            this.renderTabs();
        }

        // Add loading indicator
        const loadingId = this.addMessage('assistant', '...');

        // Send async with sessionId for per-chat isolation
        window.electronAPI.sendMessage(message, sessionId)
            .then(response => {
                // Only update UI if this tab is still active
                if (this.activeTabId === sessionId) {
                    this.removeMessage(loadingId);
                    if (!response.stopped && !response.needsPermission) {
                        this.addMessage('assistant', response.content);
                        this.updateContextUsage(response);
                        if (this.autoSpeak) this.speakText(response.content);
                    }
                }
            })
            .catch(error => {
                console.error('Error sending message:', error);
                if (this.activeTabId === sessionId) {
                    this.removeMessage(loadingId);
                    this.addMessage('system', `Error: ${error.message}`);
                }
            })
            .finally(() => {
                if (sendBtn) sendBtn.classList.remove('hidden');
                if (stopBtn) stopBtn.classList.add('hidden');
                this.isSending = false;
                if (tab) { tab.isSending = false; this.renderTabs(); }
            });
    }

    addMessage(role, content, style) {
        const messagesContainer = document.getElementById('messages-container');
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${role}`;

        const messageDiv = document.createElement('div');
        const messageId = `msg-${Date.now()}-${Math.random()}`;
        messageDiv.id = messageId;
        messageDiv.className = `message ${role}${style === 'terminal' ? ' terminal-output' : ''}`;

        // Use preformatted text for terminal-style output
        if (style === 'terminal') {
            messageDiv.style.whiteSpace = 'pre-wrap';
            messageDiv.style.fontFamily = 'monospace';
        }

        // Process content for assistant messages
        if (role === 'assistant' && content !== '...') {
            messageDiv.innerHTML = this._renderAssistantContent(content);
        } else {
            messageDiv.textContent = content;
        }

        messageWrapper.appendChild(messageDiv);

        // Add speak button outside bubble for assistant messages
        if (role === 'assistant' && content !== '...') {
            const speakIcon = document.createElement('button');
            speakIcon.className = 'message-speak-btn';
            speakIcon.innerHTML = '🔊';
            speakIcon.title = 'Speak this message';
            speakIcon.onclick = (e) => {
                e.stopPropagation();
                this.speakText(content.replace(/<think>[\s\S]*?<\/think>/g, '').trim());
            };
            messageWrapper.appendChild(speakIcon);
        }

        messagesContainer.appendChild(messageWrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return messageId;
    }

    /**
     * Render assistant content with thinking blocks and image support.
     */
    _renderAssistantContent(content) {
        let html = '';

        // Extract <think>...</think> blocks
        const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
        let match;
        let lastIndex = 0;
        const vis = this._thinkingVisibility || 'show';

        while ((match = thinkRegex.exec(content)) !== null) {
            const before = content.substring(lastIndex, match.index).trim();
            if (before) html += this._escapeAndRenderImages(before);

            if (vis === 'show') {
                html += `<details class="thinking-block" open><summary>\ud83d\udcad Thinking</summary><div class="thinking-content">${this._escapeHtml(match[1].trim())}</div></details>`;
            } else if (vis === 'min') {
                html += `<details class="thinking-block"><summary>\ud83d\udcad Thinking...</summary><div class="thinking-content">${this._escapeHtml(match[1].trim())}</div></details>`;
            }
            // vis === 'hide' → skip entirely
            lastIndex = match.index + match[0].length;
        }

        const remaining = content.substring(lastIndex).trim();
        if (remaining) html += this._escapeAndRenderImages(remaining);

        return html || this._escapeHtml(content);
    }

    /**
     * Escape HTML and render markdown images.
     */
    _escapeAndRenderImages(text) {
        let escaped = this._escapeHtml(text);

        // Render markdown images: ![alt](url)
        escaped = escaped.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
            return `<img src="${url}" alt="${alt}" class="chat-image" onclick="window.mainPanel._openLightbox('${url}')" title="Click to enlarge">`;
        });

        return escaped;
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    _openLightbox(src) {
        // Remove existing lightbox
        const existing = document.getElementById('image-lightbox');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'image-lightbox';
        overlay.className = 'image-lightbox';
        overlay.onclick = () => overlay.remove();
        overlay.innerHTML = `<img src="${src}" alt="Enlarged image">`;
        document.body.appendChild(overlay);
    }

    // ==================== Command Autocomplete ====================

    showCommandAutocomplete(completions) {
        let dropdown = document.getElementById('cmd-autocomplete');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = 'cmd-autocomplete';
            dropdown.className = 'cmd-autocomplete';
            const inputRow = document.querySelector('.chat-input-row');
            if (inputRow) inputRow.style.position = 'relative';
            inputRow?.appendChild(dropdown);
        }

        if (completions.length === 0) {
            this.hideCommandAutocomplete();
            return;
        }

        dropdown.innerHTML = '';
        completions.forEach(c => {
            const item = document.createElement('div');
            item.className = 'cmd-autocomplete-item';
            item.innerHTML = `<span class="cmd-name">${c.name}</span> <span class="cmd-desc">${c.description}</span>`;
            item.addEventListener('click', () => {
                document.getElementById('message-input').value = c.name + ' ';
                document.getElementById('message-input').focus();
                this.hideCommandAutocomplete();
            });
            dropdown.appendChild(item);
        });

        dropdown.style.display = 'block';
        this._autocompleteVisible = true;
    }

    hideCommandAutocomplete() {
        const dropdown = document.getElementById('cmd-autocomplete');
        if (dropdown) dropdown.style.display = 'none';
        this._autocompleteVisible = false;
    }

    acceptFirstAutocomplete() {
        const dropdown = document.getElementById('cmd-autocomplete');
        if (dropdown) {
            const first = dropdown.querySelector('.cmd-autocomplete-item .cmd-name');
            if (first) {
                document.getElementById('message-input').value = first.textContent + ' ';
                document.getElementById('message-input').focus();
            }
        }
        this.hideCommandAutocomplete();
    }

    addMessageWithAttachment(role, content, attachment) {
        const messagesContainer = document.getElementById('messages-container');
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${role}`;

        const messageDiv = document.createElement('div');
        const messageId = `msg-${Date.now()}-${Math.random()}`;
        messageDiv.id = messageId;
        messageDiv.className = `message ${role}`;

        // For images, show inline preview
        if (attachment.type === 'image' && attachment.path) {
            messageDiv.innerHTML = `<img src="file://${attachment.path}" class="chat-image" alt="${attachment.name}" onclick="window.mainPanel._openLightbox('file://${attachment.path}')" title="Click to enlarge"><br><span>${this._escapeHtml(content)}</span>`;
        } else {
            // Create attachment icon
            const icons = { image: '🖼️', audio: '🎵', document: '📄' };
            messageDiv.innerHTML = `<span class="attachment-icon" title="${this._escapeHtml(attachment.name)}">${icons[attachment.type] || '📎'}</span> <span>${this._escapeHtml(content)}</span>`;
        }

        messageWrapper.appendChild(messageDiv);
        messagesContainer.appendChild(messageWrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return messageId;
    }

    removeMessage(messageId) {
        const messageDiv = document.getElementById(messageId);
        if (messageDiv) {
            // Remove the wrapper parent if it exists (message-wrapper), otherwise just the div
            const wrapper = messageDiv.closest('.message-wrapper');
            (wrapper || messageDiv).remove();
        }
    }

    async updateContextUsage(response) {
        const contextDiv = document.getElementById('context-usage');
        if (!contextDiv) return;

        if (!response || !response.usage) {
            contextDiv.textContent = '';
            return;
        }

        const { prompt_tokens, total_tokens } = response.usage;
        // Use response context_length first, then saved setting, then default
        let contextLength = response.context_length;
        if (!contextLength) {
            try {
                const saved = await window.electronAPI.getSetting('context_window');
                contextLength = saved ? parseInt(saved) : 8192;
            } catch (e) {
                contextLength = 8192;
            }
        }

        // Store for later use
        this.lastContextUsage = { prompt_tokens, total_tokens, contextLength };

        // Format to k notation
        const formatK = (num) => (num / 1000).toFixed(1) + 'k';

        contextDiv.textContent = `${formatK(total_tokens)}/${formatK(contextLength)}`;
        contextDiv.title = `Prompt: ${prompt_tokens} tokens, Total: ${total_tokens} tokens`;

        // Color code based on usage
        const percentage = (total_tokens / contextLength) * 100;
        if (percentage > 80) {
            contextDiv.style.color = '#dc3545';
        } else if (percentage > 60) {
            contextDiv.style.color = '#ffc107';
        } else {
            contextDiv.style.color = '#28a745';
        }
    }

    async calculateContextUsage() {
        try {
            const conversations = await window.electronAPI.getConversations();
            if (!conversations || conversations.length === 0) {
                this.updateContextUsage(null);
                return;
            }

            // Estimate tokens: ~1.37 tokens per word
            let totalTokens = 0;
            conversations.forEach(conv => {
                const words = conv.content.split(/\s+/).length;
                totalTokens += Math.ceil(words * 1.37);
            });

            // Get context window setting
            const contextWindow = await window.electronAPI.getSetting('context_window');
            const contextLength = contextWindow ? parseInt(contextWindow) : 8192;

            // Update display
            this.updateContextUsage({
                usage: {
                    prompt_tokens: totalTokens,
                    total_tokens: totalTokens
                },
                context_length: contextLength
            });

            console.log(`Context loaded: ${totalTokens}/${contextLength} tokens`);
        } catch (error) {
            console.error('Error calculating context:', error);
        }
    }

    showStoredContextUsage() {
        if (this.lastContextUsage) {
            this.updateContextUsage({ usage: this.lastContextUsage, context_length: this.lastContextUsage.contextLength });
        }
    }

    // Clear the CURRENT tab in-place — wipe messages, get fresh backend session, stay in same tab
    async clearCurrentChat() {
        try {
            // Ask backend to clear history and return a fresh session id
            const result = await window.electronAPI.clearConversations();
            const newSessionId = result.sessionId;

            // Wipe the messages display
            const container = document.getElementById('messages-container');
            if (container) container.innerHTML = '';
            this.updateContextUsage(null);

            // Update the active tab to track the new session id
            if (this.activeTabId && this.chatTabs.has(this.activeTabId)) {
                const tab = this.chatTabs.get(this.activeTabId);
                this.chatTabs.delete(this.activeTabId);
                tab.title = 'New Chat';
                tab.messagesHTML = '';
                this.chatTabs.set(newSessionId, tab);
            }
            this.activeTabId = newSessionId;

            this.renderTabs();
            this.saveOpenTabIds();

            // Refresh sidebar session history
            if (window.sidebar) window.sidebar.loadChatSessions();
        } catch (error) {
            console.error('Error clearing chat:', error);
        }
    }

    async newChat() {
        try {
            const session = await window.electronAPI.invoke('create-chat-session');
            const sessionId = session.id;

            // Save current tab's messages before switching
            this.saveCurrentTabMessages();

            // Create tab state
            this.chatTabs.set(sessionId, {
                title: `Chat ${this.chatTabs.size + 1}`,
                messagesHTML: '',
                isSending: false,
                loadingId: null
            });

            this.activeTabId = sessionId;
            document.getElementById('messages-container').innerHTML = '';
            this.renderTabs();
            this.saveOpenTabIds();

            if (window.sidebar) window.sidebar.loadChatSessions();
        } catch (error) {
            console.error('Error starting new chat:', error);
        }
    }

    /**
     * Open or switch to an agent's dedicated chat tab.
     * @param {number} agentId - Agent database ID
     * @param {number} sessionId - Chat session ID for this agent
     * @param {Object} agent - Agent object with name, icon, etc.
     */
    async openAgentChat(agentId, sessionId, agent) {
        try {
            // Check if tab already open for this session
            if (this.chatTabs.has(sessionId)) {
                await this.switchTab(sessionId);
                return;
            }

            // Save current tab's messages
            this.saveCurrentTabMessages();

            // Create tab with agent metadata
            this.chatTabs.set(sessionId, {
                title: agent ? agent.name : `Agent ${agentId}`,
                agentId: agentId,
                agentIcon: agent ? agent.icon : '🤖',
                messagesHTML: '',
                isSending: false,
                loadingId: null
            });

            this.activeTabId = sessionId;

            // Load existing conversations for this agent session
            await this.loadTabConversations(sessionId);

            this.renderTabs();
            this.saveOpenTabIds();

            // Switch backend to this session
            await window.electronAPI.switchChatSession(sessionId);
            await this.calculateContextUsage();
        } catch (error) {
            console.error('Error opening agent chat:', error);
        }
    }

    openNewWindow() {
        // Ask main process to open a second app window
        window.electronAPI.invoke('open-new-window').catch(err => {
            console.error('Failed to open new window:', err);
        });
    }

    async restoreOpenTabs() {
        try {
            const settings = await window.electronAPI.getSettings();
            const openTabsRaw = settings?.open_chat_tabs;
            const activeRaw = settings?.active_chat_tab;
            let tabIds = [];

            if (openTabsRaw) {
                try { tabIds = JSON.parse(openTabsRaw); } catch (e) { tabIds = []; }
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

            // Filter out agent sessions — they should only be opened via agent picker
            const regularTabIds = [];
            for (const sid of tabIds) {
                const conversations = await window.electronAPI.loadChatSession(sid);
                // Check if session exists by trying to load it
                // We can't easily check agent_id from renderer, so just restore all non-empty ones
                regularTabIds.push(sid);
            }

            if (regularTabIds.length === 0) {
                const session = await window.electronAPI.invoke('create-chat-session');
                regularTabIds.push(session.id);
            }

            for (let i = 0; i < regularTabIds.length; i++) {
                const sid = regularTabIds[i];
                this.chatTabs.set(sid, {
                    title: `Chat ${i + 1}`,
                    messagesHTML: '',
                    isSending: false,
                    loadingId: null
                });
            }

            const activeId = activeRaw ? parseInt(activeRaw) : null;
            this.activeTabId = (activeId && this.chatTabs.has(activeId)) ? activeId : regularTabIds[0];

            await this.loadTabConversations(this.activeTabId);
            await window.electronAPI.switchChatSession(this.activeTabId);

            for (const sid of regularTabIds) {
                await this.autoTitleTab(sid);
            }

            this.renderTabs();
            this.saveOpenTabIds();
        } catch (error) {
            console.error('Error restoring tabs:', error);
            await this.newChat();
        }
    }

    async autoTitleTab(sessionId) {
        try {
            const conversations = await window.electronAPI.loadChatSession(sessionId);
            const firstUserMsg = conversations.find(c => c.role === 'user');
            if (firstUserMsg) {
                const title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '…' : '');
                const tab = this.chatTabs.get(sessionId);
                if (tab) tab.title = title;
            }
        } catch (e) { /* ignore */ }
    }

    saveCurrentTabMessages() {
        if (!this.activeTabId || !this.chatTabs.has(this.activeTabId)) return;
        const container = document.getElementById('messages-container');
        if (container) {
            this.chatTabs.get(this.activeTabId).messagesHTML = container.innerHTML;
        }
    }

    async switchTab(sessionId) {
        if (sessionId === this.activeTabId) return;
        if (!this.chatTabs.has(sessionId)) return;

        this.saveCurrentTabMessages();
        this.activeTabId = sessionId;

        const tab = this.chatTabs.get(sessionId);
        const container = document.getElementById('messages-container');

        if (tab.messagesHTML) {
            container.innerHTML = tab.messagesHTML;
        } else {
            await this.loadTabConversations(sessionId);
        }

        container.scrollTop = container.scrollHeight;
        this.renderTabs();

        await window.electronAPI.saveSetting('active_chat_tab', sessionId.toString());
        await window.electronAPI.switchChatSession(sessionId);
        await this.calculateContextUsage();
    }

    async loadTabConversations(sessionId) {
        try {
            const conversations = await window.electronAPI.loadChatSession(sessionId);
            const container = document.getElementById('messages-container');
            if (!container) return;

            container.innerHTML = '';
            conversations.forEach(conv => {
                this.addMessage(conv.role, conv.content);
            });
            container.scrollTop = container.scrollHeight;
        } catch (error) {
            console.error('Error loading tab conversations:', error);
        }
    }

    async closeTab(sessionId) {
        if (this.chatTabs.size <= 1) return;

        this.chatTabs.delete(sessionId);

        if (sessionId === this.activeTabId) {
            const remaining = [...this.chatTabs.keys()];
            await this.switchTab(remaining[remaining.length - 1]);
        }

        this.renderTabs();
        this.saveOpenTabIds();
    }

    renderTabs() {
        // Render tabs into the dedicated list div (not the full bar)
        const list = document.getElementById('chat-tabs-list');
        if (!list) return;

        list.innerHTML = '';

        for (const [sessionId, tab] of this.chatTabs) {
            const tabEl = document.createElement('div');
            tabEl.className = `chat-tab${sessionId === this.activeTabId ? ' active' : ''}`;
            tabEl.dataset.sessionId = sessionId;

            const statusDot = document.createElement('span');
            statusDot.className = `chat-tab-status${tab.isSending ? ' thinking' : ''}`;

            const label = document.createElement('span');
            label.className = 'chat-tab-label';
            // Show agent icon before label if this is an agent tab
            const agentPrefix = tab.agentIcon ? `${tab.agentIcon} ` : '';
            label.textContent = agentPrefix + (tab.title || `Chat ${sessionId}`);

            const closeBtn = document.createElement('button');
            closeBtn.className = 'chat-tab-close';
            closeBtn.textContent = '×';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeTab(sessionId);
            });

            tabEl.appendChild(statusDot);
            tabEl.appendChild(label);
            if (this.chatTabs.size > 1) tabEl.appendChild(closeBtn);
            tabEl.addEventListener('click', () => this.switchTab(sessionId));

            list.appendChild(tabEl);
        }
    }

    async saveOpenTabIds() {
        const ids = [...this.chatTabs.keys()];
        try {
            await window.electronAPI.saveSetting('open_chat_tabs', JSON.stringify(ids));
            if (this.activeTabId) {
                await window.electronAPI.saveSetting('active_chat_tab', this.activeTabId.toString());
            }
        } catch (e) {
            console.error('Error saving open tabs:', e);
        }
    }

    // Context preset mapping: slider index → token value
    static CONTEXT_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 98304, 131072, 163840, 196608, 262144];
    static CONTEXT_LABELS = ['2K', '4K', '8K', '16K', '32K', '64K', '96K', '128K', '160K', '192K', '256K'];

    initContextSettings() {
        const contextSlider = document.getElementById('context-slider');
        const contextDisplay = document.getElementById('context-display');

        if (!contextSlider || !contextDisplay) {
            console.warn('Context slider elements not found');
            return;
        }

        console.log('✓ Context slider found, initializing...');

        // Set initial display
        this.updateContextDisplay(contextSlider.value);

        // Load saved setting and find matching preset index
        window.electronAPI.getSetting('context_window')
            .then(savedValue => {
                if (savedValue) {
                    const numVal = parseInt(savedValue);
                    // Find closest preset index
                    let bestIdx = 2; // default 8K
                    let bestDiff = Infinity;
                    MainPanel.CONTEXT_PRESETS.forEach((preset, idx) => {
                        const diff = Math.abs(preset - numVal);
                        if (diff < bestDiff) { bestDiff = diff; bestIdx = idx; }
                    });
                    console.log(`✓ Loaded saved value: ${savedValue} → index ${bestIdx}`);
                    contextSlider.value = bestIdx;
                    this.updateContextDisplay(bestIdx);
                }
            })
            .catch(error => {
                console.error('✗ Error loading setting:', error);
            });

        // Initialize thinking mode settings
        this._initThinkingSettings();
    }

    async _initThinkingSettings() {
        try {
            const { mode, showThinking } = await window.electronAPI.llm.getThinkingMode();
            // mode: 'off' | 'think' | 'nothink'
            // We store visibility separately as show/min/hide
            const thinkToggle = document.getElementById('thinking-toggle');
            const visGroup = document.getElementById('thinking-visibility-group');
            const visRadios = document.querySelectorAll('input[name="think-vis"]');

            // Determine initial visibility setting
            let savedVis;
            try {
                savedVis = await window.electronAPI.getSettingValue('llm.thinkingVisibility');
            } catch (e) { }
            this._thinkingVisibility = savedVis || (showThinking ? 'show' : 'hide');

            // Set toggle state
            if (thinkToggle) {
                thinkToggle.checked = mode === 'think';
            }

            // Show/hide visibility group based on toggle
            if (visGroup) {
                visGroup.style.display = (mode === 'think') ? 'flex' : 'none';
            }

            // Set the right radio
            visRadios.forEach(r => {
                r.checked = r.value === this._thinkingVisibility;
            });

            // Bind toggle
            if (thinkToggle) {
                thinkToggle.addEventListener('change', async (e) => {
                    const newMode = e.target.checked ? 'think' : 'off';
                    await window.electronAPI.llm.setThinkingMode(newMode);
                    if (visGroup) visGroup.style.display = e.target.checked ? 'flex' : 'none';
                    this.showNotification(`Thinking: ${e.target.checked ? 'ON' : 'OFF'}`);
                });
            }

            // Bind radio pills
            visRadios.forEach(radio => {
                radio.addEventListener('change', async (e) => {
                    this._thinkingVisibility = e.target.value;
                    await window.electronAPI.saveSetting('llm.thinkingVisibility', e.target.value);
                    // Also update the showThinking flag for backward compat
                    await window.electronAPI.llm.setShowThinking(e.target.value !== 'hide');
                });
            });
        } catch (error) {
            console.error('Failed to init thinking settings:', error);
            this._thinkingVisibility = 'show';
        }
    }

    async saveContextSize(index) {
        try {
            const value = MainPanel.CONTEXT_PRESETS[parseInt(index)] || 8192;
            console.log('Saving context:', value);
            await window.electronAPI.setContextSetting(value);
            this.showNotification(`Context: ${MainPanel.CONTEXT_LABELS[parseInt(index)] || '8K'}`);
        } catch (error) {
            console.error('Save error:', error);
            this.showNotification(`Save failed: ${error.message}`, 'error');
        }
    }

    updateContextDisplay(index) {
        const idx = parseInt(index);
        const contextDisplay = document.getElementById('context-display');
        if (!contextDisplay) return;

        const tokens = MainPanel.CONTEXT_PRESETS[idx] || 8192;
        const label = MainPanel.CONTEXT_LABELS[idx] || '8K';
        contextDisplay.textContent = `${label} (${tokens.toLocaleString()} tokens)`;
    }

    async saveSystemPrompt() {
        const promptTextarea = document.getElementById('system-prompt');
        const prompt = promptTextarea.value.trim();

        if (!prompt) return;

        try {
            await window.electronAPI.setSystemPrompt(prompt);
            this.showNotification('System prompt saved successfully');
        } catch (error) {
            console.error('Error saving system prompt:', error);
            this.showNotification('Error saving system prompt', 'error');
        }
    }



    async addProxyServer() {
        // Placeholder for proxy server addition
        // This would typically open a modal or form
        this.showNotification('Proxy server functionality coming soon', 'info');
    }

    setupEventListeners() {
        // Listen for conversation updates
        window.electronAPI.onConversationUpdate((event, data) => {
            // Don't reload on every update
        });

        // Listen for tool permission requests
        window.electronAPI.onToolPermissionRequest((event, request) => {
            this.showToolPermissionDialog(request);
        });
    }

    async initializeSession() {
        // Tab system handles initialization now via restoreOpenTabs()
        // This is kept for backward compatibility
    }

    async loadConversations() {
        if (this.activeTabId) {
            await this.loadTabConversations(this.activeTabId);
        }
    }

    // All rule-related methods have been moved to rule-manager.js

    showToolPermissionDialog(request) {
        const isCustomTool = request.toolName === 'create_tool';

        const dialog = document.createElement('div');
        dialog.className = 'tool-permission-overlay';

        if (isCustomTool) {
            const params = request.params;
            const codeHtml = this.escapeHtml(params.code || '');
            dialog.innerHTML = `
                <div class="tool-permission-dialog tool-creation-dialog">
                    <div class="permission-header">
                        <h3>🔧 Create New Tool</h3>
                        <button class="close-btn" onclick="this.closest('.tool-permission-overlay').remove()">✕</button>
                    </div>
                    <div class="permission-content">
                        <p><strong>Tool Name:</strong> ${params.name || 'Unknown'}</strong>
                        <p><strong>Description:</strong> ${params.description || 'No description'}</p>
                        <details style="margin-top: 1rem;">
                            <summary style="cursor: pointer; font-weight: 600;">View Code</summary>
                            <pre style="background: #f5f5f5; padding: 0.75rem; border-radius: 4px; overflow-x: auto; margin-top: 0.5rem;"><code>${codeHtml}</code></pre>
                        </details>
                    </div>
                    <div class="permission-actions">
                        <button class="btn-secondary permission-btn" onclick="mainPanel.denyToolCreation()">
                            Deny
                        </button>
                        <button class="btn-success permission-btn" onclick="mainPanel.approveToolCreation()">
                            Approve & Create
                        </button>
                    </div>
                </div>
            `;
        } else {
            dialog.innerHTML = `
                <div class="tool-permission-dialog">
                    <div class="permission-header">
                        <h3>🔐 Tool Permission Required</h3>
                        <button class="close-btn" onclick="this.closest('.tool-permission-overlay').remove()">✕</button>
                    </div>
                    <div class="permission-content">
                        <p>The AI wants to use <strong>${request.toolName}</strong></p>
                        <p class="tool-description">${request.toolDefinition.userDescription}</p>
                    </div>
                    <div class="permission-actions">
                        <button class="btn-secondary permission-btn" onclick="mainPanel.denyToolPermission()">
                            Deny
                        </button>
                        <button class="btn-primary permission-btn" onclick="mainPanel.allowToolOnce('${request.toolName}')">
                            Allow Once
                        </button>
                        <button class="btn-success permission-btn" onclick="mainPanel.enableTool('${request.toolName}')">
                            Enable Permanently
                        </button>
                    </div>
                </div>
            `;
        }

        // Store current request for use in button handlers
        this.currentPermissionRequest = request;

        document.body.appendChild(dialog);

        // Add styles if not already present
        if (!document.getElementById('tool-permission-styles')) {
            const style = document.createElement('style');
            style.id = 'tool-permission-styles';
            style.textContent = `
                .tool-permission-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 2000;
                }

                .tool-permission-dialog {
                    background: var(--card-bg);
                    border: 1px solid var(--border-color);
                    border-radius: var(--border-radius);
                    padding: 0;
                    min-width: 400px;
                    max-width: 90vw;
                }

                .permission-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 1rem 1.5rem;
                    border-bottom: 1px solid var(--border-color);
                }

                .permission-header h3 {
                    margin: 0;
                    font-size: 1.2rem;
                }

                .close-btn {
                    background: none;
                    border: none;
                    font-size: 1.5rem;
                    cursor: pointer;
                    padding: 0;
                    opacity: 0.6;
                }

                .close-btn:hover {
                    opacity: 1;
                }

                .permission-content {
                    padding: 1.5rem;
                }

                .permission-content .tool-description {
                    margin: 0.5rem 0 0 0;
                    font-size: 0.9rem;
                    color: var(--text-secondary);
                }

                .permission-actions {
                    display: flex;
                    gap: 0.5rem;
                    padding: 1rem 1.5rem;
                    border-top: 1px solid var(--border-color);
                    justify-content: flex-end;
                }

                .permission-btn {
                    padding: 0.5rem 1rem;
                }
                
                .tool-creation-dialog {
                    min-width: 500px;
                }
                
                .tool-creation-dialog pre {
                    max-height: 300px;
                    overflow-y: auto;
                }
            `;
            document.head.appendChild(style);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async approveToolCreation() {
        try {
            const result = await window.electronAPI.createCustomTool(this.currentPermissionRequest.params);
            if (result.success) {
                this.addMessage('assistant', `✅ Tool "${this.currentPermissionRequest.params.name}" created successfully! It's now available in the MCP tools list (disabled by default).`);
                if (window.sidebar && window.sidebar.loadMCPTools) {
                    await window.sidebar.loadMCPTools();
                }
                this.showNotification(`Tool "${this.currentPermissionRequest.params.name}" created`);
            } else {
                this.addMessage('assistant', `❌ Failed to create tool: ${result.error}`);
                this.showNotification('Tool creation failed', 'error');
            }
            this.closePermissionDialog();
        } catch (error) {
            console.error('Error creating tool:', error);
            this.addMessage('assistant', `❌ Error creating tool: ${error.message}`);
            this.closePermissionDialog();
        }
    }

    denyToolCreation() {
        this.addMessage('assistant', 'Tool creation was denied.');
        this.closePermissionDialog();
    }

    async allowToolOnce(toolName) {
        // Capture request data and close modal IMMEDIATELY (non-blocking UI)
        const reqToolName = this.currentPermissionRequest.toolName;
        const reqParams = this.currentPermissionRequest.params;
        this.closePermissionDialog();

        try {
            const result = await window.electronAPI.executeMCPToolOnce(reqToolName, reqParams);

            if (result.success) {
                const loadingId = this.addMessage('assistant', '...');

                try {
                    const interpreted = await window.electronAPI.interpretToolResult(
                        reqToolName, reqParams, result.result
                    );

                    this.removeMessage(loadingId);
                    this.addMessage('assistant', interpreted.content);
                    this.updateContextUsage(interpreted);
                    if (this.autoSpeak) this.speakText(interpreted.content);
                } catch (interpretError) {
                    console.error('Failed to interpret tool result:', interpretError);
                    this.removeMessage(loadingId);
                    const resultStr = typeof result.result === 'object'
                        ? JSON.stringify(result.result, null, 2)
                        : String(result.result);
                    this.addMessage('assistant', `Tool ${toolName} result:\n${resultStr}`);
                }
            } else {
                this.addMessage('assistant', `Failed to execute ${toolName}: ${result.error}`);
            }
        } catch (error) {
            console.error('Error allowing tool once:', error);
            this.addMessage('assistant', `Error executing ${toolName}: ${error.message}`);
        }
    }

    async enableTool(toolName) {
        // Capture request data and close modal IMMEDIATELY
        const reqToolName = this.currentPermissionRequest.toolName;
        const reqParams = this.currentPermissionRequest.params;
        this.closePermissionDialog();

        try {
            await window.electronAPI.setToolActive(reqToolName, true);

            if (window.sidebar && window.sidebar.loadMCPTools) {
                await window.sidebar.loadMCPTools();
            }

            this.showNotification(`✅ ${toolName} enabled permanently`);

            // Execute tool and interpret results (modal already closed)
            const result = await window.electronAPI.executeMCPToolOnce(reqToolName, reqParams);
            if (result.success) {
                const loadingId = this.addMessage('assistant', '...');
                try {
                    const interpreted = await window.electronAPI.interpretToolResult(
                        reqToolName, reqParams, result.result
                    );
                    this.removeMessage(loadingId);
                    this.addMessage('assistant', interpreted.content);
                    this.updateContextUsage(interpreted);
                    if (this.autoSpeak) this.speakText(interpreted.content);
                } catch (interpretError) {
                    console.error('Failed to interpret tool result:', interpretError);
                    this.removeMessage(loadingId);
                    const resultStr = typeof result.result === 'object'
                        ? JSON.stringify(result.result, null, 2)
                        : String(result.result);
                    this.addMessage('assistant', `Tool ${toolName} result:\n${resultStr}`);
                }
            } else {
                this.addMessage('assistant', `Failed to execute ${toolName}: ${result.error}`);
            }
        } catch (error) {
            console.error('Error enabling tool:', error);
            this.addMessage('assistant', `Error enabling ${toolName}: ${error.message}`);
        }
    }

    denyToolPermission() {
        this.addMessage('assistant', `I need permission to use that tool. You can enable it in the MCP settings if you'd like.`);
        this.closePermissionDialog();
    }

    closePermissionDialog() {
        const overlay = document.querySelector('.tool-permission-overlay');
        if (overlay) {
            overlay.remove();
        }
        this.currentPermissionRequest = null;
    }

    showNotification(message, type = 'success') {
        // Simple notification system
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem;
            border-radius: var(--border-radius);
            color: white;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        const bgColor = type === 'success' ? '#28a745' :
            type === 'error' ? '#dc3545' :
                type === 'info' ? '#17a2b8' : '#6c757d';

        notification.style.backgroundColor = bgColor;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Initialize main panel when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    window.mainPanel = new MainPanel();

    // Initialize API settings
    const llmProviderSelect = document.getElementById('llm-provider-select');
    const llmModelSelect = document.getElementById('llm-model-select');
    const providerSettingsContainer = document.getElementById('provider-settings-container');
    const llmConfigSaveButton = document.getElementById('llm-config-save-button');

    if (!llmProviderSelect || !llmModelSelect) return;

    llmProviderSelect.innerHTML = '<option disabled selected>Select a Provider...</option>';

    const loadModelsForProvider = async (provider, forceRefresh = false) => {
        if (!provider || provider === 'Select a Provider...') {
            llmModelSelect.innerHTML = '<option>Select a provider first</option>';
            return;
        }
        console.log('Loading models for:', provider);

        // Add loading spinner
        llmModelSelect.innerHTML = `
            <option disabled style="display: flex; align-items: center; gap: 8px;">
                <div class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(0,0,0,0.1); border-left-color: #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                Loading models...
            </option>
        `;

        try {
            const models = await window.electronAPI.llm.getModels(provider, forceRefresh);
            console.log('Models received:', models);
            llmModelSelect.innerHTML = '<option disabled selected>Select a Model...</option>';
            if (models && models.length > 0) {
                models.forEach(modelName => {
                    const option = document.createElement('option');
                    option.value = modelName;
                    option.textContent = modelName;
                    llmModelSelect.appendChild(option);
                });
            } else {
                llmModelSelect.innerHTML = '<option disabled>No models found</option>';
            }
        } catch (error) {
            console.error('Failed to load models:', error);
            llmModelSelect.innerHTML = '<option>Failed to load models</option>';
        }
    };

    // Add CSS animation for the spinner
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);

    const updateProviderSettings = async (provider) => {
        providerSettingsContainer.innerHTML = '';

        if (provider === 'openrouter') {
            providerSettingsContainer.innerHTML = `
                <label for="openrouter-key">OpenRouter API Key</label>
                <input type="password" id="openrouter-key" placeholder="sk-...">
            `;
        } else if (provider === 'qwen') {
            providerSettingsContainer.innerHTML = `
                <div style="margin-bottom: 10px;">
                    <label>
                        <input type="radio" name="qwen-mode" value="cli" checked> Use Qwen CLI
                    </label>
                    <label style="margin-left: 15px;">
                        <input type="radio" name="qwen-mode" value="api"> Use Qwen API
                    </label>
                    <label style="margin-left: 15px;">
                        <input type="radio" name="qwen-mode" value="oauth"> Use Qwen OAuth
                    </label>
                </div>
                <div id="qwen-cli-settings" style="margin-top: 10px;">
                    <p style="font-size: 0.9em; color: #666;">CLI mode will execute "qwen" command with your message</p>
                </div>
                <div id="qwen-api-settings" style="display: none; margin-top: 10px;">
                    <label for="qwen-key">API Key</label>
                    <input type="password" id="qwen-key" placeholder="sk-...">
                    <button type="button" id="verify-api-key" style="margin-top: 5px;">Verify Key</button>
                    <div id="qwen-api-status" style="margin-top: 5px; font-size: 0.9em;"></div>
                </div>
                <div id="qwen-oauth-settings" style="display: none; margin-top: 10px;">
                    <button type="button" id="qwen-fetch-oauth" style="margin-top: 5px;">Load OAuth Credentials</button>
                    <div id="qwen-oauth-status" style="margin-top: 5px; font-size: 0.9em;"></div>
                </div>
            `;

            // Add event listeners for radio buttons
            setTimeout(() => {
                const radios = document.getElementsByName('qwen-mode');
                const cliSettings = document.getElementById('qwen-cli-settings');
                const apiSettings = document.getElementById('qwen-api-settings');
                const oauthSettings = document.getElementById('qwen-oauth-settings');
                const fetchBtn = document.getElementById('qwen-fetch-oauth');
                const oauthStatus = document.getElementById('qwen-oauth-status');
                const applyQwenMode = async (mode, refresh = false) => {
                    if (cliSettings) cliSettings.style.display = mode === 'cli' ? 'block' : 'none';
                    if (apiSettings) apiSettings.style.display = mode === 'api' ? 'block' : 'none';
                    if (oauthSettings) oauthSettings.style.display = mode === 'oauth' ? 'block' : 'none';

                    llmModelSelect.disabled = false;
                    await loadModelsForProvider('qwen', refresh || mode === 'oauth');
                };

                radios.forEach(radio => {
                    radio.addEventListener('change', async (e) => {
                        await applyQwenMode(e.target.value, e.target.value === 'oauth');
                    });
                });

                if (fetchBtn) {
                    fetchBtn.addEventListener('click', async () => {
                        try {
                            const creds = await window.electronAPI.llm.fetchQwenOAuth();
                            if (creds) {
                                oauthStatus.textContent = '✓ OAuth credentials loaded';
                                oauthStatus.style.color = '#28a745';
                                window.mainPanel.showNotification('OAuth credentials loaded!');

                                // Fetch models dynamically
                                await applyQwenMode('oauth', true);
                            }
                        } catch (error) {
                            oauthStatus.textContent = '✗ Failed to load credentials';
                            oauthStatus.style.color = '#dc3545';
                            window.mainPanel.showNotification('Failed to load OAuth credentials', 'error');
                        }
                    });
                }

                // Add verification handler for API key
                const verifyBtn = document.getElementById('verify-api-key');
                if (verifyBtn) {
                    verifyBtn.addEventListener('click', async () => {
                        const apiKey = document.getElementById('qwen-key')?.value;
                        const statusDiv = document.getElementById('qwen-api-status');

                        if (!apiKey) {
                            statusDiv.textContent = 'Please enter an API key';
                            statusDiv.style.color = '#dc3545';
                            return;
                        }

                        // Show loading state
                        verifyBtn.disabled = true;
                        verifyBtn.textContent = 'Verifying...';
                        statusDiv.textContent = '';

                        try {
                            const result = await window.electronAPI.verifyQwenKey(apiKey);
                            if (result.success) {
                                statusDiv.textContent = `✓ Verified! Found ${result.modelCount} models`;
                                statusDiv.style.color = '#28a745';
                                window.mainPanel.showNotification('API key verified successfully');
                            } else {
                                statusDiv.textContent = `✗ ${result.error}`;
                                statusDiv.style.color = '#dc3545';
                                window.mainPanel.showNotification('API key verification failed', 'error');
                            }
                        } catch (error) {
                            statusDiv.textContent = '✗ Verification failed: ' + error.message;
                            statusDiv.style.color = '#dc3545';
                            window.mainPanel.showNotification('Verification error', 'error');
                        } finally {
                            verifyBtn.disabled = false;
                            verifyBtn.textContent = 'Verify Key';
                        }
                    });
                }

                // Apply initial mode from config/default
                const initialMode = document.querySelector('input[name="qwen-mode"]:checked')?.value || 'cli';
                applyQwenMode(initialMode, initialMode === 'oauth').catch(err => {
                    console.error('Failed to apply initial Qwen mode:', err);
                });
            }, 0);
        } else if (provider === 'lmstudio') {
            providerSettingsContainer.innerHTML = `
                <label for="lmstudio-url">LM Studio URL</label>
                <input type="text" id="lmstudio-url" placeholder="http://localhost:1234">
            `;
        }

        // Load saved settings
        try {
            const config = await window.electronAPI.llm.getConfig();
            if (config && config.provider === provider) {
                setTimeout(() => {
                    if (provider === 'openrouter' && config.apiKey) {
                        const input = document.getElementById('openrouter-key');
                        if (input) input.value = config.apiKey;
                    } else if (provider === 'qwen') {
                        // Set mode based on saved configuration (default to 'cli')
                        const mode = config.mode || (config.useOAuth ? 'oauth' : 'cli');
                        const modeRadio = document.querySelector(`input[name="qwen-mode"][value="${mode}"]`);
                        if (modeRadio) {
                            modeRadio.checked = true;
                            modeRadio.dispatchEvent(new Event('change'));
                        }

                        // Set API key if available
                        if (config.apiKey) {
                            const input = document.getElementById('qwen-key');
                            if (input) input.value = config.apiKey;
                        }
                        if (config.useOAuth) {
                            const oauthStatus = document.getElementById('qwen-oauth-status');
                            if (oauthStatus) {
                                oauthStatus.textContent = '✓ OAuth credentials configured';
                                oauthStatus.style.color = '#28a745';
                            }
                        }
                        if (config.model) {
                            const trySelectModel = () => {
                                if (Array.from(llmModelSelect.options).some(o => o.value === config.model)) {
                                    llmModelSelect.value = config.model;
                                }
                            };
                            setTimeout(trySelectModel, 150);
                            setTimeout(trySelectModel, 500);
                        }
                    } else if (provider === 'lmstudio' && config.url) {
                        const input = document.getElementById('lmstudio-url');
                        if (input) input.value = config.url;
                    }
                }, 0);
            }
        } catch (error) {
            console.error('Failed to load saved settings:', error);
        }
    };

    llmProviderSelect.addEventListener('change', async (event) => {
        const provider = event.target.value;
        console.log('Provider changed to:', provider);
        await updateProviderSettings(provider);
        if (provider && provider !== 'Select a Provider...' && provider !== 'qwen') {
            await loadModelsForProvider(provider);
        }
        // Show/hide custom model section for Ollama
        const customSection = document.getElementById('custom-model-section');
        if (customSection) {
            customSection.style.display = (provider === 'ollama') ? 'block' : 'none';
        }
    });

    // Custom model test button
    const testModelBtn = document.getElementById('test-custom-model-btn');
    if (testModelBtn) {
        testModelBtn.addEventListener('click', async () => {
            const customInput = document.getElementById('custom-model-input');
            const statusDiv = document.getElementById('custom-model-status');
            const modelName = customInput?.value?.trim();
            if (!modelName) {
                statusDiv.textContent = 'Please enter a model name';
                statusDiv.style.color = '#dc3545';
                return;
            }
            testModelBtn.disabled = true;
            testModelBtn.textContent = 'Testing...';
            statusDiv.textContent = '';
            try {
                const provider = llmProviderSelect.value || 'ollama';
                const result = await window.electronAPI.llm.testModel(provider, modelName);
                if (result.success) {
                    statusDiv.textContent = `✓ Model responds! (${result.model})`;
                    statusDiv.style.color = '#28a745';
                    // Add to dropdown if not already there
                    const exists = Array.from(llmModelSelect.options).some(o => o.value === modelName);
                    if (!exists) {
                        const opt = document.createElement('option');
                        opt.value = modelName;
                        opt.textContent = modelName;
                        llmModelSelect.appendChild(opt);
                    }
                    llmModelSelect.value = modelName;
                } else {
                    statusDiv.textContent = `✗ ${result.error}`;
                    statusDiv.style.color = '#dc3545';
                }
            } catch (err) {
                statusDiv.textContent = `✗ Test failed: ${err.message}`;
                statusDiv.style.color = '#dc3545';
            } finally {
                testModelBtn.disabled = false;
                testModelBtn.textContent = 'Test Model';
            }
        });
    }

    llmConfigSaveButton.addEventListener('click', async () => {
        const provider = llmProviderSelect.value;
        const model = llmModelSelect.value;

        // Validate provider
        if (!provider || provider === 'Select a Provider...') {
            alert('Please select a provider');
            return;
        }

        // Build config object
        const config = { provider };

        // Handle provider-specific settings
        if (provider === 'ollama') {
            if (!model || model === 'Select a Model...') {
                alert('Please select a model');
                return;
            }
            config.model = model;
        }
        else if (provider === 'openrouter') {
            const apiKey = document.getElementById('openrouter-key')?.value?.trim();
            if (!apiKey) {
                alert('Please enter OpenRouter API key');
                return;
            }
            config.apiKey = apiKey;
            if (model && model !== 'Select a Model...') config.model = model;
        }
        else if (provider === 'qwen') {
            const mode = document.querySelector('input[name="qwen-mode"]:checked')?.value;
            config.mode = mode;  // Save the mode (cli, api, oauth)
            config.useOAuth = mode === 'oauth';

            if (mode === 'api') {
                const apiKey = document.getElementById('qwen-key')?.value?.trim();
                if (!apiKey) {
                    alert('Please enter Qwen API key');
                    return;
                }
                config.apiKey = apiKey;

                // Model is required only for API mode
                if (!model || model === 'Select a Model...') {
                    alert('Please select a model (e.g., qwen-max, qwen-plus, qwen-turbo)');
                    return;
                }
            }
            if (mode === 'oauth') {
                if (!model || model === 'Select a Model...' || model === 'No models found') {
                    alert('Please load OAuth credentials and select a Qwen model');
                    return;
                }
            }

            // For CLI mode, model is optional; for API/OAuth it should be selected
            if (model && model !== 'Select a Model...') {
                config.model = model;
            }
        }
        else if (provider === 'lmstudio') {
            if (!model || model === 'Select a Model...') {
                alert('Please select a model');
                return;
            }
            config.model = model;
            const url = document.getElementById('lmstudio-url')?.value?.trim();
            if (url) config.url = url;
        }

        // Save configuration
        try {
            await window.electronAPI.llm.saveConfig(config);

            // Display current config
            const display = document.getElementById('current-config-display');
            const text = document.getElementById('current-config-text');
            if (display && text) {
                display.style.display = 'block';
                const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
                if (config.model) {
                    text.textContent = `Provider: ${providerName}, Model: "${config.model}"`;
                } else {
                    text.textContent = `Provider: ${providerName} (OAuth)`;
                }
            }

            window.mainPanel.showNotification('Configuration saved!');
        } catch (error) {
            console.error('Save error:', error);
            window.mainPanel.showNotification('Failed to save: ' + error.message, 'error');
        }
    });

    try {
        const providers = await window.electronAPI.getProviders();
        providers.forEach(provider => {
            const option = document.createElement('option');
            option.value = provider;
            option.textContent = provider.charAt(0).toUpperCase() + provider.slice(1);
            llmProviderSelect.appendChild(option);
        });

        // Load saved configuration
        const config = await window.electronAPI.llm.getConfig();
        if (config && config.provider) {
            llmProviderSelect.value = config.provider;
            await updateProviderSettings(config.provider);
            if (config.provider !== 'qwen') {
                await loadModelsForProvider(config.provider);
            }
            if (config.model && Array.from(llmModelSelect.options).some(o => o.value === config.model)) {
                llmModelSelect.value = config.model;
            }

            // Display current config
            const configDisplay = document.getElementById('current-config-display');
            const configText = document.getElementById('current-config-text');
            if (configDisplay && configText && config.model) {
                configDisplay.style.display = 'block';
                const providerName = config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
                configText.textContent = `Provider: ${providerName}, Model: "${config.model}"`;
            }
        }

        // Initialize chat provider/model selects (compact version in chat input)
        const chatProviderSelect = document.getElementById('chat-provider-select');
        const chatModelSelect = document.getElementById('chat-model-select');

        if (chatProviderSelect && chatModelSelect) {
            // Populate chat provider select
            chatProviderSelect.innerHTML = '';
            providers.forEach(provider => {
                const option = document.createElement('option');
                option.value = provider;
                option.textContent = provider.charAt(0).toUpperCase() + provider.slice(1);
                chatProviderSelect.appendChild(option);
            });

            // Sync with saved config
            if (config && config.provider) {
                chatProviderSelect.value = config.provider;
            }

            // Function to sync model options to chat select
            const syncModelsToChat = () => {
                chatModelSelect.innerHTML = '';
                Array.from(llmModelSelect.options).forEach(opt => {
                    const newOpt = document.createElement('option');
                    newOpt.value = opt.value;
                    newOpt.textContent = opt.textContent;
                    newOpt.disabled = opt.disabled;
                    newOpt.selected = opt.selected;
                    chatModelSelect.appendChild(newOpt);
                });
            };

            // Initial sync
            syncModelsToChat();

            // Function to save config when changed
            const saveCurrentConfig = async () => {
                const provider = chatProviderSelect.value;
                const model = chatModelSelect.value;
                if (provider && model && model !== 'Select a Model...' && model !== 'Select a provider first') {
                    const config = { provider, model };
                    if (provider === 'qwen') {
                        const qwenMode = document.querySelector('input[name="qwen-mode"]:checked')?.value;
                        if (qwenMode) {
                            config.mode = qwenMode;
                            config.useOAuth = qwenMode === 'oauth';
                        }
                    }
                    await window.electronAPI.llm.saveConfig(config);
                    window.mainPanel.showNotification(`Switched to ${model}`, 'info');
                }
            };

            // Chat provider change -> sync to API tab and load models
            chatProviderSelect.addEventListener('change', async (e) => {
                const provider = e.target.value;
                llmProviderSelect.value = provider;
                await updateProviderSettings(provider);
                if (provider !== 'qwen') {
                    await loadModelsForProvider(provider);
                }
                syncModelsToChat();
            });

            // Chat model change -> sync to API tab and save
            chatModelSelect.addEventListener('change', async (e) => {
                llmModelSelect.value = e.target.value;
                await saveCurrentConfig();
            });

            // API tab provider change -> sync to chat
            llmProviderSelect.addEventListener('change', () => {
                chatProviderSelect.value = llmProviderSelect.value;
                // Models will be loaded by existing handler, then synced via MutationObserver
            });

            // Watch for model list changes in API tab and sync to chat
            const modelObserver = new MutationObserver(() => {
                syncModelsToChat();
            });
            modelObserver.observe(llmModelSelect, { childList: true });

            // API tab model change -> sync to chat
            llmModelSelect.addEventListener('change', () => {
                chatModelSelect.value = llmModelSelect.value;
            });
        }
    } catch (error) {
        console.error('Failed to initialize API settings:', error);
    }

    // Load previous chat after all initialization is complete
    await window.mainPanel.initializeSession();
});
