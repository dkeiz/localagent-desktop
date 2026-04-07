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

    async clearCurrentChat() {
        return window.mainPanelTabs.clearCurrentChat(this);
    }

    async newChat() {
        return window.mainPanelTabs.newChat(this);
    }

    async openAgentChat(agentId, sessionId, agent) {
        return window.mainPanelTabs.openAgentChat(this, agentId, sessionId, agent);
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
