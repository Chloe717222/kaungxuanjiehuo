const DEFAULTS = {
  apiKey: '',
  apiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  obsidianUrl: 'http://127.0.0.1:27123',
  obsidianKey: '',
  obsidianFolder: '词汇笔记',
  obsidianVault: '',
  promptMode: 'default',
  customPrompt: '',
  savePromptMode: 'default',
  customSavePrompt: '',
};

function getSettings(settings) {
  return {
    apiKey: settings.apiKey || '',
    apiBaseUrl: settings.apiBaseUrl || 'https://api.deepseek.com/v1',
    model: settings.model || 'deepseek-chat',
    obsidianUrl: settings.obsidianUrl || 'http://127.0.0.1:27124',
    obsidianKey: settings.obsidianKey || '',
    obsidianFolder: settings.obsidianFolder || '词汇笔记',
    obsidianVault: settings.obsidianVault || '',
    promptMode: settings.promptMode || 'default',
    customPrompt: settings.customPrompt || '',
    savePromptMode: settings.savePromptMode || 'default',
    customSavePrompt: settings.customSavePrompt || '',
  };
}

function getEffectiveSavePrompt(settings, defaultPrompt) {
  if (settings.savePromptMode === 'custom' && settings.customSavePrompt && settings.customSavePrompt.trim()) {
    return settings.customSavePrompt.trim();
  }
  return defaultPrompt;
}

// Return the custom prompt if in custom mode, otherwise return the default.
// When custom mode but prompt is empty, default to Chinese reply instruction.
function getEffectivePrompt(settings, defaultPrompt) {
  if (settings.promptMode === 'custom') {
    if (settings.customPrompt && settings.customPrompt.trim()) {
      return settings.customPrompt.trim();
    }
    return '你是惑惑，Huan-她做的。请用中文回复。';
  }
  return defaultPrompt;
}

const DEFAULT_SAVE_PROMPT = '你是一个笔记整理助手。根据用户提供的原文、解释和追问记录，整理为结构化笔记。\n\n规则：\n1. 标题是一句核心陈述句，必须包含用户搜索的原词\n2. 正文按结构分段，不要遗漏追问中有价值的内容\n3. 只输出JSON：{"title":"核心陈述句（含搜索原词）","summary":"Markdown 格式的笔记正文"}';

const TAG_SYSTEM_RULES = `标签体系（每维选1个，共4个标签）：
类型/ 可选：概念 概述 策略 方法 教程 地图 规范 故障排查 步骤 流程
主题/ 可选：行为经济学 卡片盒 营销 沟通 创业 前端 SVG COS CDN 物联网 经济学 心理学 深度学习 项目管理（如内容主题不在列表中可合理新增）
状态/ 固定为：种子（新笔记一律种子，用户后续手动升级）
难度/ 可选：初级 中级 高级`;

const NOTE_PLAN_PROMPT = `你是"框选解惑"的笔记规划师。根据用户框选的原文、AI解释和追问记录，规划一条日后易于检索和阅读的笔记。

${TAG_SYSTEM_RULES}

目标：写一条自己过几天回看还能秒懂的笔记。

怎么做你来判断。要点参考：
- 标题30字内的核心陈述句，让人一眼知道在说什么，不要用名词短语或关键词堆砌
- 正文提炼最核心的信息，把AI解释和追问转化为易读的笔记
- 不用照搬原文或AI回复原文，用自己的话重组
- "原文"段落只在读者不知道原文就读不懂笔记时才需要（比如英文词、生僻术语），反之可省略
- 对话很长时挑最重要的写，别全都塞进去

输出JSON格式（不要\`\`\`包裹，不加额外文字）：
{"title":"核心句","tags":["类型/xx","主题/xx","状态/种子","难度/xx"],"body":"## 节标题\\n内容..."}

body字段中 \\n 代表换行，请正确转义。`;

