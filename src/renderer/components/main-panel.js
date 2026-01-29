class MainPanel {
    constructor() {
        this.isSending = false;
        this.attachedFiles = [];
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.autoSpeak = false;
        
        // Initialize immediately since we're already in DOMContentLoaded
        this.initializeEvents();
        this.initializeVoice();
        this.initContextSettings();
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
        const messageInput = document.getElementById('message-input');
        const newChatBtn = document.getElementById('new-chat-btn');
        const attachBtn = document.getElementById('attach-btn');
        const voiceBtn = document.getElementById('voice-btn');
        const speakBtn = document.getElementById('speak-btn');
        const dropZone = document.getElementById('drop-zone');
        
        sendBtn.addEventListener('click', () => this.sendMessage());
        if (newChatBtn) newChatBtn.addEventListener('click', () => this.newChat());
        attachBtn.addEventListener('click', () => this.attachFile());
        voiceBtn.addEventListener('click', () => this.toggleVoiceInput());
        speakBtn.addEventListener('click', () => this.toggleAutoSpeak());
        
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
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
        const message = messageInput.value.trim();
        
        if (!message && this.attachedFiles.length === 0) return;

        // Add user message to UI immediately
        if (message) this.addMessage('user', message);
        messageInput.value = '';
        this.attachedFiles = [];
        document.querySelectorAll('.attached-file').forEach(el => el.remove());
        messageInput.focus();

        // Add loading indicator
        const loadingId = this.addMessage('assistant', '...');

        // Send async - don't block input
        window.electronAPI.sendMessage(message)
            .then(response => {
                this.removeMessage(loadingId);
                this.addMessage('assistant', response.content);
                this.updateContextUsage(response);
                if (this.autoSpeak) this.speakText(response.content);
            })
            .catch(error => {
                console.error('Error sending message:', error);
                this.removeMessage(loadingId);
                this.addMessage('system', `Error: ${error.message}`);
            });
    }

    addMessage(role, content) {
        const messagesContainer = document.getElementById('messages-container');
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${role}`;
        
        const messageDiv = document.createElement('div');
        const messageId = `msg-${Date.now()}-${Math.random()}`;
        messageDiv.id = messageId;
        messageDiv.className = `message ${role}`;
        messageDiv.textContent = content;
        
        messageWrapper.appendChild(messageDiv);
        
        // Add speak button outside bubble for assistant messages
        if (role === 'assistant' && content !== '...') {
            const speakIcon = document.createElement('button');
            speakIcon.className = 'message-speak-btn';
            speakIcon.innerHTML = '🔊';
            speakIcon.title = 'Speak this message';
            speakIcon.onclick = (e) => {
                e.stopPropagation();
                this.speakText(content);
            };
            messageWrapper.appendChild(speakIcon);
        }
        
        messagesContainer.appendChild(messageWrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return messageId;
    }
    
    addMessageWithAttachment(role, content, attachment) {
        const messagesContainer = document.getElementById('messages-container');
        const messageDiv = document.createElement('div');
        const messageId = `msg-${Date.now()}-${Math.random()}`;
        messageDiv.id = messageId;
        messageDiv.className = `message ${role}`;
        
        // Create attachment icon
        const attachmentIcon = document.createElement('span');
        attachmentIcon.className = 'attachment-icon';
        const icons = {
            image: '🖼️',
            audio: '🎵',
            document: '📄'
        };
        attachmentIcon.innerHTML = icons[attachment.type] || '📎';
        attachmentIcon.title = attachment.name;
        
        // Create text content
        const textSpan = document.createElement('span');
        textSpan.textContent = content;
        
        messageDiv.appendChild(attachmentIcon);
        messageDiv.appendChild(textSpan);
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return messageId;
    }

    removeMessage(messageId) {
        const messageDiv = document.getElementById(messageId);
        if (messageDiv) messageDiv.remove();
    }

    updateContextUsage(response) {
        const contextDiv = document.getElementById('context-usage');
        if (!contextDiv) return;
        
        if (!response || !response.usage) {
            contextDiv.textContent = '';
            return;
        }
        
        const { prompt_tokens, total_tokens } = response.usage;
        const contextLength = response.context_length || 4096;
        
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

    async newChat() {
        try {
            await window.electronAPI.clearConversations();
            document.getElementById('messages-container').innerHTML = '';
            if (window.sidebar) window.sidebar.loadChatSessions();
            this.showNotification('New chat started');
        } catch (error) {
            console.error('Error starting new chat:', error);
            this.showNotification('Error: ' + error.message, 'error');
        }
    }

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
        
        // Load saved setting
        window.electronAPI.getSetting('context_window')
            .then(savedValue => {
                if (savedValue) {
                    console.log('✓ Loaded saved value:', savedValue);
                    contextSlider.value = savedValue;
                    this.updateContextDisplay(savedValue);
                }
            })
            .catch(error => {
                console.error('✗ Error loading setting:', error);
            });
    }
    
    async saveContextSize(value) {
        try {
            console.log('Saving:', value);
            await window.electronAPI.setContextSetting(parseInt(value));
            console.log('Saved successfully');
            this.showNotification(`Saved: ${value} tokens`);
        } catch (error) {
            console.error('Save error:', error);
            this.showNotification(`Save failed: ${error.message}`, 'error');
        }
    }
    
    updateContextDisplay(value) {
        const numValue = parseInt(value);
        const contextDisplay = document.getElementById('context-display');
        if (!contextDisplay) return;
        
        const wordEstimate = Math.round(numValue / 1.37);
        contextDisplay.textContent = `${numValue} tokens (≈${wordEstimate} words)`;
        console.log('✓ Display updated:', numValue);
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
        try {
            const sessions = await window.electronAPI.getChatSessions(null, 1);
            
            if (sessions && sessions.length > 0) {
                const sessionId = sessions[0].id;
                await window.electronAPI.switchChatSession(sessionId);
                
                const conversations = await window.electronAPI.loadChatSession(sessionId);
                const messagesContainer = document.getElementById('messages-container');
                if (!messagesContainer) return;
                
                messagesContainer.innerHTML = '';
                
                // Match sidebar's approach - create simple message divs
                conversations.forEach(conv => {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = `message ${conv.role}`;
                    messageDiv.textContent = conv.content;
                    messagesContainer.appendChild(messageDiv);
                });
                
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                await this.calculateContextUsage();
            }
        } catch (error) {
            console.error('Error initializing session:', error);
        }
    }

    async loadConversations() {
        try {
            const conversations = await window.electronAPI.getConversations();
            const messagesContainer = document.getElementById('messages-container');
            messagesContainer.innerHTML = '';

            conversations.forEach(conv => {
                this.addMessage(conv.role, conv.content);
            });
            
            // Calculate context after loading
            await this.calculateContextUsage();
        } catch (error) {
            console.error('Error loading conversations:', error);
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
        try {
            // Execute tool once without changing state
            const result = await window.electronAPI.executeMCPToolOnce(this.currentPermissionRequest.toolName, this.currentPermissionRequest.params);

            // Handle the result like normal
            if (result.success) {
                this.addMessage('assistant', `Executed ${toolName} once: ${JSON.stringify(result.result, null, 2)}`);
            } else {
                this.addMessage('assistant', `Failed to execute ${toolName}: ${result.error}`);
            }

            this.updateContextUsage(result);
            if (this.autoSpeak) this.speakText(result.content);

            this.closePermissionDialog();
        } catch (error) {
            console.error('Error allowing tool once:', error);
            this.closePermissionDialog();
        }
    }

    async enableTool(toolName) {
        try {
            await window.electronAPI.setToolActive(toolName, true);

            // Refresh the tool list to show updated state
            if (window.sidebar && window.sidebar.loadMCPTools) {
                await window.sidebar.loadMCPTools();
            }

            this.showNotification(`✅ ${toolName} enabled permanently`);

            // Now execute the tool
            await this.allowToolOnce(toolName);
        } catch (error) {
            console.error('Error enabling tool:', error);
            this.closePermissionDialog();
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

    const loadModelsForProvider = async (provider) => {
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
            const models = await window.electronAPI.llm.getModels(provider);
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
            `;
            
            // Add event listeners for radio buttons
            setTimeout(() => {
                const radios = document.getElementsByName('qwen-mode');
                const apiSettings = document.getElementById('qwen-api-settings');
                const oauthSettings = document.getElementById('qwen-oauth-settings');
                const fetchBtn = document.getElementById('qwen-fetch-oauth');
                const oauthStatus = document.getElementById('qwen-oauth-status');
                
                radios.forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        if (e.target.value === 'oauth') {
                            oauthSettings.style.display = 'block';
                            apiSettings.style.display = 'none';
                        } else {
                            apiSettings.style.display = 'none';
                            oauthSettings.style.display = 'block';
                        }
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
                                llmModelSelect.innerHTML = '<option>Loading models...</option>';
                                try {
                                    const models = await window.electronAPI.llm.getModels('qwen');
                                    llmModelSelect.innerHTML = '<option disabled selected>Select a Model...</option>';
                                    if (models && models.length > 0) {
                                        models.forEach(modelName => {
                                            const option = document.createElement('option');
                                            option.value = modelName;
                                            option.textContent = modelName;
                                            llmModelSelect.appendChild(option);
                                        });
                                        window.mainPanel.showNotification(`Loaded ${models.length} models`);
                                    }
                                } catch (err) {
                                    console.error('Failed to load models:', err);
                                }
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
                        const apiKey = document.getElementById('qwen-key').value;
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
                        const mode = config.mode || 'cli';
                        const modeRadio = document.querySelector(`input[name="qwen-mode"][value="${mode}"]`);
                        if (modeRadio) modeRadio.checked = true;
                        
                        // Show appropriate settings
                        const apiSettings = document.getElementById('qwen-api-settings');
                        const cliSettings = document.getElementById('qwen-cli-settings');
                        if (apiSettings) apiSettings.style.display = mode === 'api' ? 'block' : 'none';
                        if (cliSettings) cliSettings.style.display = mode === 'cli' ? 'block' : 'none';
                        
                        // Set API key if available
                        if (config.apiKey) {
                            const input = document.getElementById('qwen-key');
                            if (input) input.value = config.apiKey;
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
        if (provider && provider !== 'Select a Provider...') {
            await loadModelsForProvider(provider);
        }
    });

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
                    config.mode = mode;  // Save the mode (cli or api)
                    
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
                    // For CLI mode, model is not required
                    config.model = model;
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
            await loadModelsForProvider(config.provider);
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
    } catch (error) {
        console.error('Failed to initialize API settings:', error);
    }
    
    // Load previous chat after all initialization is complete
    await window.mainPanel.initializeSession();
});
