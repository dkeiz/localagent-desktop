# Backend LLM Inference Review & Caching Strategy

I have reviewed the inference pipeline (`inference-dispatcher.js`, `ai-service.js`, and the provider adapters). You are hitting a classic problem in local AI orchestration: **KV Cache Invalidation**. 

When you notice that a cache miss forces the local LLM to "refill the entire conversation" (which takes a massive amount of time locally), it is almost always caused by a dynamic prefix. 

Here is a deep dive into the weak points of the current workflow and exactly how to implement caching to solve these issues.

## 1. The Cache Killer: Dynamic System Prompts
**File:** `src/main/inference-dispatcher.js`

**The Weak Point:**
Every time `dispatch()` is called, `_buildSystemPrompt()` generates the system prompt from scratch. This is fatal for prompt caching.
Inside the system prompt, you inject highly dynamic data:
*   Subagent statuses: `status=${agent.status || 'idle'}`
*   Active Rules (which can change mid-session)
*   Available Tools (if permissions toggle)

**Why this breaks caching:**
Both local backends (Ollama, LM Studio) and cloud backends (OpenAI, Anthropic) use **Prefix Caching**. They compare the incoming sequence of tokens to the previous one. If the tokens match from the beginning, they reuse the computed KV cache. 
If the system prompt (the very first message) changes by even *one character* (e.g., a subagent changes from "idle" to "running"), the prefix match fails at token #500. The LLM is forced to throw away the cache and re-compute the entire 8,000+ token history from scratch.

**The Solution:**
Split your context into "Static" and "Dynamic" parts to preserve the prefix.
1.  **Static System Prompt:** Put identity, tool definitions (schemas), and permanent rules in the `system` message. **Freeze this.** Do not change it for the duration of the session.
2.  **Dynamic Context Updates:** Put dynamic data (subagent statuses, current time, dynamic memory) into a hidden `user` message that is injected at the *end* of the conversation history, right before the user's actual prompt. 
    *   *Architecture:* `[Static System] -> [History Message 1] -> [History Message 2] -> [Dynamic Status Update (Hidden)] -> [Current User Prompt]`
    *   Because the `[Static System]` and `[History 1 & 2]` never change, the LLM will cache 95% of the prompt and only compute the new dynamic status and user prompt.

## 2. Missing Native Prompt Caching (Anthropic)
**File:** `src/main/providers/openai-compatible-adapter.js`

**The Weak Point:**
You are routing Anthropic through the `OpenAICompatibleAdapter`. While proxies (like LiteLLM) can translate OpenAI shapes to Anthropic shapes, you are missing out on Anthropic's **native Prompt Caching API**. 
Anthropic allows you to explicitly cache huge contexts (like your workflow guides and tool schemas), reducing prefill costs by 90% and making it nearly instant.

**The Solution:**
To use Anthropic's caching, the payload needs explicit `cache_control` markers. If you build a dedicated Anthropic adapter (or update the proxy payload), you should inject `{"type": "ephemeral"}` in two places:
1.  At the end of your static tool definitions/system prompt.
2.  On the second-to-last message in the `history` array.
This will drastically speed up cloud inference when using Claude.

## 3. Ollama Keep-Alive & Context Eviction
**File:** `src/main/providers/ollama-adapter.js`

**The Weak Point:**
By default, Ollama unloads a model from VRAM after 5 minutes of inactivity. If a local agent triggers a long-running python script or web search that takes 6 minutes, Ollama evicts the model. When the agent tries to resume, Ollama has to reload the 10GB model *and* re-compute the entire un-cached prompt.

**The Solution:**
In `OllamaAdapter.call()`, explicitly pass the `keep_alive` parameter in your request body.
```javascript
const requestBody = {
    model: options.model,
    messages: processedMessages,
    keep_alive: "30m", // Keep hot in memory for 30 minutes
    options: { ... }
}
```

## 4. The Global Inference Lock Bottleneck
**File:** `src/main/inference-dispatcher.js`

**The Weak Point:**
You have a global mutex `_acquireLock()` around inference. This forces all LLM calls to run sequentially. This makes sense for a local Ollama instance running on a single GPU (which can't handle concurrent batching well).
However, if you are using Cloud providers (OpenAI, Anthropic) or a local backend that supports continuous batching (like `vLLM`), this lock artificially throttles your subagents. 

**The Solution:**
Make the lock "provider-aware". 
```javascript
const isLocalSingleBatch = this.aiService.getCurrentProvider() === 'ollama' || this.aiService.getCurrentProvider() === 'lmstudio';
if (isLocalSingleBatch && !skipLock) {
    await this._acquireLock();
}
```
This allows cloud providers to run multi-agent workflows entirely in parallel while protecting local GPUs from out-of-memory crashes.

## 5. Multi-Agent Concurrency & Provider Routing Blockers
**Files:** `src/main/ai-service.js` & `src/main/inference-dispatcher.js`

**The Weak Point:**
If you launch multiple subagents, the backend completely fails to route them independently. 
1. **Singleton Provider State:** `AIService` stores a single, global `this.currentProvider`. When `sendMessage()` is called, it blindly routes the request to that active provider. If Agent A wants Ollama and Agent B wants OpenRouter, they cannot run concurrently; one will inherit the other's provider.
2. **Node.js Mutex vs Engine Queues:** `inference-dispatcher.js` calls `this._acquireLock()` which locks the entire Node.js thread for generation.

**How Local Engines Actually Handle Concurrency:**
*   **Ollama / LM Studio:** By default, they have a queue of 1. If you send 2 concurrent requests, they safely process one and HTTP-hang the other until ready. (Ollama can do parallel generation if you configure `OLLAMA_NUM_PARALLEL=2`, which splits VRAM).
*   **vLLM:** Uses *Continuous Batching*. If you send 10 concurrent requests to vLLM, it batches them together and runs them in parallel on the GPU. By locking requests in Node.js, you are breaking vLLM's ability to batch!

**The Solution:**
1. Update `AIService.sendMessage(messages, options)` to read `options.provider` first, falling back to `this.currentProvider` only if undefined.
2. Update `inference-dispatcher.js` so that when a subagent is loaded, its specific provider and model are passed into `options`.
3. Drop the `_acquireLock()` entirely for engines that have built-in request queues (which is practically all of them), or only use it to protect specific fragile setups.
