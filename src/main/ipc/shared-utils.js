function stripToolPatterns(text) {
  if (!text) return '';
  let result = '';
  let i = 0;

  while (i < text.length) {
    const toolMatch = text.slice(i).match(/^TOOL:\w+\{/);
    if (toolMatch) {
      const braceStart = i + toolMatch[0].length - 1;
      let depth = 1;
      let j = braceStart + 1;
      let inString = false;
      let escapeNext = false;

      while (j < text.length && depth > 0) {
        const char = text[j];
        if (escapeNext) {
          escapeNext = false;
          j++;
          continue;
        }
        if (char === '\\') {
          escapeNext = true;
          j++;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          j++;
          continue;
        }
        if (!inString) {
          if (char === '{') depth++;
          else if (char === '}') depth--;
        }
        j++;
      }
      i = j;
    } else {
      result += text[i];
      i++;
    }
  }

  return result.trim();
}

function stripReasoningBlocks(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function buildAssistantContent(response, runtimeConfig = {}) {
  const reasoning = String(response?.reasoning || '').trim();
  const content = String(response?.content || '').trim();
  const visibility = runtimeConfig?.reasoning?.visibility || 'show';

  if (!reasoning || visibility === 'hide') {
    return content;
  }

  return `<think>${reasoning}</think>\n\n${content}`.trim();
}

module.exports = {
  stripToolPatterns,
  stripReasoningBlocks,
  buildAssistantContent
};
