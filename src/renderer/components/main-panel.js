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
        this._autocompleteVisible = false;
        this._autocompleteItems = [];
        this._autocompleteIndex = 0;
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
        const messagesContainer = document.getElementById('messages-container');
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
        attachBtn.addEventListener('click', () => this.attachFile());
        voiceBtn.addEventListener('click', () => this.toggleVoiceInput());
        speakBtn.addEventListener('click', () => this.toggleAutoSpeak());
        messageInput.addEventListener('keypress', (e) => {
            if (this._autocompleteVisible && e.key === 'Enter') {
                e.preventDefault();
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.hideCommandAutocomplete();
                this.sendMessage();
            }
        });
        // Autocomplete for /commands
        messageInput.addEventListener('input', () => {
            const val = messageInput.value;
            if (!val.startsWith('/') || val.includes(' ')) {
                this.hideCommandAutocomplete();
                return;
            }

            const completions = val === '/'
                ? this.commandHandler.getAllCommands(10)
                : this.commandHandler.getCompletions(val, 10);
            this.showCommandAutocomplete(completions);
        });
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideCommandAutocomplete();
                return;
            }
            if (!this._autocompleteVisible) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveCommandAutocomplete(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveCommandAutocomplete(-1);
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                this.acceptHighlightedAutocomplete();
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.acceptHighlightedAutocomplete();
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
        if (messagesContainer) {
            messagesContainer.addEventListener('scroll', () => this._storeActiveTabScrollState());
            messagesContainer.addEventListener('click', (event) => {
                const image = event.target.closest('.chat-image');
                if (!image) return;
                const lightboxSrc = image.getAttribute('data-lightbox-src') || image.getAttribute('src');
                if (lightboxSrc) {
                    this._openLightbox(lightboxSrc);
                }
            });
        }
        window.addEventListener('keydown', (event) => {
            if (event.key !== 'PageDown') return;
            if (this._shouldIgnorePagingTarget(event.target)) return;
            event.preventDefault();
            this._pageDownMessages();
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
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `📎 ${fileName}`;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-file';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Remove attachment';
        removeBtn.addEventListener('click', () => fileDiv.remove());
        fileDiv.appendChild(nameSpan);
        fileDiv.appendChild(removeBtn);
        container.insertBefore(fileDiv, container.firstChild);
    }
    async sendMessage() {
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        const message = messageInput.value.trim();
        if (this.activeTabId === 'subagent-manager') {
            this.showNotification('Subagent Manager tab is view-only. Open a chat tab to send messages.', 'info');
            return;
        }
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
        const shouldFollow = !this._suspendMessageAutoscroll && this._shouldAutoScroll(role === 'user' || content === '...');
        this._renderMessageBody(messageDiv, role, content, style);
        messageWrapper.appendChild(messageDiv);
        // Add speak button outside bubble for assistant messages
        if (role === 'assistant' && content !== '...') {
            const speakIcon = document.createElement('button');
            speakIcon.className = 'message-speak-btn';
            speakIcon.textContent = '🔊';
            speakIcon.title = 'Speak this message';
            speakIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                this.speakText(content.replace(/<think>[\s\S]*?<\/think>/g, '').trim());
            });
            messageWrapper.appendChild(speakIcon);
        }
        messagesContainer.appendChild(messageWrapper);
        if (shouldFollow) {
            this._scrollMessagesToLatest(true);
        } else {
            this._storeActiveTabScrollState();
        }
        return messageId;
    }
    _openLightbox(src) {
        // Remove existing lightbox
        const existing = document.getElementById('image-lightbox');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'image-lightbox';
        overlay.className = 'image-lightbox';
        overlay.addEventListener('click', () => overlay.remove());
        const image = document.createElement('img');
        image.src = src;
        image.alt = 'Enlarged image';
        image.addEventListener('click', (event) => event.stopPropagation());
        overlay.appendChild(image);
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
        this._autocompleteItems = completions.slice(0, 10);
        this._autocompleteIndex = Math.min(
            this._autocompleteIndex,
            Math.max(0, this._autocompleteItems.length - 1)
        );
        dropdown.innerHTML = '';
        this._autocompleteItems.forEach((c, index) => {
            const item = document.createElement('div');
            item.className = `cmd-autocomplete-item${index === this._autocompleteIndex ? ' active' : ''}`;
            const nameSpan = document.createElement('span');
            nameSpan.className = 'cmd-name';
            nameSpan.textContent = c.name;
            const descSpan = document.createElement('span');
            descSpan.className = 'cmd-desc';
            descSpan.textContent = c.description;
            item.appendChild(nameSpan);
            item.appendChild(descSpan);
            item.addEventListener('mousedown', (event) => {
                event.preventDefault();
                this.acceptHighlightedAutocomplete(index);
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
        this._autocompleteItems = [];
        this._autocompleteIndex = 0;
    }
    moveCommandAutocomplete(step) {
        if (!this._autocompleteVisible || this._autocompleteItems.length === 0) return;
        const total = this._autocompleteItems.length;
        this._autocompleteIndex = (this._autocompleteIndex + step + total) % total;
        const dropdown = document.getElementById('cmd-autocomplete');
        if (!dropdown) return;
        const items = dropdown.querySelectorAll('.cmd-autocomplete-item');
        items.forEach((item, index) => item.classList.toggle('active', index === this._autocompleteIndex));
        const activeItem = items[this._autocompleteIndex];
        if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest' });
        }
    }
    acceptHighlightedAutocomplete(index = this._autocompleteIndex) {
        const choice = this._autocompleteItems[index];
        if (choice) {
            const input = document.getElementById('message-input');
            input.value = `${choice.name} `;
            input.focus();
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
        const shouldFollow = !this._suspendMessageAutoscroll && this._shouldAutoScroll(true);
        // For images, show inline preview
        if (attachment.type === 'image' && attachment.path) {
            const image = document.createElement('img');
            image.src = `file://${attachment.path}`;
            image.className = 'chat-image';
            image.alt = attachment.name || 'Attached image';
            image.title = 'Click to enlarge';
            image.dataset.lightboxSrc = image.src;
            const text = document.createElement('span');
            text.textContent = content;
            messageDiv.appendChild(image);
            messageDiv.appendChild(document.createElement('br'));
            messageDiv.appendChild(text);
        } else {
            // Create attachment icon
            const icons = { image: '🖼️', audio: '🎵', document: '📄' };
            const icon = document.createElement('span');
            icon.className = 'attachment-icon';
            icon.title = attachment.name || 'Attachment';
            icon.textContent = icons[attachment.type] || '📎';
            const text = document.createElement('span');
            text.textContent = content;
            messageDiv.appendChild(icon);
            messageDiv.appendChild(document.createTextNode(' '));
            messageDiv.appendChild(text);
        }
        messageWrapper.appendChild(messageDiv);
        messagesContainer.appendChild(messageWrapper);
        if (shouldFollow) {
            this._scrollMessagesToLatest(true);
        } else {
            this._storeActiveTabScrollState();
        }
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
    _renderMessageBody(messageDiv, role, content, style) {
        if (style === 'terminal') {
            messageDiv.classList.add('terminal-output');
        }
        if (role === 'assistant' && content === '...') {
            messageDiv.classList.add('loading');
            messageDiv.textContent = content;
            return;
        }
        messageDiv.classList.remove('loading');
        if (window.messageFormatter) {
            window.messageFormatter.renderInto(messageDiv, {
                role,
                content,
                style,
                thinkingVisibility: this._thinkingVisibility || 'show'
            });
            return;
        }
        messageDiv.textContent = String(content || '');
    }
    _getMessagesContainer() {
        return document.getElementById('messages-container');
    }
    _isNearBottom(container) {
        if (!container) return true;
        const distance = container.scrollHeight - (container.scrollTop + container.clientHeight);
        return distance <= 48;
    }
    _shouldAutoScroll(force = false) {
        if (force) return true;
        const tab = this.activeTabId ? this.chatTabs.get(this.activeTabId) : null;
        if (tab && tab.followOutput === false) {
            return false;
        }
        return this._isNearBottom(this._getMessagesContainer());
    }
    _storeActiveTabScrollState() {
        if (!this.activeTabId || !this.chatTabs.has(this.activeTabId)) {
            return;
        }
        const container = this._getMessagesContainer();
        if (!container) {
            return;
        }
        const tab = this.chatTabs.get(this.activeTabId);
        tab.scrollTop = container.scrollTop;
        tab.followOutput = this._isNearBottom(container);
    }
    _scrollMessagesToLatest(force = false) {
        if (this._suspendMessageAutoscroll) {
            return;
        }
        const container = this._getMessagesContainer();
        if (!container) {
            return;
        }
        if (!force && !this._shouldAutoScroll(false)) {
            this._storeActiveTabScrollState();
            return;
        }
        container.scrollTop = container.scrollHeight;
        this._storeActiveTabScrollState();
    }
    _shouldIgnorePagingTarget(target) {
        if (!target) return false;
        const tagName = target.tagName ? target.tagName.toLowerCase() : '';
        return tagName === 'input'
            || tagName === 'textarea'
            || tagName === 'select'
            || target.isContentEditable === true;
    }
    _pageDownMessages() {
        const container = this._getMessagesContainer();
        if (!container) {
            return;
        }
        const increment = Math.max(container.clientHeight - 72, 120);
        container.scrollTop = Math.min(container.scrollTop + increment, container.scrollHeight);
        if (this._isNearBottom(container)) {
            container.scrollTop = container.scrollHeight;
        }
        this._storeActiveTabScrollState();
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
            const contextLength = parseInt(await window.electronAPI.getSetting('context_window'), 10)
                || 8192;
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
    async clearCurrentChat() {
        return window.mainPanelTabs.clearCurrentChat(this);
    }
    async newChat() {
        return window.mainPanelTabs.newChat(this);
    }
    async openAgentChat(agentId, sessionId, agent, options = {}) {
        return window.mainPanelTabs.openAgentChat(this, agentId, sessionId, agent, options);
    }
    async ensureSubagentChat(eventPayload, options = {}) {
        return window.mainPanelTabs.ensureSubagentChat(this, eventPayload, options);
    }
    async updateSubagentChatState(eventPayload) {
        return window.mainPanelTabs.updateSubagentChatState(this, eventPayload);
    }
    async openSubagentManagerTab() {
        return window.mainPanelTabs.openSubagentManagerTab(this);
    }
    async refreshSubagentManagerTab() {
        return window.mainPanelTabs.refreshSubagentManagerTab(this);
    }
    openNewWindow() {
        return window.mainPanelTabs.openNewWindow();
    }
    async restoreOpenTabs() {
        return window.mainPanelTabs.restoreOpenTabs(this);
    }
    async autoTitleTab(sessionId) {
        return window.mainPanelTabs.autoTitleTab(this, sessionId);
    }
    saveCurrentTabMessages() {
        return window.mainPanelTabs.saveCurrentTabMessages(this);
    }
    async switchTab(sessionId) {
        return window.mainPanelTabs.switchTab(this, sessionId);
    }
    async loadTabConversations(sessionId) {
        return window.mainPanelTabs.loadTabConversations(this, sessionId);
    }
    async closeTab(sessionId) {
        return window.mainPanelTabs.closeTab(this, sessionId);
    }
    renderTabs() {
        return window.mainPanelTabs.renderTabs(this);
    }
    async saveOpenTabIds() {
        return window.mainPanelTabs.saveOpenTabIds(this);
    }
    // Context preset mapping: slider index → token value
    static CONTEXT_PRESETS = [4096, 8192, 16384, 32768, 49152, 65536, 98304, 131072, 196608, 262144];
    static CONTEXT_LABELS = ['4K', '8K', '16K', '32K', '48K', '64K', '96K', '128K', '192K', '256K'];
    static getContextPresetIndex(value) {
        const target = parseInt(value, 10);
        if (!Number.isFinite(target) || target <= 0) return 1;
        return MainPanel.CONTEXT_PRESETS.reduce((bestIndex, preset, index) => {
            const bestValue = MainPanel.CONTEXT_PRESETS[bestIndex];
            return Math.abs(preset - target) < Math.abs(bestValue - target) ? index : bestIndex;
        }, 1);
    }
    static formatContextValue(tokens) {
        const value = parseInt(tokens, 10);
        if (!Number.isFinite(value) || value <= 0) return 'Unknown';
        if (value >= 1000) {
            const compact = value % 1000 === 0 ? (value / 1000).toFixed(0) : (value / 1000).toFixed(1);
            return `${compact}K`;
        }
        return `${value}`;
    }
    async loadSelectedContextSetting() {
        try {
            const savedValue = await window.electronAPI.getSetting('context_window');
            const parsedValue = parseInt(savedValue, 10);
            this._selectedContextSetting = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 8192;
        } catch (error) {
            this._selectedContextSetting = 8192;
        }
        return this._selectedContextSetting;
    }
    applyContextProfile(profile) {
        const section = document.getElementById('context-window-section');
        const configurableControl = document.getElementById('context-window-configurable');
        const readonlyControl = document.getElementById('context-window-readonly');
        const contextSlider = document.getElementById('context-slider');
        if (!section || !configurableControl || !readonlyControl || !contextSlider) {
            return;
        }

        if (!profile?.spec?.model) {
            this._apiContextProfile = null;
            section.style.display = 'none';
            configurableControl.style.display = 'none';
            readonlyControl.style.display = 'none';
            return;
        }

        this._apiContextProfile = profile;
        const contextCaps = profile.spec.capabilities?.contextWindow || {};
        const contextValue = contextCaps.configurable
            ? (this._selectedContextSetting || MainPanel.CONTEXT_PRESETS[parseInt(contextSlider.value, 10)] || 8192)
            : (profile.runtimeConfig?.contextWindow?.value
                || profile.spec.runtime?.contextWindow?.value)
            || 8192;

        if (!contextCaps.supported && !contextCaps.configurable) {
            section.style.display = 'none';
            configurableControl.style.display = 'none';
            readonlyControl.style.display = 'none';
            return;
        }

        section.style.display = 'block';

        if (contextCaps.configurable) {
            const bestIndex = MainPanel.getContextPresetIndex(contextValue);
            configurableControl.style.display = 'block';
            readonlyControl.style.display = 'none';
            contextSlider.disabled = false;
            contextSlider.value = bestIndex;
            this.updateContextDisplay(bestIndex);
            return;
        }

        configurableControl.style.display = 'none';
        readonlyControl.style.display = 'block';
        readonlyControl.textContent = `Context Window: ${MainPanel.formatContextValue(contextValue)} (${Number(contextValue).toLocaleString()} tokens)`;
    }
    initContextSettings() {
        const contextSlider = document.getElementById('context-slider');
        const contextDisplay = document.getElementById('context-display');
        if (!contextSlider || !contextDisplay) {
            console.warn('Context slider elements not found');
            return;
        }
        console.log('✓ Context slider found, initializing...');
        this.loadSelectedContextSetting()
            .then(contextValue => {
                const bestIdx = MainPanel.getContextPresetIndex(contextValue);
                contextSlider.value = bestIdx;
                this.updateContextDisplay(bestIdx);
                return window.electronAPI.llm.getConfig();
            })
            .then(config => {
                if (config?.modelSpec && config?.runtimeConfig) {
                    this.applyContextProfile({
                        spec: config.modelSpec,
                        runtimeConfig: config.runtimeConfig
                    });
                }
            })
            .catch(error => {
                console.error('✗ Error loading context setting:', error);
            });
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
            await window.electronAPI.setContextSetting(value);
            this._selectedContextSetting = value;
            if (this._apiContextProfile) {
                this.applyContextProfile(this._apiContextProfile);
            }
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
        window.electronAPI.onBackgroundEvent(async (event, bgEvent) => {
            if (!bgEvent || !bgEvent.type || !bgEvent.payload) return;
            const type = bgEvent.type;
            const payload = bgEvent.payload || {};
            const mode = String(payload.subagentMode || payload.subagent_mode || 'no_ui').toLowerCase();
            if (!type.startsWith('subagent:')) return;
            const childSessionId = payload.childSessionId || payload.child_session_id;
            const hasExistingTab = childSessionId ? this.chatTabs.has(childSessionId) : false;
            try {
                if (type === 'subagent:queued' || type === 'subagent:started') {
                    if (mode === 'ui' || hasExistingTab) {
                        await this.ensureSubagentChat({ ...payload, __eventType: type }, { activate: false });
                    }
                } else if (type === 'subagent:completed' || type === 'subagent:failed') {
                    await this.updateSubagentChatState({ ...payload, __eventType: type });
                }
            } catch (error) {
                console.error('Failed to process subagent background event:', error);
            }
            try {
                await this.refreshSubagentManagerTab();
            } catch (error) {
                console.error('Failed to refresh Subagent Manager tab:', error);
            }
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
        return window.mainPanelPermissions.showToolPermissionDialog(this, request);
    }
    async approveToolCreation() {
        return window.mainPanelPermissions.approveToolCreation(this);
    }
    denyToolCreation() {
        return window.mainPanelPermissions.denyToolCreation(this);
    }
    async allowToolOnce(toolName) {
        return window.mainPanelPermissions.allowToolOnce(this, toolName);
    }
    async enableTool(toolName) {
        return window.mainPanelPermissions.enableTool(this, toolName);
    }
    denyToolPermission() {
        return window.mainPanelPermissions.denyToolPermission(this);
    }
    closePermissionDialog() {
        return window.mainPanelPermissions.closePermissionDialog(this);
    }
    showNotification(message, type = 'success') {
        return window.mainPanelPermissions.showNotification(message, type);
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    window.mainPanel = new MainPanel();
    if (typeof window.initializeApiProviderSettings === 'function') {
        try {
            await window.initializeApiProviderSettings(window.mainPanel);
        } catch (error) {
            console.error('Failed to initialize API provider settings module:', error);
        }
    } else {
        console.warn('API provider settings module not loaded');
    }
    await window.mainPanel.initializeSession();
});
