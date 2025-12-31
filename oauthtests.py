import json, os, requests

with open(os.path.expanduser("~/.qwen/oauth_creds.json")) as f:
    token = json.load(f)["access_token"]

resp = requests.post("https://portal.qwen.ai/v1/chat/completions",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json={
        "model": "qwen-plus",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 10
    })
print(resp.status_code)
print(resp.json())