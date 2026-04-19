# TTS Plugin Contract

TTS has two user-facing modes:

1. **Default**: use the browser/system speech engine. No plugin or server setup is required.
2. **Custom**: enable a plugin with `capabilities: ["tts"]`. The bundled `http-tts-bridge` plugin adapts HTTP TTS servers.

## Simple Custom Setup

For most users, Plugin Studio should show only:

- **IP / Server URL**: base URL such as `http://127.0.0.1:8000`
- **API key**: optional authorization key
- **Style**: server preset/style, for example `default`, `calm`, or `narrator`
- **Config file**: optional JSON adapter config for non-standard servers

The Probe button calls the plugin action `previewVoice` and plays a short sample through the real custom server.

## Plugin Manifest

```json
{
  "id": "my-tts-plugin",
  "name": "My TTS Plugin",
  "main": "main.js",
  "capabilities": ["tts"],
  "capabilityContracts": {
    "tts": {
      "id": "tts.v1",
      "version": 1,
      "actions": ["speak", "stop", "listVoices", "previewVoice", "healthCheck"]
    }
  }
}
```

## Runtime Shape

Core calls `speak` with:

```json
{
  "text": "Text to speak",
  "voice": "optional voice id",
  "speed": 1,
  "sessionId": "active chat id",
  "agent": {
    "id": 1,
    "name": "Research Orchestrator",
    "slug": "research-orchestrator"
  }
}
```

Plugins may return an audio URL, base64 audio, or an `audio` object. Core normalizes those into `tts.v1`.

```json
{ "audioUrl": "http://127.0.0.1:8000/out.wav", "mimeType": "audio/wav" }
```

```json
{ "audioBase64": "...", "mimeType": "audio/wav" }
```

## Optional HTTP Bridge Config File

Use this only when a server does not follow the bridge defaults.

```json
{
  "request": {
    "path": "/tts",
    "method": "POST",
    "mode": "json",
    "template": {
      "text": "{text}",
      "style": "{style}",
      "voice": "{voice}",
      "speed": "{speed}"
    }
  },
  "response": {
    "audioUrlPath": "audio.url|audio_url|url",
    "audioBase64Path": "audio.base64|audio_base64",
    "mimeTypePath": "audio.mimeType|mimeType"
  },
  "voices": {
    "path": "/voices",
    "responsePath": "voices|data"
  },
  "probePath": "/health",
  "apiKeyHeader": "Authorization",
  "apiKeyPrefix": "Bearer "
}
```

The config file keeps the UI simple while still letting other users adapt different TTS servers.