// --- AI Prompt Generator（辅助用户编写提示词）---
async function generatePrompt(userInput, promptType) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    throw new Error('请先配置 API Key');
  }

  var metaPrompt = promptType === 'save'
    ? '你是笔记模板生成专家。用户会描述他想要的笔记保存格式，请根据描述生成保存规则。\n\n规则：\n1. 如果用户没特别说明标题规则，使用：标题为一句核心陈述句，必须包含搜索原词\n2. 输出清晰的结构化规则，一行一条\n3. 不要预设内容类型\n4. 直接输出规则内容，不要额外解释和对话\n5. 全部用中文'
    : '你是 AI 提示词生成专家。用户会描述他想要的 AI 对话风格，请根据描述生成一条 system prompt。\n\n规则：\n1. 生成的 system prompt 要简洁、可执行\n2. 不要预设内容类型（英语/代码/概念等），只控制说话方式\n3. 直接输出 system prompt 内容，不要额外解释和对话\n4. 全部用中文，保持口语化\n5. 如果用户描述不具体，补充合理的默认行为（不确定要说不知道）';

  var body = {
    model: s.model,
    messages: [
      { role: 'system', content: metaPrompt },
      { role: 'user', content: userInput }
    ],
    temperature: 0.5,
    max_tokens: 1000
  };

  const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    var err = await resp.text();
    throw new Error('生成失败 (' + resp.status + '): ' + err);
  }
  var data = await resp.json();
  return data.choices[0].message.content;
}

const EXPLAIN_PROMPT = `你是惑惑，帮人"疑惑→理解→沉淀"。
- 长英文（>20词）→ 逐句全文翻译为中文，附加解释可选
- 英文单词/短语 → 释义+发音+用法
- 其他 → 自然解释，直接回答痛点
- 回复必须是干货，禁无效开头
- 不确定就说不知道

输出JSON：
{"title":"≤30字，说清这是什么","tags":["1-3个"],"phonetic":"英文IPA如/ˈfəʊtɛtɪk/，否则''","sections":[{"label":"2-4字标签","text":"口语化解释"}]}

全中文解释，保留原文。长英文情况下第一段必须是全文翻译。`;

// --- AI API (通用 OpenAI 兼容接口) ---
async function callAI(text) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    throw new Error('请先配置 API Key（点击工具栏图标 → 粘贴 API Key）');
  }

  var hasCustomText = s.customPrompt && s.customPrompt.trim();
  var isCustom = s.promptMode === 'custom';
  let systemPrompt, responseFormat;
  if (isCustom && hasCustomText) {
    systemPrompt = hasCustomText + '\n\n⚠️ 代码强制规则（必须遵守）：\n1. 首句直接解释用户框选的文字，首句就要回答，不说无关的话。\n2. 禁止写"好的""收到""明白了""你刚才说"等废话开头。\n3. 禁止反问用户（如"你是想问A还是B？"）。\n4. 禁止教科书式宽泛定义，必须针对框选内容具体解释。\n5. 每句话都传递实质信息。不知道就老实说不知道。';
  } else if (isCustom && !hasCustomText) {
    // Direct mode: empty custom prompt → identity + Chinese only
    systemPrompt = '你是惑惑，Huan-她做的。请用中文回复。';
  } else {
    systemPrompt = EXPLAIN_PROMPT;
    responseFormat = { type: 'json_object' };
  }

  var messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  if (isCustom && !hasCustomText) {
    messages.push({ role: 'user', content: text + '是什么？' });
  } else {
    messages.push({ role: 'user', content: text });
  }

  var body = {
    model: s.model,
    messages: messages,
    temperature: 0.5,
    max_tokens: 600
  };
  if (responseFormat) body.response_format = responseFormat;

  const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.apiKey
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('API 调用失败 (' + resp.status + '): ' + err);
  }

  const data = await resp.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('API 返回格式异常，请确认 API 地址和模型名称正确');
  }
  return data.choices[0].message.content;
}

