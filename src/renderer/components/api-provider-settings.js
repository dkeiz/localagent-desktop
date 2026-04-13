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
        const providerName = config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
        configText.textContent = config.model
            ? `Provider: ${providerName}, Model: "${config.model}"`
            : `Provider: ${providerName}`;
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
        const visibilityOptions = visibilityOptionsFor(reasoningCaps);
        const effortOptions = Array.isArray(reasoningCaps.effortLevels) ? reasoningCaps.effortLevels : [];
        const reasoningChecked = runtimeConfig.reasoning?.enabled ? 'checked' : '';
        const reasoningControlAvailable = reasoningCaps.supported && reasoningCaps.toggle;
        const reasoningToggleDisabled = reasoningControlAvailable ? '' : 'disabled';
        const requireParamsChecked = runtimeConfig.providerRouting?.requireParameters ? 'checked' : '';
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

    function collectRuntimeConfig(baseRuntimeConfig = {}) {
        const selectedVisibility = document.querySelector('input[name="model-reasoning-visibility"]:checked');
        const legacyVisibilitySelect = document.getElementById('model-reasoning-visibility');

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
            }
        };
    }

    window.initializeApiProviderSettings = async function (mainPanel) {
        const llmProviderSelect = document.getElementById('llm-provider-select');
        const llmModelSelect = document.getElementById('llm-model-select');
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
            if (!provider || !model || model === 'Select a Model...' || model === 'No models found') {
                currentModelProfile = null;
                renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, null);
                return null;
            }

            currentModelProfile = await window.electronAPI.llm.getModelProfile(provider, model);
            renderModelSettings(modelCapabilitiesContainer, modelConfigContainer, modelSettingsSection, currentModelProfile);
            applyVisibilityToMainPanel(currentModelProfile?.runtimeConfig);
            return currentModelProfile;
        };

        const loadModelsForProvider = async (provider, forceRefresh = false, preferredModel = null) => {
            if (!provider || provider === 'Select a Provider...') {
                llmModelSelect.innerHTML = '<option>Select a provider first</option>';
                await loadModelProfile(null, null);
                return [];
            }

            llmModelSelect.innerHTML = '<option disabled>Loading models...</option>';

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

                await loadModelProfile(provider, llmModelSelect.value);
                return models || [];
            } catch (error) {
                console.error('Failed to load models:', error);
                llmModelSelect.innerHTML = '<option>Failed to load models</option>';
                await loadModelProfile(null, null);
                return [];
            }
        };

        const updateProviderSettings = async (provider) => {
            providerSettingsContainer.innerHTML = '';

            if (provider === 'openrouter') {
                providerSettingsContainer.innerHTML = `
                    <div class="config-field">
                        <label for="openrouter-key">OpenRouter API Key</label>
                        <input type="password" id="openrouter-key" placeholder="sk-...">
                    </div>
                `;
            } else if (provider === 'qwen') {
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
            } else if (provider === 'lmstudio') {
                providerSettingsContainer.innerHTML = `
                    <div class="config-field">
                        <label for="lmstudio-url">LM Studio URL</label>
                        <input type="text" id="lmstudio-url" placeholder="http://localhost:1234">
                    </div>
                `;
            }

            currentConfig = await window.electronAPI.llm.getConfig();
            if (provider === 'openrouter' && currentConfig?.provider === provider && currentConfig.apiKey) {
                const input = document.getElementById('openrouter-key');
                if (input) input.value = currentConfig.apiKey;
            }

            if (provider === 'lmstudio' && currentConfig?.provider === provider && currentConfig.url) {
                const input = document.getElementById('lmstudio-url');
                if (input) input.value = currentConfig.url;
            }

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

                const mode = currentConfig?.provider === provider
                    ? (currentConfig.mode || (currentConfig.useOAuth ? 'oauth' : 'cli'))
                    : 'cli';
                const modeRadio = document.querySelector(`input[name="qwen-mode"][value="${mode}"]`);
                if (modeRadio) modeRadio.checked = true;

                const qwenKeyInput = document.getElementById('qwen-key');
                if (qwenKeyInput && currentConfig?.apiKey) {
                    qwenKeyInput.value = currentConfig.apiKey;
                }

                const oauthStatus = document.getElementById('qwen-oauth-status');
                if (oauthStatus && currentConfig?.useOAuth) {
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
            }
        };

        const saveQuickSelection = async () => {
            const provider = chatProviderSelect?.value;
            const model = chatModelSelect?.value;

            if (!provider || isPlaceholderModel(model)) {
                return;
            }

            const config = { provider, model };
            if (provider === 'qwen') {
                const qwenMode = document.querySelector('input[name="qwen-mode"]:checked')?.value;
                if (qwenMode) {
                    config.mode = qwenMode;
                    config.useOAuth = qwenMode === 'oauth';
                }
            }

            if (currentModelProfile?.spec?.model === model) {
                config.runtimeConfig = collectRuntimeConfig(currentModelProfile.runtimeConfig);
            }

            await persistConfig(config, `Switched to ${model}`);
        };

        if (modelConfigContainer) {
            const syncModelConfigState = () => {
                if (!currentModelProfile) return;
                applyVisibilityToMainPanel(collectRuntimeConfig(currentModelProfile.runtimeConfig));
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

            const customSection = document.getElementById('custom-model-section');
            if (customSection) {
                customSection.style.display = provider === 'ollama' ? 'block' : 'none';
            }

            if (chatProviderSelect) {
                chatProviderSelect.value = provider;
            }
        });

        llmModelSelect.addEventListener('change', async () => {
            const provider = llmProviderSelect.value;
            const model = llmModelSelect.value;
            await loadModelProfile(provider, model);
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

        llmConfigSaveButton.addEventListener('click', async () => {
            const provider = llmProviderSelect.value;
            const model = llmModelSelect.value;

            if (!provider || provider === 'Select a Provider...') {
                alert('Please select a provider');
                return;
            }

            const config = { provider };
            if (provider === 'ollama') {
                if (!model || model === 'Select a Model...') {
                    alert('Please select a model');
                    return;
                }
                config.model = model;
            } else if (provider === 'openrouter') {
                const apiKey = document.getElementById('openrouter-key')?.value?.trim();
                if (!apiKey) {
                    alert('Please enter OpenRouter API key');
                    return;
                }
                config.apiKey = apiKey;
                if (model && model !== 'Select a Model...') config.model = model;
            } else if (provider === 'qwen') {
                const mode = document.querySelector('input[name="qwen-mode"]:checked')?.value || 'cli';
                config.mode = mode;
                config.useOAuth = mode === 'oauth';

                if (mode === 'api') {
                    const apiKey = document.getElementById('qwen-key')?.value?.trim();
                    if (!apiKey) {
                        alert('Please enter Qwen API key');
                        return;
                    }
                    config.apiKey = apiKey;
                }

                if ((mode === 'api' || mode === 'oauth') && (!model || model === 'Select a Model...' || model === 'No models found')) {
                    alert('Please select a Qwen model');
                    return;
                }

                if (model && model !== 'Select a Model...') {
                    config.model = model;
                }
            } else if (provider === 'lmstudio') {
                if (!model || model === 'Select a Model...') {
                    alert('Please select a model');
                    return;
                }
                config.model = model;
                const url = document.getElementById('lmstudio-url')?.value?.trim();
                if (url) config.url = url;
            }

            if (config.model && currentModelProfile?.spec?.model === config.model) {
                config.runtimeConfig = collectRuntimeConfig(currentModelProfile.runtimeConfig);
            }

            await window.electronAPI.llm.saveConfig(config);
            currentConfig = await window.electronAPI.llm.getConfig();
            setCurrentConfigLabel(currentConfigDisplay, currentConfigText, currentConfig);
            if (config.model) {
                await loadModelProfile(config.provider, config.model);
            }
            applyVisibilityToMainPanel(currentConfig?.runtimeConfig || config.runtimeConfig);
            mainPanel.showNotification('Configuration saved!');
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

            const customSection = document.getElementById('custom-model-section');
            if (customSection) {
                customSection.style.display = currentConfig.provider === 'ollama' ? 'block' : 'none';
            }
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
