(() => {
  const SETTINGS_KEY = 'mcp.toolProfiles';
  function esc(v) { return String(v || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function paramsKeys(tool) { return Object.keys(tool?.inputSchema?.properties || {}); }
  function template(tool) { const p = tool?.inputSchema?.properties || {}; const o = {}; for (const k of Object.keys(p)) { const t = p[k]?.type; o[k] = (t === 'number' || t === 'integer') ? 0 : ''; } return JSON.stringify(o, null, 2); }
  async function loadProfiles() { try { const raw = await window.electronAPI?.getSettingValue?.(SETTINGS_KEY); return raw ? JSON.parse(raw) : {}; } catch (_) { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } } }
  async function saveProfiles(data) { const raw = JSON.stringify(data || {}); try { await window.electronAPI?.saveSetting?.(SETTINGS_KEY, raw); } catch (_) {} localStorage.setItem(SETTINGS_KEY, raw); }
  function close(modal) { modal?.remove(); }
  function getProfile(profiles, toolName) { return profiles?.[toolName] || {}; }
  function displayName(tool, profile) { return (profile?.displayName || '').trim() || tool.name; }
  function displayDescription(tool, profile) { return (profile?.description || '').trim() || (tool.description || 'No description provided.'); }
  async function applyUiOverrides() {
    const profiles = await loadProfiles();
    const customNames = new Set((await window.electronAPI?.getCustomTools?.() || []).map((t) => t?.name).filter(Boolean));
    document.querySelectorAll('#mcp-tools-container .mcp-tool-card[data-tool-name]').forEach((card) => {
      const name = card.dataset.toolName;
      const p = getProfile(profiles, name);
      const nameEl = card.querySelector('.tool-card-name');
      const descEl = card.querySelector('.tool-card-description');
      if (customNames.has(name)) return;
      if (nameEl && p.displayName) nameEl.textContent = p.displayName;
      if (descEl && p.description) descEl.textContent = p.description;
    });
    const select = document.getElementById('tool-select');
    if (select) {
      Array.from(select.options || []).forEach((opt) => {
        if (!opt.value) return;
        const p = getProfile(profiles, opt.value);
        if (customNames.has(opt.value)) return;
        if (!p.displayName) return;
        opt.textContent = `${p.displayName} (${opt.value})`;
      });
    }
  }
  function ensureObserver() {
    if (window.__mcpToolSetupObserverAttached) return;
    const container = document.getElementById('mcp-tools-container');
    if (!container) return;
    const observer = new MutationObserver(() => { applyUiOverrides(); });
    observer.observe(container, { childList: true, subtree: true });
    window.__mcpToolSetupObserverAttached = true;
  }
  async function resolveActive(toolName, sidebar) {
    try {
      const context = await window.electronAPI?.permissions?.getContext?.(sidebar?.getPermissionContext?.() || {});
      if (context?.toolStates && Object.prototype.hasOwnProperty.call(context.toolStates, toolName)) return context.toolStates[toolName] === true;
    } catch (_) {}
    const states = await window.electronAPI?.getToolStates?.() || {};
    return states?.[toolName]?.active !== false;
  }
  async function open(tool, sidebar, meta = {}) {
    if (!tool?.name) return;
    const profiles = await loadProfiles();
    const profile = getProfile(profiles, tool.name);
    const activeNow = await resolveActive(tool.name, sidebar);
    const keys = paramsKeys(tool);
    const preset = profile.defaultParams || template(tool);
    let runtimeToolName = tool.name;
    const isCustom = meta?.isCustom === true;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content mcp-tool-setup-modal"><h3>Tool Setup</h3><form id="mcp-tool-setup-form"><label>Tool ID:<input type="text" name="toolId" value="${esc(tool.name)}" readonly></label><label>Name:<input type="text" name="displayName" value="${esc(isCustom ? tool.name : displayName(tool, profile))}" placeholder="Tool name for UI"></label><label>Description:<textarea name="description" rows="3">${esc(isCustom ? (tool.description || 'No description provided.') : displayDescription(tool, profile))}</textarea></label><label style="display:inline-flex;gap:.45rem;align-items:center;"><input type="checkbox" name="active"${activeNow ? ' checked' : ''}> Enabled in current scope</label><label>Default Params:<textarea name="defaultParams" rows="10">${esc(preset)}</textarea></label><div class="mcp-tool-setup-hint">Schema params: ${esc(keys.join(', ') || 'none')}</div><pre class="mcp-tool-setup-result" id="mcp-tool-setup-result"></pre><div class="modal-actions">${isCustom ? '<button type="button" class="danger-btn mcp-delete-btn">Delete</button>' : ''}<button type="button" class="secondary-btn mcp-cancel-btn">Cancel</button><button type="button" class="secondary-btn mcp-test-btn">Test Now</button><button type="button" class="secondary-btn mcp-open-test-btn">Open In Test Tool</button><button type="submit" class="primary-btn">Save</button></div></form></div>`;
    modal.style.cssText = 'position:fixed;inset:0;background-color:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;z-index:1200;';
    const content = modal.querySelector('.mcp-tool-setup-modal');
    content.style.cssText = 'background:var(--card-bg);color:var(--text-primary);border:1px solid var(--border-color);padding:1rem;border-radius:8px;width:min(700px,94vw);max-height:84vh;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.24);';
    const form = modal.querySelector('#mcp-tool-setup-form');
    const result = modal.querySelector('#mcp-tool-setup-result');
    form.style.cssText = 'display:flex;flex-direction:column;gap:.5rem;';
    form.querySelectorAll('label').forEach((l) => { l.style.cssText = 'display:flex;flex-direction:column;gap:.25rem;font-weight:600;'; });
    const setResult = (v, isErr = false) => { result.style.display = v ? 'block' : 'none'; result.style.margin = v ? '.25rem 0' : '0'; result.style.padding = v ? '.5rem' : '0'; result.style.border = v ? '1px solid var(--border-color)' : 'none'; result.style.borderRadius = '6px'; result.style.background = isErr ? 'rgba(220,53,69,.08)' : 'rgba(0,0,0,.05)'; result.textContent = v || ''; };
    const applyToTester = () => { const sel = document.getElementById('tool-select'); const params = document.getElementById('tool-params'); if (sel) sel.value = runtimeToolName; if (params) params.value = form.defaultParams.value; sidebar?.switchTab?.('mcp'); };
    const persist = async () => {
      const enteredName = String(form.displayName.value || '').trim();
      const enteredDescription = String(form.description.value || '').trim();
      if (!enteredName) throw new Error('Name is required');
      if (!enteredDescription) throw new Error('Description is required');
      const previousToolName = runtimeToolName;
      if (isCustom) {
        const update = await window.electronAPI?.updateCustomTool?.(runtimeToolName, { name: enteredName, description: enteredDescription });
        if (!update?.success) throw new Error(update?.error || 'Failed to update custom tool');
        runtimeToolName = update.tool?.name || runtimeToolName;
        form.toolId.value = runtimeToolName;
        if (previousToolName !== runtimeToolName && profiles[previousToolName]) {
          profiles[runtimeToolName] = { ...profiles[previousToolName] };
          delete profiles[previousToolName];
        }
        if (!profiles[runtimeToolName]) profiles[runtimeToolName] = {};
        profiles[runtimeToolName].defaultParams = form.defaultParams.value;
        profiles[runtimeToolName].updatedAt = new Date().toISOString();
      } else {
        profiles[tool.name] = {
          displayName: enteredName,
          description: enteredDescription,
          defaultParams: form.defaultParams.value,
          updatedAt: new Date().toISOString()
        };
      }
      await saveProfiles(profiles);
      const ctx = sidebar?.getPermissionContext?.() || {};
      await window.electronAPI?.setToolActive?.(runtimeToolName, !!form.active.checked, ctx?.agentId ? { agentId: ctx.agentId } : {});
    };
    modal.querySelector('.mcp-cancel-btn').addEventListener('click', () => close(modal));
    modal.querySelector('.mcp-open-test-btn').addEventListener('click', () => { applyToTester(); close(modal); });
    modal.querySelector('.mcp-test-btn').addEventListener('click', async () => { try { const payload = JSON.parse(form.defaultParams.value || '{}'); setResult('Executing...'); const res = await window.electronAPI?.executeMCPToolOnce?.(runtimeToolName, payload); setResult(JSON.stringify(res, null, 2)); } catch (err) { setResult(`Error: ${err.message}`, true); } });
    const deleteBtn = modal.querySelector('.mcp-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete custom tool "${runtimeToolName}"?`)) return;
        const deleted = await window.electronAPI?.deleteCustomTool?.(runtimeToolName);
        if (!deleted?.success) { setResult(`Delete failed: ${deleted?.error || 'unknown error'}`, true); return; }
        delete profiles[runtimeToolName];
        await saveProfiles(profiles);
        if (sidebar?.currentTab === 'mcp') await sidebar.loadMCPTools();
        close(modal);
      });
    }
    form.addEventListener('submit', async (e) => { e.preventDefault(); try { JSON.parse(form.defaultParams.value || '{}'); await persist(); setResult('Saved tool setup.'); if (sidebar?.currentTab === 'mcp') await sidebar.loadMCPTools(); await applyUiOverrides(); } catch (err) { setResult(`Save failed: ${err.message}`, true); } });
    modal.addEventListener('click', (event) => { if (event.target === modal) close(modal); });
    document.body.appendChild(modal);
  }
  window.mcpToolSetup = { open, applyUiOverrides };
  document.addEventListener('DOMContentLoaded', () => { ensureObserver(); applyUiOverrides(); });
})();