// --- Obsidian 保存：REST API → URI 回退（URI 由 content script 打开）---
async function saveToObsidian(originalText, explanation, sourceUrl, folderOverride, tags, customFileName) {
  const settings = await chrome.storage.sync.get(DEFAULTS);

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Use custom file name if provided, otherwise auto-generate from originalText
  const safeName = customFileName && customFileName.trim()
    ? customFileName.trim().replace(/[\\/:*?"<>|#\n\r]/g, '').trim().slice(0, 40) || '未命名'
    : originalText.replace(/[\\/:*?"<>|#\n\r]/g, '').trim().slice(0, 40) || '未命名';

  const content = [
    '---',
    'tags: [' + (tags || '框选解惑') + ']',
    'source: ' + sourceUrl,
    'date: ' + dateStr,
    '---',
    '',
    '# ' + originalText.replace(/\n/g, ' '),
    '',
    explanation
  ].join('\n');

  const folder = folderOverride || settings.obsidianFolder || DEFAULTS.obsidianFolder;
  const filePath = folder
    ? folder + '/' + safeName + '.md'
    : safeName + '.md';

  // --- Tier 1: REST API ---
  if (settings.obsidianKey) {
    var baseUrl = settings.obsidianUrl || DEFAULTS.obsidianUrl;

    // If custom file name is specified, try to read existing note and append new content
    if (customFileName && customFileName.trim()) {
      try {
        const getResp = await fetch(baseUrl + '/vault/' + encodeURI(filePath), {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + settings.obsidianKey }
        });
        if (getResp.ok) {
          const existingContent = await getResp.text();
          // Prepend new content with date heading separator
          const newSection = '\n\n---\n\n## ' + dateStr + '\n\n### ' + originalText.replace(/\n/g, ' ') + '\n\n' + explanation;
          const updatedContent = existingContent + newSection;
          const putResp = await fetch(baseUrl + '/vault/' + encodeURI(filePath), {
            method: 'PUT',
            headers: {
              'Content-Type': 'text/markdown',
              'Authorization': 'Bearer ' + settings.obsidianKey
            },
            body: updatedContent
          });
          if (putResp.ok) return { success: true, method: 'rest', appended: true };
        }
      } catch (e) {
        // File doesn't exist or read failed — fall through to create new
      }
    }

    try {
      const resp = await fetch(baseUrl + '/vault/' + encodeURI(filePath), {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/markdown',
          'Authorization': 'Bearer ' + settings.obsidianKey
        },
        body: content
      });

      if (resp.ok) return { success: true, method: 'rest' };

      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Obsidian API Key 验证失败。请确认扩展设置中的 API Key 与 Obsidian 插件中的一致。');
      }
    } catch (e) {
      if (e.message.indexOf('API Key') >= 0) throw e;
      // Non-auth failures (connection refused, etc.) → fall through to URI
    }
  }

  // --- Tier 2: Return URI info for content script to open ---
  var vault = settings.obsidianVault || '';
  // Use same URI format as Obsidian Web Clipper: file= + vault= + content= + overwrite
  var uri = 'obsidian://new?' +
    'file=' + encodeURIComponent(filePath) +
    '&content=' + encodeURIComponent(content) +
    '&overwrite=true';
  if (vault) uri += '&vault=' + encodeURIComponent(vault);

  return {
    success: true,
    method: 'uri',
    uri: uri,
    content: content,
    filePath: filePath
  };
}

// --- AI Chat（追问模式）---
async function callAIChat(originalText, explanation, history, question) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    throw new Error('请先配置 API Key（点击工具栏图标 → 粘贴 API Key）');
  }

  var defaultChatPrompt = '你是惑惑，帮人"疑惑→理解→沉淀"。\n基于已有解释继续回答用户追问。\n- 用户问什么答什么，往深处聊，举具体例子\n- 回复必须是干货，禁无效开头\n- 口语用"你"\n- 不知道就说不知道\n- Markdown排版';
  var systemPrompt = getEffectivePrompt(s, defaultChatPrompt);
  var hasCustomText = s.customPrompt && s.customPrompt.trim();
  if (s.promptMode === 'custom' && hasCustomText) {
    systemPrompt = systemPrompt + '\n\n⚠️ 代码强制规则：首句直接回答用户追问，给出具体例子和细节，必须言之有物。禁止先写"好的""明白了"，禁止反问用户。';
  }

  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  for (var i = 0; i < history.length; i++) {
    messages.push(history[i]);
  }
  messages.push({ role: 'user', content: question });

  const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.apiKey
    },
    body: JSON.stringify({
      model: s.model,
      messages: messages,
      temperature: 0.5,
      max_tokens: 350
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('API 调用失败 (' + resp.status + '): ' + err);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

// --- AI General Chat ---
async function callAIGeneral(history) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    throw new Error('请先配置 API Key（右键扩展图标 → 选项）');
  }

  var defaultGeneralPrompt = '你是惑惑，帮人"疑惑→理解→沉淀"。\n- 用大白话帮用户搞懂疑惑\n- 直接回答，不绕\n- 回复必须是干货，禁无效开头\n- 举例子，言之有物\n- 口语用"你"\n- 不知道就说不知道\n- Markdown排版';
  var systemPrompt = getEffectivePrompt(s, defaultGeneralPrompt);
  var hasCustomText = s.customPrompt && s.customPrompt.trim();
  if (s.promptMode === 'custom' && hasCustomText) {
    systemPrompt = systemPrompt + '\n\n⚠️ 代码强制规则：首句直接回答用户问题，给出具体信息，必须言之有物。禁止先写"好的""明白了"，禁止反问用户。';
  }

  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  for (var i = 0; i < history.length; i++) {
    messages.push(history[i]);
  }

  const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.apiKey
    },
    body: JSON.stringify({
      model: s.model,
      messages: messages,
      temperature: 0.5,
      max_tokens: 1500
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('API 调用失败 (' + resp.status + '): ' + err);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

// --- Note Summarization ---
async function summarizeNote(originalText, explanation, history) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    throw new Error('请先配置 API Key（点击工具栏图标 → 粘贴 API Key）');
  }

  var transcript = '';
  for (var i = 0; i < history.length; i++) {
    var m = history[i];
    transcript += (m.role === 'user' ? '问：' : '答：') + m.content + '\n\n';
  }

  var isCustom = s.savePromptMode === 'custom' && s.customSavePrompt && s.customSavePrompt.trim();

  var body = {
    model: s.model,
    messages: [
      { role: 'system', content: getEffectiveSavePrompt(s, DEFAULT_SAVE_PROMPT) },
      { role: 'user', content: '原文：' + originalText + '\n\n解释：' + explanation + '\n\n追问记录：' + transcript }
    ],
    temperature: 0.5,
    max_tokens: 800
  };
  if (!isCustom) body.response_format = { type: 'json_object' };

  const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.apiKey
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('总结失败 (' + resp.status + '): ' + err);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

// --- Note Planning ---
async function planNote(originalText, explanation, history) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    throw new Error('请先配置 API Key（点击工具栏图标 → 粘贴 API Key）');
  }

  // Build transcript if there's chat history
  var transcript = '';
  if (history && history.length > 0) {
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      transcript += (m.role === 'user' ? '问：' : '答：') + m.content + '\n\n';
    }
  }

  var userContent = '## 原文\n' + originalText + '\n\n## AI解释\n' + explanation;
  if (transcript) {
    userContent += '\n\n## 追问记录\n' + transcript;
  }

  // Check if user has custom save prompt
  var isCustom = s.savePromptMode === 'custom' && s.customSavePrompt && s.customSavePrompt.trim();
  var systemPrompt;
  if (isCustom) {
    // Merge user's custom template with mandatory tag system
    systemPrompt = '用户有自己偏好的笔记格式要求，请尽量满足，同时必须遵守以下规则：\n\n'
      + TAG_SYSTEM_RULES
      + '\n\n用户格式要求：\n' + s.customSavePrompt.trim()
      + '\n\n输出JSON格式：{"title":"核心句","tags":["类型/xx","主题/xx","状态/种子","难度/xx"],"body":"## 你的设计节\\n内容..."}';
  } else {
    systemPrompt = NOTE_PLAN_PROMPT;
  }

  var body = {
    model: s.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 0.3,
    max_tokens: 2000
  };
  if (!isCustom) body.response_format = { type: 'json_object' };

  const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('笔记规划失败 (' + resp.status + '): ' + err);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

