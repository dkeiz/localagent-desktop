class SkinManager {
    constructor() {
        this.storage = {
            enabled: 'skinSystemEnabled',
            activeSkin: 'activeSkinId',
            diagnostics: 'skinDiagnosticsHistory',
            skinThemes: 'skinThemePreferences'
        };
        this.config = { skins: [] };
        this.contract = { requiredIds: [] };
        this.state = {
            enabled: false,
            skinId: 'default',
            loading: false,
            pendingApply: false
        };
        this.lastDiagnostics = null;
        this.themeObserver = null;
        this.themePreferences = {};
        this.silentMode = false;
    }

    async initialize() {
        this.bindElements();
        if (!this.elements.root) return;
        await this.loadConfigFiles();
        this.loadState();
        this.syncDevControlsVisibility();
        this.bindEvents();
        this.observeThemeChanges();
        await this.applySelectedSkin();
        this.render();
    }

    bindElements() {
        this.elements = {
            root: document.getElementById('skin-picker'),
            status: document.getElementById('skin-picker-status'),
            enabled: document.getElementById('skin-feature-enabled'),
            themes: document.getElementById('skin-theme-options'),
            runAutoTest: document.getElementById('run-skin-autotest-btn'),
            runDiagnostics: document.getElementById('run-skin-diagnostics-btn'),
            diagnosticsOutput: document.getElementById('skin-diagnostics-output'),
            legacyThemePicker: document.getElementById('theme-picker')
        };
    }

    async loadConfigFiles() {
        try {
            const [manifestRes, contractRes] = await Promise.all([
                fetch('skins/manifest.json'),
                fetch('skins/contract.json')
            ]);
            if (manifestRes.ok) this.config = await manifestRes.json();
            if (contractRes.ok) this.contract = await contractRes.json();
        } catch (error) {
            console.error('[SkinManager] Failed to load skin configs', error);
        }
    }

    loadState() {
        this.state.enabled = this.readStoredBoolean(this.storage.enabled, false);
        this.state.skinId = localStorage.getItem(this.storage.activeSkin) || this.config.defaultSkinId || 'default';
        this.themePreferences = this.readStoredJson(this.storage.skinThemes, {});
        if (this.elements.enabled) {
            this.elements.enabled.checked = this.state.enabled;
        }
    }

    readStoredBoolean(key, fallback = false) {
        const value = localStorage.getItem(key);
        if (value === null) return fallback;
        return value === 'true';
    }

    readStoredJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            console.warn(`[SkinManager] Failed to parse ${key}:`, error);
            return fallback;
        }
    }

    shouldShowAutoTestButton() {
        const forcedVisible = this.readStoredBoolean('skinDevTools', false);
        const argv = typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv : [];
        return forcedVisible || argv.includes('--test') || argv.includes('--testclient');
    }

    syncDevControlsVisibility() {
        if (!this.elements.runAutoTest) return;
        this.elements.runAutoTest.hidden = !this.shouldShowAutoTestButton();
    }

    bindEvents() {
        if (this.elements.enabled) {
            this.elements.enabled.addEventListener('change', async (e) => {
                this.state.enabled = e.target.checked;
                localStorage.setItem(this.storage.enabled, String(this.state.enabled));
                await this.applySelectedSkin();
                this.render();
            });
        }

        if (this.elements.root) {
            this.elements.root.addEventListener('click', async (e) => {
                const card = e.target.closest('.skin-card');
                if (!card) return;
                if (card.dataset.compatible !== 'true') {
                    this.setStatus(`"${card.dataset.skinName}" is layout-only and cannot be applied at runtime.`, 'warn');
                    return;
                }
                if (!this.state.enabled) {
                    this.state.enabled = true;
                    localStorage.setItem(this.storage.enabled, 'true');
                    if (this.elements.enabled) {
                        this.elements.enabled.checked = true;
                    }
                    this.setStatus('Skin system enabled automatically.', 'ok');
                }
                const skinId = card.dataset.skinId;
                this.state.skinId = skinId;
                localStorage.setItem(this.storage.activeSkin, skinId);
                this.setStatus(`Applying "${card.dataset.skinName}"...`, 'info');
                await this.applySelectedSkin();
                this.render();
            });
        }

        if (this.elements.themes) {
            this.elements.themes.addEventListener('click', (e) => {
                const btn = e.target.closest('.skin-theme-pill');
                if (!btn || !this.state.enabled) return;
                this.setTheme(btn.dataset.themeId);
            });
        }

        if (this.elements.runDiagnostics) {
            this.elements.runDiagnostics.addEventListener('click', () => {
                const report = this.runDiagnostics();
                if (!this.elements.diagnosticsOutput) return;
                this.elements.diagnosticsOutput.classList.add('visible');
                this.elements.diagnosticsOutput.textContent = JSON.stringify(report, null, 2);
            });
        }

        if (this.elements.runAutoTest) {
            this.elements.runAutoTest.addEventListener('click', async () => {
                const result = await this.runAutoTest();
                if (!this.elements.diagnosticsOutput) return;
                this.elements.diagnosticsOutput.classList.add('visible');
                this.elements.diagnosticsOutput.textContent = JSON.stringify(result, null, 2);
            });
        }
    }

    observeThemeChanges() {
        if (this.themeObserver) return;
        this.themeObserver = new MutationObserver(async (mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName === 'data-theme') {
                    await this.onThemeChanged();
                }
            }
        });
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    async onThemeChanged() {
        const currentTheme = this.getTheme();
        document.documentElement.setAttribute('data-skin-theme-token', currentTheme);
        if (!this.state.enabled) return;
        const skin = this.getSkin(this.state.skinId);
        if (!skin || skin.id === 'default') return;
        const supported = skin.supportedThemes || [];
        if (!supported.includes(currentTheme)) {
            const fallback = skin.defaultTheme || supported[0] || 'dark';
            if (currentTheme !== fallback) {
                this.logDiagnostic('warn', `Theme "${currentTheme}" not supported by ${skin.id}; switched to "${fallback}"`);
                this.setTheme(fallback);
            }
            return;
        }
        await this.loadThemeStylesheet(skin.id, currentTheme);
        this.renderThemePills();
    }

    getTheme() {
        return document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';
    }

    setTheme(themeId) {
        document.documentElement.setAttribute('data-theme', themeId);
        document.documentElement.setAttribute('data-skin-theme-token', themeId);
        localStorage.setItem('theme', themeId);
        if (this.state.enabled && this.state.skinId) {
            this.themePreferences[this.state.skinId] = themeId;
            localStorage.setItem(this.storage.skinThemes, JSON.stringify(this.themePreferences));
        }
        document.querySelectorAll('.theme-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.theme === themeId);
        });
        this.renderThemePills();
    }

    getSkin(id) {
        return (this.config.skins || []).find((skin) => skin.id === id);
    }

    async applySelectedSkin() {
        if (this.state.loading) {
            this.state.pendingApply = true;
            return;
        }
        this.state.loading = true;
        this.state.pendingApply = false;
        try {
            if (!this.state.enabled) {
                await this.disableSkinSystem();
                return;
            }
            const selected = this.getSkin(this.state.skinId) || this.getSkin(this.config.defaultSkinId || 'default');
            if (!selected) return;
            if (!selected.compatible) {
                this.setStatus(`"${selected.name}" is a layout prototype and not runtime-compatible.`);
                this.state.skinId = this.config.defaultSkinId || 'default';
                localStorage.setItem(this.storage.activeSkin, this.state.skinId);
            }
            const finalSkin = this.getSkin(this.state.skinId);
            await this.applySkin(finalSkin);
        } finally {
            this.state.loading = false;
            if (this.state.pendingApply) {
                this.state.pendingApply = false;
                await this.applySelectedSkin();
            }
        }
    }

    async applySkin(skin) {
        if (!skin) return;
        if (skin.id === 'default') {
            this.clearSkinStyles();
            document.documentElement.setAttribute('data-active-skin', 'default');
            document.documentElement.setAttribute('data-skin-contract-token', 'default');
            document.documentElement.setAttribute('data-skin-theme-token', this.getTheme());
            this.setStatus('Default skin active. Existing theme system remains unchanged.', 'ok');
            this.runDiagnostics();
            return;
        }

        const currentTheme = this.getTheme();
        const supported = skin.supportedThemes || [];
        const preferredTheme = this.themePreferences[skin.id];
        const themeCandidate = preferredTheme || currentTheme;
        const theme = supported.includes(themeCandidate) ? themeCandidate : (skin.defaultTheme || supported[0] || 'dark');
        if (theme !== currentTheme) this.setTheme(theme);

        try {
            await this.loadStylesheet('active-skin-link', `skins/${skin.id}/skin.css`);
            await this.loadThemeStylesheet(skin.id, theme);
            document.documentElement.setAttribute('data-active-skin', skin.id);
            document.documentElement.setAttribute('data-skin-contract-token', skin.id);
            document.documentElement.setAttribute('data-skin-theme-token', theme);
            this.setStatus(`Skin "${skin.name}" active (${this.getThemeLabel(skin, theme)}).`, 'ok');
            this.logDiagnostic('info', `Applied skin "${skin.id}" with theme "${theme}"`);
        } catch (error) {
            this.clearSkinStyles();
            document.documentElement.setAttribute('data-active-skin', 'default');
            document.documentElement.setAttribute('data-skin-contract-token', 'default');
            document.documentElement.setAttribute('data-skin-theme-token', this.getTheme());
            this.state.skinId = this.config.defaultSkinId || 'default';
            localStorage.setItem(this.storage.activeSkin, this.state.skinId);
            this.setStatus(`Failed to load skin. Reverted to default. ${error.message}`, 'error');
            this.logDiagnostic('error', `Skin load failed: ${error.message}`);
        }

        this.runDiagnostics();
    }

    async loadThemeStylesheet(skinId, themeId) {
        await this.loadStylesheet('active-skin-theme-link', `skins/${skinId}/themes/${themeId}.css`);
    }

    loadStylesheet(linkId, href) {
        return new Promise((resolve, reject) => {
            let link = document.getElementById(linkId);
            if (!link) {
                link = document.createElement('link');
                link.id = linkId;
                link.rel = 'stylesheet';
                document.head.appendChild(link);
            }
            const nextHref = `${href}?v=1`;
            if (link.getAttribute('href') === nextHref && link.sheet) {
                resolve();
                return;
            }

            const done = () => {
                clearTimeout(timer);
                link.removeEventListener('load', done);
                link.removeEventListener('error', fail);
                resolve();
            };
            const fail = () => {
                clearTimeout(timer);
                link.removeEventListener('load', done);
                link.removeEventListener('error', fail);
                reject(new Error(`Unable to load ${href}`));
            };
            const timer = setTimeout(() => {
                link.removeEventListener('load', done);
                link.removeEventListener('error', fail);
                reject(new Error(`Timed out loading ${href}`));
            }, 4500);

            link.addEventListener('load', done, { once: true });
            link.addEventListener('error', fail, { once: true });
            link.href = nextHref;
        });
    }

    clearSkinStyles() {
        ['active-skin-link', 'active-skin-theme-link'].forEach((id) => {
            const node = document.getElementById(id);
            if (node) node.remove();
        });
    }

    async disableSkinSystem() {
        this.clearSkinStyles();
        document.documentElement.setAttribute('data-active-skin', 'default');
        document.documentElement.setAttribute('data-skin-contract-token', 'default');
        document.documentElement.setAttribute('data-skin-theme-token', this.getTheme());
        this.setStatus('Skin system disabled. Current default UI is untouched.', 'info');
        this.runDiagnostics();
    }

    setStatus(text, level = 'info') {
        if (this.silentMode) return;
        if (this.elements.status) {
            this.elements.status.textContent = text;
            this.elements.status.classList.remove('ok', 'warn', 'error', 'info');
            this.elements.status.classList.add(level);
        }
    }

    render() {
        if (!this.state.enabled) {
            this.setStatus('Skin system is OFF. Click a compatible skin to enable and apply instantly.', 'info');
        }
        this.renderSkinCards();
        this.renderThemePills();
    }

    renderSkinCards() {
        if (!this.elements.root) return;
        const skins = this.config.skins || [];
        this.elements.root.innerHTML = skins.map((skin) => {
            const isActive = this.state.skinId === skin.id;
            const compatibilityClass = skin.compatible ? 'ok' : 'no';
            const compatibleText = skin.compatible ? 'compatible' : 'layout-only';
            const cardClass = `skin-card${isActive ? ' active' : ''}${skin.compatible ? '' : ' incompatible'}`;
            const preview = skin.preview || {};
            const compatibleTitle = skin.compatible ? 'Ready for runtime apply' : 'Not runtime-compatible yet';
            return `
                <button
                    class="${cardClass}"
                    type="button"
                    data-skin-id="${skin.id}"
                    data-skin-name="${skin.name}"
                    data-compatible="${skin.compatible}"
                    title="${compatibleTitle}">
                    <div class="skin-preview" style="background:${preview.base || 'var(--card-bg)'};--preview-sidebar:${preview.sidebar || 'rgba(0,0,0,0.04)'};--preview-accent:${preview.accent || '#999'};"></div>
                    <div class="skin-card-header">
                        <span class="skin-name">${skin.name}</span>
                        <span class="skin-compat ${compatibilityClass}">${compatibleText}</span>
                    </div>
                    <div class="skin-card-desc">${skin.description || ''}</div>
                </button>
            `;
        }).join('');
    }

    renderThemePills() {
        if (!this.elements.themes) return;
        const skin = this.getSkin(this.state.skinId) || this.getSkin(this.config.defaultSkinId || 'default');
        if (!skin) return;
        const theme = this.getTheme();
        const themes = skin.supportedThemes || ['light', 'solar', 'dark'];
        this.elements.themes.innerHTML = themes.map((themeId) => {
            const active = themeId === theme ? ' active' : '';
            const label = this.getThemeLabel(skin, themeId);
            const disabled = this.state.enabled ? '' : ' disabled';
            return `<button type="button" class="skin-theme-pill${active}" data-theme-id="${themeId}"${disabled}>${label}</button>`;
        }).join('');
    }

    getThemeLabel(skin, themeId) {
        return (skin.themeLabels && skin.themeLabels[themeId]) || themeId;
    }

    runDiagnostics() {
        const activeSkin = document.documentElement.getAttribute('data-active-skin') || 'default';
        const expectedIds = this.contract.requiredIds || [];
        const missingIds = expectedIds.filter((id) => !document.getElementById(id));
        const skinToken = document.documentElement.getAttribute('data-skin-contract-token')
            || getComputedStyle(document.documentElement).getPropertyValue('--skin-contract-id').trim();
        const themeToken = document.documentElement.getAttribute('data-skin-theme-token')
            || getComputedStyle(document.documentElement).getPropertyValue('--skin-theme-id').trim();
        const hasRuntimeLinks = !!document.getElementById('active-skin-link') === !!document.getElementById('active-skin-theme-link');
        const currentTheme = this.getTheme();

        const report = {
            ts: new Date().toISOString(),
            featureEnabled: this.state.enabled,
            activeSkin,
            dataTheme: currentTheme,
            tokens: {
                skinContractId: skinToken || null,
                skinThemeId: themeToken || null
            },
            checks: {
                missingRequiredDomIds: missingIds,
                runtimeStylesheetPairConsistent: hasRuntimeLinks
            }
        };
        const tokenMatches = activeSkin === 'default'
            ? (skinToken === 'default')
            : (skinToken === activeSkin && themeToken === currentTheme);
        report.ok = missingIds.length === 0 && hasRuntimeLinks && tokenMatches;
        this.lastDiagnostics = report;
        this.persistDiagnostics(report);
        if (this.elements.diagnosticsOutput && this.elements.diagnosticsOutput.classList.contains('visible')) {
            this.elements.diagnosticsOutput.textContent = JSON.stringify(report, null, 2);
        }
        if (this.state.enabled && !report.ok) {
            this.setStatus('Skin diagnostics found issues. See diagnostics output.', 'warn');
        }
        return report;
    }

    persistDiagnostics(report) {
        this.logDiagnostic(report.ok ? 'info' : 'warn', `Skin diagnostics ${report.ok ? 'passed' : 'reported issues'}`);
    }

    logDiagnostic(level, message) {
        const entry = {
            ts: new Date().toISOString(),
            level,
            message
        };
        console[level === 'error' ? 'error' : 'log']('[SkinManager]', message);
        const history = JSON.parse(localStorage.getItem(this.storage.diagnostics) || '[]');
        history.push(entry);
        while (history.length > 50) history.shift();
        localStorage.setItem(this.storage.diagnostics, JSON.stringify(history));
        window.__skinDiagnostics = history;
    }

    async runAutoTest() {
        const startedAt = new Date().toISOString();
        const previousState = {
            enabled: this.state.enabled,
            skinId: this.state.skinId,
            theme: this.getTheme()
        };
        const compatibleSkins = (this.config.skins || []).filter((skin) => skin.compatible && skin.id !== 'default');
        const cases = [];
        this.silentMode = true;

        try {
            this.state.enabled = true;
            localStorage.setItem(this.storage.enabled, 'true');
            if (this.elements.enabled) this.elements.enabled.checked = true;

            for (const skin of compatibleSkins) {
                const themes = skin.supportedThemes || ['light', 'solar', 'dark'];
                for (const theme of themes) {
                    this.state.skinId = skin.id;
                    localStorage.setItem(this.storage.activeSkin, skin.id);
                    this.setTheme(theme);
                    await this.applySelectedSkin();
                    const report = this.runDiagnostics();
                    cases.push({
                        skin: skin.id,
                        theme,
                        ok: report.ok,
                        tokens: report.tokens,
                        checks: report.checks
                    });
                }
            }
        } finally {
            this.silentMode = false;
            this.state.enabled = previousState.enabled;
            if (this.elements.enabled) this.elements.enabled.checked = previousState.enabled;
            localStorage.setItem(this.storage.enabled, String(previousState.enabled));
            this.state.skinId = previousState.skinId;
            localStorage.setItem(this.storage.activeSkin, previousState.skinId);
            this.setTheme(previousState.theme);
            await this.applySelectedSkin();
            this.render();
        }

        const failed = cases.filter((item) => !item.ok);
        const summary = {
            ts: startedAt,
            tested: cases.length,
            passed: cases.length - failed.length,
            failed: failed.length,
            failures: failed,
            cases
        };
        this.setStatus(
            failed.length ? `Auto test failed in ${failed.length}/${cases.length} cases.` : `Auto test passed (${cases.length} cases).`,
            failed.length ? 'warn' : 'ok'
        );
        return summary;
    }
}

window.skinManager = new SkinManager();
document.addEventListener('DOMContentLoaded', () => {
    window.skinManager.initialize().catch((error) => {
        console.error('[SkinManager] Initialization failed', error);
    });
});
