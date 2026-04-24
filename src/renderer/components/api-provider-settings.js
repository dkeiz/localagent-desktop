(function () {
    function providerLabel(provider, providerProfileMap) {
        return providerProfileMap[provider]?.label || (provider.charAt(0).toUpperCase() + provider.slice(1));
    }

    function prettyChannelLabel(value) {
        const labels = {
            none: 'not exposed',
            inline: 'inline',
            separate: 'separate'
        };
        return labels[value] || value || 'unknown';
    }

    function visibilityOptionsFor(reasoningCaps) {
        const supportedModes = Array.isArray(reasoningCaps?.visibilityModes) && reasoningCaps.visibilityModes.length
            ? reasoningCaps.visibilityModes
            : ['show', 'min', 'hide'];
        const labels = {
            show: 'Expanded',
            min: 'Collapsed',
            hide: 'Hidden'
        };

        return supportedModes.map(value => ({
            value,
            label: labels[value] || value
        }));
    }

    function setCurrentConfigLabel(configDisplay, configText, config) {
        if (!configDisplay || !configText) return;

        if (!config?.provider) {
            configDisplay.style.display = 'none';
            return;
        }

        configDisplay.style.display = 'block';
        const providerName = config.providerLabel || config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
        configText.textContent = config.model
            ? `Provider: ${providerName}, Model: "${config.model}"`
            : `Provider: ${providerName}`;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function providerFieldId(fieldId) {
        return `provider-field-${fieldId}`;
    }

    function renderGenericProviderSettings(profile, connection = {}) {
        const fields = Array.isArray(profile?.settings?.connectionFields)
            ? profile.settings.connectionFields
            : [];

        const fieldMarkup = fields.map(field => {
            const isSecret = field.id === 'apiKey' || field.type === 'password';
            const configured = Boolean(connection[`${field.id}Configured`] || (field.id === 'apiKey' && connection.apiKeyConfigured));
            const value = isSecret ? '' : (connection[field.id] ?? field.defaultValue ?? '');
            const placeholder = configured
                ? 'Configured - enter a new value to replace'
                : (field.placeholder || '');
            const helpMarkup = field.helpText
                ? `<div class="config-help">${escapeHtml(field.helpText)}</div>`
                : '';
            const statusMarkup = configured
                ? `<div class="config-help">Secret is saved securely and hidden here.</div>`
                : '';

            return `
                <div class="config-field">
                    <label for="${providerFieldId(field.id)}">${escapeHtml(field.label)}</label>
                    <input
                        type="${field.type === 'password' ? 'password' : 'text'}"
                        id="${providerFieldId(field.id)}"
                        data-secret-field="${isSecret ? 'true' : 'false'}"
                        data-configured="${configured ? 'true' : 'false'}"
                        placeholder="${escapeHtml(placeholder)}"
                        value="${escapeHtml(value)}"
                    >
                    ${helpMarkup}
                    ${statusMarkup}
                </div>
            `;
        }).join('');

        const noteMarkup = Array.isArray(profile?.notes) && profile.notes.length
            ? `<div class="api-provider-notes">${profile.notes.map(note => `<p>${escapeHtml(note)}</p>`).join('')}</div>`
            : '';

        return `
            <div class="api-provider-settings-block">
                ${fieldMarkup}
                ${noteMarkup}
            </div>
        `;
    }

    function renderOpenAIProviderSettings(profile, connection = {}, config = {}) {
        const transport = config.transport || 'codex-cli';
        const apiSettings = renderGenericProviderSettings(profile, connection);
        const sandbox = config.codexSandbox || 'read-only';
        const searchChecked = config.codexSearch ? 'checked' : '';

        return `
            <div class="api-provider-settings-block">
                <div class="config-field">
                    <label>OpenAI access</label>
                    <div class="config-inline-row">
                        <label class="config-checkbox"><input type="radio" name="openai-transport" value="codex-cli" ${transport !== 'api-key' ? 'checked' : ''}> <span>Codex subscription</span></label>
                        <label class="config-checkbox"><input type="radio" name="openai-transport" value="api-key" ${transport === 'api-key' ? 'checked' : ''}> <span>API key</span></label>
                    </div>
                </div>
                <div id="openai-codex-settings" class="api-subsection">
                    <div class="api-action-row">
                        <button type="button" id="openai-codex-login" class="secondary-btn">Sign in</button>
                        <button type="button" id="openai-codex-check" class="secondary-btn">Check</button>
                    </div>
                    <div id="openai-codex-status" class="config-help api-status-text"></div>
                    <details class="api-advanced-settings">
                        <summary>Advanced</summary>
                        <div class="api-settings-grid">
                            <div class="api-field">
                                <label for="openai-codex-sandbox">Sandbox</label>
                                <select id="openai-codex-sandbox">
                                    <option value="read-only" ${sandbox === 'read-only' ? 'selected' : ''}>read-only</option>
                                    <option value="workspace-write" ${sandbox === 'workspace-write' ? 'selected' : ''}>workspace-write</option>
                                </select>
                            </div>
                            <label class="api-toggle-row">
                                <span class="api-toggle-copy">
                                    <span class="api-toggle-title">Web search</span>
                                    <span class="api-toggle-help">Passes --search to Codex CLI.</span>
                                </span>
                                <input type="checkbox" id="openai-codex-search" ${searchChecked}>
                            </label>
                        </div>
                    </details>
                </div>
                <div id="openai-api-settings" class="api-subsection">
                    ${apiSettings}
                </div>
            </div>
        `;
    }

    function parseRequestOverridesValue(baseRuntimeConfig = {}, strict = false) {
        const input = document.getElementById('model-request-overrides');
        if (!input) {
            return {
                value: baseRuntimeConfig.requestOverrides || {},
                valid: true
            };
        }

        const raw = input.value.trim();
        if (!raw) {
            delete input.dataset.invalid;
            return { value: {}, valid: true };
        }

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Overrides must be a JSON object');
            }
            delete input.dataset.invalid;
            return { value: parsed, valid: true };
        } catch (error) {
            input.dataset.invalid = 'true';
            if (strict) {
                throw new Error('Request overrides must be a valid JSON object');
            }
            return {
                value: baseRuntimeConfig.requestOverrides || {},
                valid: false
            };
        }
    }

    function renderModelSettings(capabilitiesContainer, container, section, profile) {
        if (!capabilitiesContainer || !container || !section) return;

        if (!profile?.spec?.model) {
            section.style.display = 'none';
            capabilitiesContainer.textContent = '';
            container.innerHTML = '';
            return;
        }

        const { spec, runtimeConfig } = profile;
        const reasoningCaps = spec.capabilities?.reasoning || {};
        const streamingCaps = spec.capabilities?.streaming || {};
        const routingCaps = spec.capabilities?.providerRouting || {};
        const contextCaps = spec.capabilities?.contextWindow || {};
        const modalityCaps = spec.capabilities?.modalities || {};
        const requestOverrideCaps = spec.capabilities?.requestOverrides || {};
        const visibilityOptions = visibilityOptionsFor(reasoningCaps);
        const effortOptions = Array.isArray(reasoningCaps.effortLevels) ? reasoningCaps.effortLevels : [];
        const reasoningChecked = runtimeConfig.reasoning?.enabled ? 'checked' : '';
        const reasoningControlAvailable = reasoningCaps.supported && reasoningCaps.toggle;
        const reasoningToggleDisabled = reasoningControlAvailable ? '' : 'disabled';
        const requireParamsChecked = runtimeConfig.providerRouting?.requireParameters ? 'checked' : '';
        const requestOverridesValue = runtimeConfig.requestOverrides && Object.keys(runtimeConfig.requestOverrides).length
            ? JSON.stringify(runtimeConfig.requestOverrides, null, 2)
            : '';
        const reasoningHelpText = reasoningCaps.supported
            ? (reasoningCaps.toggle
                ? 'Uses the mapped provider/model controls for this family.'
                : 'This model family is treated as fixed reasoning.')
            : 'No explicit reasoning control is mapped for this model yet.';
        const capabilityParts = [];

        section.style.display = 'block';
        if (reasoningCaps.supported) {
            capabilityParts.push('Reasoning supported');
        }
        if (effortOptions.length) {
            capabilityParts.push(`Effort: ${effortOptions.join(', ')}`);
        }
        if (reasoningCaps.maxTokens) {
            capabilityParts.push('Thinking budget supported');
        }
        if (streamingCaps.text) {
            capabilityParts.push('Text streaming available');
        }
        if (streamingCaps.reasoning && streamingCaps.reasoning !== 'none') {
            capabilityParts.push(`Thinking output: ${prettyChannelLabel(streamingCaps.reasoning)}`);
        }
        if (contextCaps.supported && runtimeConfig.contextWindow?.value) {
            capabilityParts.push(contextCaps.configurable
                ? 'Context size configurable'
                : `Context: ${runtimeConfig.contextWindow.value.toLocaleString()} tokens`);
        }
        if (modalityCaps.vision) {
            capabilityParts.push('Vision input available');
        }
        if (requestOverrideCaps.supported) {
            capabilityParts.push('Advanced request overrides');
        }
        if (spec.notes?.length) {
            capabilityParts.push(spec.notes[0]);
        }
        capabilitiesContainer.textContent = capabilityParts.join(' | ');

        container.innerHTML = `
            <div class="api-model-settings">
                <label class="api-toggle-row ${reasoningControlAvailable ? '' : 'is-disabled'}">
                    <span class="api-toggle-copy">
                        <span class="api-toggle-title">Enable reasoning / thinking</span>
                        <span class="api-toggle-help">${reasoningHelpText}</span>
                    </span>
                    <input type="checkbox" id="model-reasoning-enabled" ${reasoningChecked} ${reasoningToggleDisabled}>
                </label>
                <div class="api-settings-grid">
                    <div class="api-field">
                        <label>Thinking visibility</label>
                        <div class="api-pill-picker" role="radiogroup" aria-label="Thinking visibility">
                            ${visibilityOptions.map(option => `
                            <label class="api-pill-option">
                                <input type="radio" name="model-reasoning-visibility" value="${option.value}" ${runtimeConfig.reasoning?.visibility === option.value ? 'checked' : ''}>
                                <span>${option.label}</span>
                            </label>`).join('')}
                        </div>
                    </div>
                    ${effortOptions.length ? `
                    <div class="api-field">
                        <label for="model-reasoning-effort">Reasoning effort</label>
                        <select id="model-reasoning-effort">
                            ${effortOptions.map(level => `<option value="${level}" ${runtimeConfig.reasoning?.effort === level ? 'selected' : ''}>${level}</option>`).join('')}
                        </select>
                    </div>` : ''}
                    ${reasoningCaps.maxTokens ? `
                    <div class="api-field">
                        <label for="model-reasoning-budget">Thinking budget</label>
                        <input type="number" id="model-reasoning-budget" min="1" step="1" value="${runtimeConfig.reasoning?.maxTokens || ''}" placeholder="e.g. 2048">
                    </div>` : ''}
                    ${requestOverrideCaps.supported ? `
                    <div class="api-field api-field-wide">
                        <label for="model-request-overrides">Request overrides (JSON)</label>
                        <textarea id="model-request-overrides" rows="5" placeholder='{"top_k": 40}'>${escapeHtml(requestOverridesValue)}</textarea>
                        <div class="config-help">Merged into the request body after the app's standard parameters.</div>
                    </div>` : ''}
                </div>
                ${routingCaps.requireParameters ? `
                <label class="api-toggle-row">
                    <span class="api-toggle-copy">
                        <span class="api-toggle-title">Require backend support for selected parameters</span>
                        <span class="api-toggle-help">Useful for OpenRouter so routed backends actually support reasoning settings.</span>
                    </span>
                    <input type="checkbox" id="model-require-params" ${requireParamsChecked}>
                </label>` : ''}
            </div>
        `;
    }

    function collectRuntimeConfig(baseRuntimeConfig = {}, strict = false) {
        const selectedVisibility = document.querySelector('input[name="model-reasoning-visibility"]:checked');
        const legacyVisibilitySelect = document.getElementById('model-reasoning-visibility');
        const requestOverrides = parseRequestOverridesValue(baseRuntimeConfig, strict);

        return {
            reasoning: {
                enabled: document.getElementById('model-reasoning-enabled')
                    ? Boolean(document.getElementById('model-reasoning-enabled')?.checked)
                    : Boolean(baseRuntimeConfig.reasoning?.enabled),
                visibility: selectedVisibility?.value || legacyVisibilitySelect?.value || baseRuntimeConfig.reasoning?.visibility || 'show',
                effort: document.getElementById('model-reasoning-effort')?.value || baseRuntimeConfig.reasoning?.effort || null,
                maxTokens: document.getElementById('model-reasoning-budget')?.value || baseRuntimeConfig.reasoning?.maxTokens || null
            },
            streaming: {
                text: Boolean(baseRuntimeConfig.streaming?.text),
                reasoning: Boolean(baseRuntimeConfig.streaming?.reasoning)
            },
            providerRouting: {
                requireParameters: document.getElementById('model-require-params')
                    ? Boolean(document.getElementById('model-require-params')?.checked)
                    : Boolean(baseRuntimeConfig.providerRouting?.requireParameters)
            },
            requestOverrides: requestOverrides.value
        };
    }

    window.initializeApiProviderSettings = async function (mainPanel) {
        const llmProviderSelect = document.getElementById('llm-provider-select');
        const llmModelSelect = document.getElementById('llm-model-select');
        const refreshModelsButton = document.getElementById('refresh-provider-models-btn');
        const providerDiscoveryStatus = document.getElementById('provider-discovery-status');
        const providerSettingsContainer = document.getElementById('provider-settings-container');
        const llmConfigSaveButton = document.getElementById('llm-config-save-button');
        const modelSettingsSection = document.getElementById('llm-model-settings-section');
        const modelCapabilitiesContainer = document.getElementById('llm-model-capabilities');
        const modelConfigContainer = document.getElementById('llm-model-config-container');
        const currentConfigDisplay = document.getElementById('current-config-display');
        const currentConfigText = document.getElementById('current-config-text');
        const chatProviderSelect = document.getElementById('chat-provider-select');
        const chatModelSelect = document.getElementById('chat-model-select');

        if (!llmProviderSelect || !llmModelSelect) return;

        let currentConfig = null;
        let currentModelProfile = null;
        let providerProfileMap = {};
        let syncModelsToChat = null;
        let modelProfileRequestId = 0;
        const getProviderProfile = (provider) => providerProfileMap[provider] || null;

        const toggleCustomModelSection = (provider) => {
            const customSection = document.getElementById('custom-model-section');
            const customLabel = customSection?.querySelector('label[for="custom-model-input"]');
            const customInput = document.getElementById('custom-model-input');
            const profile = getProviderProfile(provider);
            if (!customSection) return;

            const enabled = Boolean(profile?.settings?.supportsCustomModel);
            customSection.style.display = enabled ? 'flex' : 'none';
            if (customLabel) {
                customLabel.textContent = profile?.settings?.customModelLabel || 'Custom Model';
            }
            if (customInput) {
                customInput.placeholder = profile?.settings?.customModelPlaceholder || 'Type model name...';
            }
        };

        const buildProviderConfig = (provider, { includeModel = true, strict = false } = {}) => {
            const config = { provider };
            const profile = getProviderProfile(provider);
            const model = llmModelSelect.value;

            if (provider === 'openai') {
                config.transport = document.querySelector('input[name="openai-transport"]:checked')?.value || 'codex-cli';
                config.codexSandbox = document.getElementById('openai-codex-sandbox')?.value || 'read-only';
                config.codexSearch = Boolean(document.getElementById('openai-codex-search')?.checked);
            }

            if (profile?.settings?.connectionFields?.length) {
                config.connection = {};
                profile.settings.connectionFields.forEach(field => {
                    const input = document.getElementById(providerFieldId(field.id));
                    if (!input) return;
                    const value = input.value?.trim() || '';
                    if ((field.id === 'apiKey' || field.type === 'password') && !value) {
                        return;
                    }
                    config.connection[field.id] = value;
                    if (field.id === 'apiKey' && value) config.apiKey = value;
                    if (field.id === 'url' && value) config.url = value;
                });
            }

            if (provider === 'qwen') {
                const mode = document.querySelector('input[name="qwen-mode"]:checked')?.value || 'cli';
                config.mode = mode;
                config.useOAuth = mode === 'oauth';
                if (mode === 'api') {
                    const apiKey = document.getElementById('qwen-key')?.value?.trim();
                    if (apiKey) config.apiKey = apiKey;
                }
            }

            if (includeModel && !isPlaceholderModel(model)) {
                config.model = model;
            }

            if (config.model && currentModelProfile?.spec?.model === config.model) {
                config.runtimeConfig = collectRuntimeConfig(currentModelProfile.runtimeConfig, strict);
            }

            return config;
        };

        const applyVisibilityToMainPanel = (runtimeConfig) => {
            if (mainPanel) {
                mainPanel._thinkingVisibility = runtimeConfig?.reasoning?.visibility || 'show';
            }
        };

        const isPlaceholderModel = (model) => {
            return !model
                || model === 'Select a Model...'
                || model === 'Select a provider first'
                || model === 'No models found'
                || model === 'Failed to load models';
        };

        const persistConfig = async (config, notificationMessage = null) => {
            await window.electronAPI.llm.saveConfig(config);
            currentConfig = await window.electronAPI.llm.getConfig();
            applyVisibilityToMainPanel(currentConfig?.runtimeConfig || config.runtimeConfig);
            setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);
            if (notificationMessage) {
                mainPanel.showNotification(notificationMessage, 'info');
            }
            return currentConfig;
        };

        const loadModelProfile = async (provider, model) => {
            const requestId = ++modelProfileRequestId;
            if (!provider || !model || model === 'Select a Model...' || model === 'No models found') {
                currentModelProfile = null;
                renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, null);
                mainPanel?.applyContextProfile?.(null);
                return null;
            }

            const profile = await window.electronAPI.llm.getModelProfile(provider, model);
            if (requestId !== modelProfileRequestId) {
                return currentModelProfile;
            }
            currentModelProfile = profile;
            renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, currentModelProfile);
            applyVisibilityToMainPanel(currentModelProfile?.runtimeConfig);
            mainPanel?.applyContextProfile?.(currentModelProfile);
            return currentModelProfile;
        };

        const loadModelsForProvider = async (provider, forceRefresh = false, preferredModel = null) => {
            if (!provider || provider === 'Select a Provider...') {
                llmModelSelect.innerHTML = '<option>Select a provider first</option>';
                if (providerDiscoveryStatus) providerDiscoveryStatus.textContent = '';
                await loadModelProfile(null, null);
                return [];
            }

            currentModelProfile = null;
            renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, null);
            mainPanel?.applyContextProfile?.(null);
            llmModelSelect.innerHTML = '<option disabled>Loading models...</option>';
            if (providerDiscoveryStatus) {
                providerDiscoveryStatus.textContent = forceRefresh ? 'Refreshing model list...' : '';
            }

            try {
                const models = await window.electronAPI.llm.getModels(provider, forceRefresh);
                llmModelSelect.innerHTML = '<option disabled selected>Select a Model...</option>';

                if (models && models.length > 0) {
                    models.forEach(modelName => {
                        const option = document.createElement('option');
                        option.value = modelName;
                        option.textContent = modelName;
                        llmModelSelect.appendChild(option);
                    });

                    const targetModel = preferredModel || currentConfig?.model || null;
                    if (targetModel && Array.from(llmModelSelect.options).some(o => o.value === targetModel)) {
                        llmModelSelect.value = targetModel;
                    }
                } else {
                    llmModelSelect.innerHTML = '<option disabled>No models found</option>';
                }

                if (providerDiscoveryStatus) {
                    providerDiscoveryStatus.textContent = models?.length
                        ? `Found ${models.length} model${models.length === 1 ? '' : 's'}.`
                        : 'No models discovered. You can still enter a manual model ID below.';
                }
                await loadModelProfile(provider, llmModelSelect.value);
                return models || [];
            } catch (error) {
                console.error('Failed to load models:', error);
                llmModelSelect.innerHTML = '<option>Failed to load models</option>';
                if (providerDiscoveryStatus) {
                    providerDiscoveryStatus.textContent = `Discovery failed: ${error.message}`;
                }
                await loadModelProfile(null, null);
                return [];
            }
        };

        const updateProviderSettings = async (provider) => {
            providerSettingsContainer.innerHTML = '';
            currentConfig = await window.electronAPI.llm.getConfig();
            const profile = getProviderProfile(provider);
            const savedConnection = await window.electronAPI.llm.getProviderConnectionConfig(provider);

            if (provider === 'qwen') {
                providerSettingsContainer.innerHTML = `
                    <div class="config-field">
                        <label>Qwen Access Mode</label>
                        <div class="config-inline-row">
                            <label class="config-checkbox"><input type="radio" name="qwen-mode" value="cli" checked> <span>CLI</span></label>
                            <label class="config-checkbox"><input type="radio" name="qwen-mode" value="api"> <span>API</span></label>
                            <label class="config-checkbox"><input type="radio" name="qwen-mode" value="oauth"> <span>OAuth</span></label>
                        </div>
                    </div>
                    <div id="qwen-cli-settings" class="config-help">CLI mode runs the local qwen command.</div>
                    <div id="qwen-api-settings" class="api-subsection" style="display: none;">
                        <div class="config-field">
                            <label for="qwen-key">API Key</label>
                            <input type="password" id="qwen-key" placeholder="sk-...">
                        </div>
                        <div class="api-action-row">
                            <button type="button" id="verify-api-key" class="secondary-btn">Verify Key</button>
                        </div>
                        <div id="qwen-api-status" class="config-help api-status-text"></div>
                    </div>
                    <div id="qwen-oauth-settings" class="api-subsection" style="display: none;">
                        <div class="api-action-row">
                            <button type="button" id="qwen-fetch-oauth" class="secondary-btn">Load OAuth Credentials</button>
                        </div>
                        <div id="qwen-oauth-status" class="config-help api-status-text"></div>
                    </div>
                `;
            } else if (provider === 'openai' && profile) {
                providerSettingsContainer.innerHTML = renderOpenAIProviderSettings(profile, savedConnection, currentConfig);
            } else if (profile) {
                providerSettingsContainer.innerHTML = renderGenericProviderSettings(profile, savedConnection);
            }

            toggleCustomModelSection(provider);

            if (provider === 'qwen') {
                const applyQwenMode = async (mode, preferredModel = null, refresh = false) => {
                    const cliSettings = document.getElementById('qwen-cli-settings');
                    const apiSettings = document.getElementById('qwen-api-settings');
                    const oauthSettings = document.getElementById('qwen-oauth-settings');

                    if (cliSettings) cliSettings.style.display = mode === 'cli' ? 'block' : 'none';
                    if (apiSettings) apiSettings.style.display = mode === 'api' ? 'block' : 'none';
                    if (oauthSettings) oauthSettings.style.display = mode === 'oauth' ? 'block' : 'none';

                    await loadModelsForProvider('qwen', refresh || mode === 'oauth', preferredModel);
                };

                const savedMode = await window.electronAPI.getSettingValue('llm.qwen.mode');
                const savedUseOAuth = await window.electronAPI.getSettingValue('llm.qwen.useOAuth');
                const qwenConfigured = Boolean(currentConfig?.apiKeyConfigured);
                const mode = currentConfig?.provider === provider
                    ? (currentConfig.mode || (currentConfig.useOAuth ? 'oauth' : 'cli'))
                    : (savedMode || (savedUseOAuth === 'true' ? 'oauth' : 'cli'));
                const modeRadio = document.querySelector(`input[name="qwen-mode"][value="${mode}"]`);
                if (modeRadio) modeRadio.checked = true;

                const qwenKeyInput = document.getElementById('qwen-key');
                if (qwenKeyInput && qwenConfigured) {
                    qwenKeyInput.placeholder = 'Configured - enter a new value to replace';
                }

                const oauthStatus = document.getElementById('qwen-oauth-status');
                if (oauthStatus && (currentConfig?.useOAuth || savedUseOAuth === 'true')) {
                    oauthStatus.textContent = 'OAuth credentials configured';
                }

                document.querySelectorAll('input[name="qwen-mode"]').forEach(radio => {
                    radio.addEventListener('change', async (e) => {
                        await applyQwenMode(e.target.value, llmModelSelect.value, e.target.value === 'oauth');
                    });
                });

                const fetchBtn = document.getElementById('qwen-fetch-oauth');
                if (fetchBtn) {
                    fetchBtn.addEventListener('click', async () => {
                        try {
                            await window.electronAPI.llm.fetchQwenOAuth();
                            if (oauthStatus) oauthStatus.textContent = 'OAuth credentials loaded';
                            mainPanel.showNotification('OAuth credentials loaded');
                            await applyQwenMode('oauth', llmModelSelect.value, true);
                        } catch (error) {
                            if (oauthStatus) oauthStatus.textContent = 'Failed to load credentials';
                            mainPanel.showNotification('Failed to load OAuth credentials', 'error');
                        }
                    });
                }

                const verifyBtn = document.getElementById('verify-api-key');
                if (verifyBtn) {
                    verifyBtn.addEventListener('click', async () => {
                        const apiKey = document.getElementById('qwen-key')?.value?.trim();
                        const statusDiv = document.getElementById('qwen-api-status');

                        if (!apiKey) {
                            if (statusDiv) statusDiv.textContent = 'Enter an API key first.';
                            return;
                        }

                        verifyBtn.disabled = true;
                        verifyBtn.textContent = 'Verifying...';
                        if (statusDiv) statusDiv.textContent = '';

                        try {
                            const result = await window.electronAPI.verifyQwenKey(apiKey);
                            if (statusDiv) {
                                statusDiv.textContent = result.success
                                    ? `Verified. Found ${result.modelCount} models.`
                                    : result.error;
                            }
                        } catch (error) {
                            if (statusDiv) statusDiv.textContent = `Verification failed: ${error.message}`;
                        } finally {
                            verifyBtn.disabled = false;
                            verifyBtn.textContent = 'Verify Key';
                        }
                    });
                }

                await applyQwenMode(mode, currentConfig?.model, mode === 'oauth');
            } else if (provider === 'openai') {
                const applyOpenAITransport = async (transport, preferredModel = null, refresh = false) => {
                    const codexSettings = document.getElementById('openai-codex-settings');
                    const apiSettings = document.getElementById('openai-api-settings');
                    if (codexSettings) codexSettings.style.display = transport === 'api-key' ? 'none' : 'block';
                    if (apiSettings) apiSettings.style.display = transport === 'api-key' ? 'block' : 'none';
                    await window.electronAPI.llm.saveConfig(buildProviderConfig('openai', { includeModel: false }));
                    await loadModelsForProvider('openai', refresh, preferredModel);
                };

                const refreshCodexStatus = async () => {
                    const statusDiv = document.getElementById('openai-codex-status');
                    if (!statusDiv) return;
                    statusDiv.textContent = 'Checking Codex CLI...';
                    try {
                        const status = await window.electronAPI.llm.getCodexStatus();
                        statusDiv.textContent = status.installed
                            ? `Codex CLI detected${status.version ? ` (${status.version})` : ''}${status.path ? ` at ${status.path}` : ''}${status.version ? '' : status.error ? `, but could not run it yet: ${status.error}` : ''}.`
                            : `Codex CLI not found${status.error ? `: ${status.error}` : '.'}`;
                    } catch (error) {
                        statusDiv.textContent = `Codex check failed: ${error.message}`;
                    }
                };

                const transport = currentConfig?.transport || 'codex-cli';
                const transportRadio = document.querySelector(`input[name="openai-transport"][value="${transport}"]`);
                if (transportRadio) transportRadio.checked = true;
                document.querySelectorAll('input[name="openai-transport"]').forEach(radio => {
                    radio.addEventListener('change', async (e) => {
                        await applyOpenAITransport(e.target.value, llmModelSelect.value, e.target.value === 'api-key');
                    });
                });

                document.getElementById('openai-codex-check')?.addEventListener('click', refreshCodexStatus);
                document.getElementById('openai-codex-login')?.addEventListener('click', async () => {
                    const statusDiv = document.getElementById('openai-codex-status');
                    try {
                        await window.electronAPI.llm.launchCodexLogin();
                        if (statusDiv) statusDiv.textContent = 'Codex login launched.';
                    } catch (error) {
                        if (statusDiv) statusDiv.textContent = `Could not launch login: ${error.message}`;
                    }
                });

                await applyOpenAITransport(transport, currentConfig?.model, false);
                await refreshCodexStatus();
            } else if (providerDiscoveryStatus) {
                providerDiscoveryStatus.textContent = profile?.settings?.supportsModelDiscovery
                    ? ''
                    : 'This provider does not expose model discovery.';
            }
        };

        const saveQuickSelection = async () => {
            const provider = chatProviderSelect?.value;
            const model = chatModelSelect?.value;

            if (!provider || isPlaceholderModel(model)) {
                return;
            }

            const config = buildProviderConfig(provider, { includeModel: false });
            config.model = model;

            await persistConfig(config, `Switched to ${model}`);
        };

        const updateDraftConfigLabel = () => {
            const provider = llmProviderSelect?.value;
            const model = llmModelSelect?.value;
            if (!provider || provider === 'Select a Provider...') {
                return;
            }
            setCurrentConfigLabel(currentConfigDisplay, currentConfigText, {
                provider,
                providerLabel: providerLabel(provider, providerProfileMap),
                model: isPlaceholderModel(model) ? null : model
            });
        };

        if (modelConfigContainer) {
            const syncModelConfigState = () => {
                if (!currentModelProfile) return;
                try {
                    applyVisibilityToMainPanel(collectRuntimeConfig(currentModelProfile.runtimeConfig));
                } catch (_) {
                    // Leave current preview state unchanged until JSON is valid again.
                }
            };
            modelConfigContainer.addEventListener('input', syncModelConfigState);
            modelConfigContainer.addEventListener('change', syncModelConfigState);
        }

        llmProviderSelect.addEventListener('change', async (event) => {
            const provider = event.target.value;
            await updateProviderSettings(provider);
            if (provider !== 'qwen') {
                await loadModelsForProvider(provider, false, null);
            }
            toggleCustomModelSection(provider);
            updateDraftConfigLabel();

            if (chatProviderSelect) {
                chatProviderSelect.value = provider;
            }
        });

        llmModelSelect.addEventListener('change', async () => {
            const provider = llmProviderSelect.value;
            const model = llmModelSelect.value;
            await loadModelProfile(provider, model);
            updateDraftConfigLabel();
            if (chatModelSelect) {
                chatModelSelect.value = model;
            }
        });

        const testModelBtn = document.getElementById('test-custom-model-btn');
        if (testModelBtn) {
            testModelBtn.addEventListener('click', async () => {
                const customInput = document.getElementById('custom-model-input');
                const statusDiv = document.getElementById('custom-model-status');
                const modelName = customInput?.value?.trim();

                if (!modelName) {
                    if (statusDiv) statusDiv.textContent = 'Please enter a model name';
                    return;
                }

                testModelBtn.disabled = true;
                testModelBtn.textContent = 'Testing...';
                if (statusDiv) statusDiv.textContent = '';

                try {
                    const provider = llmProviderSelect.value || 'ollama';
                    const result = await window.electronAPI.llm.testModel(provider, modelName);
                    if (!result.success) throw new Error(result.error);

                    if (!Array.from(llmModelSelect.options).some(o => o.value === modelName)) {
                        const option = document.createElement('option');
                        option.value = modelName;
                        option.textContent = modelName;
                        llmModelSelect.appendChild(option);
                    }

                    llmModelSelect.value = modelName;
                    await loadModelProfile(provider, modelName);
                    syncModelsToChat?.();
                    if (chatProviderSelect) {
                        chatProviderSelect.value = provider;
                    }
                    if (chatModelSelect && Array.from(chatModelSelect.options).some(o => o.value === modelName)) {
                        chatModelSelect.value = modelName;
                    }

                    currentConfig = await window.electronAPI.llm.getConfig();
                    setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);
                    applyVisibilityToMainPanel(currentConfig?.runtimeConfig);
                    const autoSaved = currentConfig?.provider === provider && currentConfig?.model === modelName;
                    if (statusDiv) {
                        statusDiv.textContent = autoSaved
                            ? `Model responds as ${result.model}. Added to the list and remembered as workable.`
                            : `Model responds as ${result.model}`;
                    }
                    if (autoSaved) {
                        mainPanel.showNotification(`Remembered workable model ${modelName}`, 'info');
                    }
                } catch (error) {
                    if (statusDiv) statusDiv.textContent = `Test failed: ${error.message}`;
                } finally {
                    testModelBtn.disabled = false;
                    testModelBtn.textContent = 'Test Model';
                }
            });
        }

        if (refreshModelsButton) {
            refreshModelsButton.addEventListener('click', async () => {
                const provider = llmProviderSelect.value;
                if (!provider || provider === 'Select a Provider...') {
                    return;
                }

                refreshModelsButton.disabled = true;
                if (providerDiscoveryStatus) {
                    providerDiscoveryStatus.textContent = 'Saving connection details and refreshing models...';
                }

                try {
                    const config = buildProviderConfig(provider, { includeModel: false });
                    await window.electronAPI.llm.saveConfig(config);
                    await loadModelsForProvider(provider, true, llmModelSelect.value);
                    syncModelsToChat?.();
                } catch (error) {
                    if (providerDiscoveryStatus) {
                        providerDiscoveryStatus.textContent = `Discovery failed: ${error.message}`;
                    }
                } finally {
                    refreshModelsButton.disabled = false;
                }
            });
        }

        llmConfigSaveButton.addEventListener('click', async () => {
            const provider = llmProviderSelect.value;

            if (!provider || provider === 'Select a Provider...') {
                alert('Please select a provider');
                return;
            }

            const profile = getProviderProfile(provider);
            if (provider === 'qwen') {
                const mode = document.querySelector('input[name="qwen-mode"]:checked')?.value || 'cli';
                if (mode === 'api' && !document.getElementById('qwen-key')?.value?.trim()) {
                    alert('Please enter Qwen API key');
                    return;
                }
            } else if (profile?.settings?.connectionFields?.length) {
                const missing = profile.settings.connectionFields.find(field => {
                    const input = document.getElementById(providerFieldId(field.id));
                    if (!field.required || !input) return false;
                    if ((field.id === 'apiKey' || field.type === 'password') && input.dataset.configured === 'true') {
                        return false;
                    }
                    return !input.value?.trim();
                });
                if (missing) {
                    alert(`Please enter ${missing.label}`);
                    return;
                }
            }

            try {
                const config = buildProviderConfig(provider, { includeModel: true, strict: true });
                await window.electronAPI.llm.saveConfig(config);
                currentConfig = await window.electronAPI.llm.getConfig();
                setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);
                if (config.model) {
                    await loadModelProfile(config.provider, config.model);
                }
                if (profile?.settings?.supportsModelDiscovery || provider === 'qwen') {
                    await loadModelsForProvider(provider, true, config.model || llmModelSelect.value);
                    syncModelsToChat?.();
                }
                applyVisibilityToMainPanel(currentConfig?.runtimeConfig || config.runtimeConfig);
                mainPanel.showNotification('Configuration saved!');
            } catch (error) {
                alert(error.message || 'Failed to save configuration');
            }
        });

        const providerProfiles = await window.electronAPI.llm.getProviderProfiles();
        providerProfileMap = (providerProfiles?.providers || []).reduce((acc, provider) => {
            acc[provider.id] = provider;
            return acc;
        }, {});

        const providers = await window.electronAPI.getProviders();
        llmProviderSelect.innerHTML = '<option disabled selected>Select a Provider...</option>';
        providers.forEach(provider => {
            const option = document.createElement('option');
            option.value = provider;
            option.textContent = providerLabel(provider, providerProfileMap);
            llmProviderSelect.appendChild(option);
        });

        currentConfig = await window.electronAPI.llm.getConfig();
        setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);

        if (currentConfig?.provider) {
            llmProviderSelect.value = currentConfig.provider;
            await updateProviderSettings(currentConfig.provider);
            if (currentConfig.provider !== 'qwen') {
                await loadModelsForProvider(currentConfig.provider, false, currentConfig.model);
            }
            if (currentConfig.model && Array.from(llmModelSelect.options).some(o => o.value === currentConfig.model)) {
                llmModelSelect.value = currentConfig.model;
                await loadModelProfile(currentConfig.provider, currentConfig.model);
            }
            toggleCustomModelSection(currentConfig.provider);
        } else {
            renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, null);
        }

        if (chatProviderSelect && chatModelSelect) {
            chatProviderSelect.innerHTML = '';
            providers.forEach(provider => {
                const option = document.createElement('option');
                option.value = provider;
                option.textContent = providerLabel(provider, providerProfileMap);
                chatProviderSelect.appendChild(option);
            });

            if (currentConfig?.provider) {
                chatProviderSelect.value = currentConfig.provider;
            }

            syncModelsToChat = () => {
                chatModelSelect.innerHTML = '';
                Array.from(llmModelSelect.options).forEach(opt => {
                    const cloned = document.createElement('option');
                    cloned.value = opt.value;
                    cloned.textContent = opt.textContent;
                    cloned.disabled = opt.disabled;
                    cloned.selected = opt.selected;
                    chatModelSelect.appendChild(cloned);
                });
            };

            syncModelsToChat();

            chatProviderSelect.addEventListener('change', async (e) => {
                llmProviderSelect.value = e.target.value;
                await updateProviderSettings(e.target.value);
                if (e.target.value !== 'qwen') {
                    await loadModelsForProvider(e.target.value, false, null);
                }
                syncModelsToChat();
                if (chatModelSelect) {
                    const firstUsable = Array.from(chatModelSelect.options)
                        .find(opt => !opt.disabled && !isPlaceholderModel(opt.value));
                    if (firstUsable) {
                        chatModelSelect.value = firstUsable.value;
                        llmModelSelect.value = firstUsable.value;
                        await loadModelProfile(llmProviderSelect.value, firstUsable.value);
                    }
                }
                await saveQuickSelection();
            });

            chatModelSelect.addEventListener('change', async (e) => {
                llmModelSelect.value = e.target.value;
                await loadModelProfile(llmProviderSelect.value, e.target.value);
                await saveQuickSelection();
            });

            const modelObserver = new MutationObserver(() => {
                syncModelsToChat();
            });
            modelObserver.observe(llmModelSelect, { childList: true });
        }
    };
})();