// === Streaming API helpers ===

async function streamResponse(resp, port) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              try { port.postMessage({ type: 'token', content: delta }); } catch(e) { return; }
            }
          } catch (e) {}
        }
      }
    }
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6).trim();
      if (data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            try { port.postMessage({ type: 'token', content: delta }); } catch(e) { return; }
          }
        } catch (e) {}
      }
    }

    try { port.postMessage({ type: 'done', fullContent: fullContent }); } catch(e) {}
  } catch (e) {
    try { port.postMessage({ type: 'error', error: e.message }); } catch(ex) {}
  }
}

async function streamCallAI(text, port) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    try { port.postMessage({ type: 'error', error: '请先配置 API Key（点击工具栏图标 → 粘贴 API Key）' }); } catch(e) {}
    return;
  }

  var hasCustomText = s.customPrompt && s.customPrompt.trim();
  var isCustom = s.promptMode === 'custom';
  let systemPrompt, responseFormat;
  if (isCustom && hasCustomText) {
    systemPrompt = hasCustomText + '\n\n⚠️ 代码强制规则（必须遵守）：\n1. 首句直接解释用户框选的文字，首句就要回答，不说无关的话。\n2. 禁止写"好的""收到""明白了""你刚才说"等废话开头。\n3. 禁止反问用户（如"你是想问A还是B？"）。\n4. 禁止教科书式宽泛定义，必须针对框选内容具体解释。\n5. 每句话都传递实质信息。不知道就老实说不知道。';
  } else if (isCustom && !hasCustomText) {
    systemPrompt = '你是惑惑，Huan-她做的。请用中文回复。';
  } else {
    systemPrompt = EXPLAIN_PROMPT;
    responseFormat = { type: 'json_object' };
  }

  var messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (isCustom && !hasCustomText) {
    messages.push({ role: 'user', content: text + '是什么？' });
  } else {
    messages.push({ role: 'user', content: text });
  }

  var body = {
    model: s.model,
    messages: messages,
    temperature: 0.5,
    stream: true
  };
  if (responseFormat && !isCustom) body.response_format = responseFormat;

  try {
    const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const err = await resp.text();
      try { port.postMessage({ type: 'error', error: 'API 调用失败 (' + resp.status + '): ' + err }); } catch(e) {}
      return;
    }

    await streamResponse(resp, port);
  } catch (e) {
    try { port.postMessage({ type: 'error', error: e.message }); } catch(ex) {}
  }
}

