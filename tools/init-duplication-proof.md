# Init Duplication Proof

This proof used a runnable harness that executes real renderer startup scripts in a mocked DOM/Electron environment:

- `src/renderer/components/main-panel.js`
- `src/renderer/app.js`

Harness file: `tools/prove-init-duplication.js`

## Legacy Double-Init Mode (reproduces old behavior)

Command:

```powershell
node tools/prove-init-duplication.js --legacy-app-double-init --expect=double
```

Output:

```json
{
  "domContentLoadedHandlers": 2,
  "mainPanelCtorCalls": 2,
  "sendBtnClickListeners": 2,
  "toolPermissionIpcListeners": 2,
  "conversationUpdateIpcListeners": 2,
  "windowMainPanelExists": true,
  "windowAppMainPanelExists": true,
  "sameReference": false
}
```

Interpretation: when `App` creates a second `MainPanel`, startup creates two independent `MainPanel` objects and duplicates listeners.

## After Rewire (current)

Command:

```powershell
node tools/prove-init-duplication.js --expect=single
```

Output:

```json
{
  "domContentLoadedHandlers": 2,
  "mainPanelCtorCalls": 1,
  "sendBtnClickListeners": 1,
  "toolPermissionIpcListeners": 1,
  "conversationUpdateIpcListeners": 1,
  "windowMainPanelExists": true,
  "windowAppMainPanelExists": true,
  "sameReference": true
}
```

Interpretation: both app references now point to one shared `MainPanel`, and duplicate init-side listeners are removed.