async function streamCallAIChat(originalText, explanation, history, question, port) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    try { port.postMessage({ type: 'error', error: '请先配置 API Key（点击工具栏图标 → 粘贴 API Key）' }); } catch(e) {}
    return;
  }

  var defaultChatPrompt = '你是惑惑，帮人"疑惑→理解→沉淀"。\n基于已有解释继续回答用户追问。\n- 用户问什么答什么，往深处聊，举具体例子\n- 回复必须是干货，禁无效开头\n- 口语用"你"\n- 不知道就说不知道\n- Markdown排版';
  var systemPrompt = getEffectivePrompt(s, defaultChatPrompt);
  var hasCustomText = s.customPrompt && s.customPrompt.trim();
  if (s.promptMode === 'custom' && hasCustomText) {
    systemPrompt = systemPrompt + '\n\n⚠️ 代码强制规则：首句直接回答用户追问，给出具体例子和细节，必须言之有物。禁止先写"好的""明白了"，禁止反问用户。';
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (var i = 0; i < history.length; i++) {
    messages.push(history[i]);
  }
  messages.push({ role: 'user', content: question });

  try {
    const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
      body: JSON.stringify({
        model: s.model,
        messages: messages,
        temperature: 0.5,
        stream: true
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      try { port.postMessage({ type: 'error', error: 'API 调用失败 (' + resp.status + '): ' + err }); } catch(e) {}
      return;
    }

    await streamResponse(resp, port);
  } catch (e) {
    try { port.postMessage({ type: 'error', error: e.message }); } catch(ex) {}
  }
}

async function streamCallAIGeneral(history, port) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    try { port.postMessage({ type: 'error', error: '请先配置 API Key（右键扩展图标 → 选项）' }); } catch(e) {}
    return;
  }

  var defaultGeneralPrompt = '你是惑惑，帮人"疑惑→理解→沉淀"。\n- 用大白话帮用户搞懂疑惑\n- 直接回答，不绕\n- 回复必须是干货，禁无效开头\n- 举例子，言之有物\n- 口语用"你"\n- 不知道就说不知道\n- Markdown排版';
  var systemPrompt = getEffectivePrompt(s, defaultGeneralPrompt);
  var hasCustomText = s.customPrompt && s.customPrompt.trim();
  if (s.promptMode === 'custom' && hasCustomText) {
    systemPrompt = systemPrompt + '\n\n⚠️ 代码强制规则：首句直接回答用户问题，给出具体信息，必须言之有物。禁止先写"好的""明白了"，禁止反问用户。';
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (var i = 0; i < history.length; i++) {
    messages.push(history[i]);
  }

  try {
    const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
      body: JSON.stringify({
        model: s.model,
        messages: messages,
        temperature: 0.5,
        stream: true
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      try { port.postMessage({ type: 'error', error: 'API 调用失败 (' + resp.status + '): ' + err }); } catch(e) {}
      return;
    }

    await streamResponse(resp, port);
  } catch (e) {
    try { port.postMessage({ type: 'error', error: e.message }); } catch(ex) {}
  }
}

// --- Message handler ---
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'explain') {
    callAI(request.text)
      .then(function(result) { sendResponse({ success: true, data: result }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (request.action === 'chat') {
    callAIChat(request.originalText, request.explanation, request.history, request.question)
      .then(function(result) { sendResponse({ success: true, data: result }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (request.action === 'generalChat') {
    callAIGeneral(request.history)
      .then(function(result) { sendResponse({ success: true, data: result }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (request.action === 'saveToObsidian') {
    saveToObsidian(request.originalText, request.explanation, request.sourceUrl, request.folderOverride, request.tags, request.customFileName)
      .then(function(result) { sendResponse({ success: true, data: result }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (request.action === 'summarizeNote') {
    summarizeNote(request.originalText, request.explanation, request.history)
      .then(function(result) { sendResponse({ success: true, data: result }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (request.action === 'generatePrompt') {
    generatePrompt(request.userInput, request.promptType)
      .then(function(result) { sendResponse({ success: true, data: result }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }

  if (request.action === 'planNote') {
    planNote(request.originalText, request.explanation, request.history)
      .then(function(result) { sendResponse({ success: true, data: result }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }
});

// --- Speech synthesis (via chrome.tts) ---
chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === 'speech') {
    port.onMessage.addListener(function(msg) {
      if (msg.action === 'speak') {
        chrome.tts.speak(msg.text, {
          lang: msg.lang || 'en-US',
          rate: msg.rate || 0.9,
          volume: 1.0,
          onEvent: function(event) {
            try {
              if (event.type === 'start') {
                port.postMessage({ type: '__WE_SPEECH_START' });
              } else if (event.type === 'end' || event.type === 'interrupted') {
                port.postMessage({ type: '__WE_SPEECH_END' });
              } else if (event.type === 'error') {
                port.postMessage({ type: '__WE_SPEECH_ERROR', error: event.errorMessage });
              }
            } catch(e) {
              // Port may be disconnected
            }
          }
        });
      } else if (msg.action === 'cancel') {
        chrome.tts.stop();
      }
    });

    port.onDisconnect.addListener(function() {
      chrome.tts.stop();
    });
    return;
  }

  // --- Streaming API ports ---
  if (port.name === 'stream-explain') {
    port.onMessage.addListener(function(msg) {
      if (msg.text !== undefined) {
        streamCallAI(msg.text, port);
      }
    });
    return;
  }

  if (port.name === 'stream-chat') {
    port.onMessage.addListener(function(msg) {
      if (msg.question !== undefined) {
        streamCallAIChat(msg.originalText, msg.explanation, msg.history, msg.question, port);
      }
    });
    return;
  }

  if (port.name === 'stream-general') {
    port.onMessage.addListener(function(msg) {
      if (msg.history !== undefined) {
        streamCallAIGeneral(msg.history, port);
      }
    });
    return;
  }
});

// --- Keyboard shortcut ---
chrome.commands.onCommand.addListener(function(command) {
  if (command === 'open-chat') {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs[0]) {
        openChatOrFallback(tabs[0]);
      }
    });
  }
});

function openChatOrFallback(tab) {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { action: 'openChat' }).catch(function() {
    // Content script not available (e.g. chrome:// pages) → open standalone chat page
    chrome.tabs.create({ url: chrome.runtime.getURL('chat.html') });
  });
}
