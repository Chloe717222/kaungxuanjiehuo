const DEFAULTS = {
  apiKey: '',
  apiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  obsidianUrl: 'http://127.0.0.1:27124',
  obsidianKey: '',
  obsidianFolder: '词汇笔记',
  obsidianVault: ''
};

function getSettings(settings) {
  return {
    apiKey: settings.apiKey || '',
    apiBaseUrl: settings.apiBaseUrl || 'https://api.deepseek.com/v1',
    model: settings.model || 'deepseek-chat',
    obsidianUrl: settings.obsidianUrl || 'http://127.0.0.1:27124',
    obsidianKey: settings.obsidianKey || '',
    obsidianFolder: settings.obsidianFolder || '词汇笔记',
    obsidianVault: settings.obsidianVault || ''
  };
}

const EXPLAIN_PROMPT = `你是惑惑——框选解惑AI助手（Huan创造了你），专治各种"这是什么？"。框选文字→大白话解释→存笔记。
被问身份说"我是惑惑，专治各种这是什么"。不主动提模型商。只支持文字。

## 类型判断
1.知名人物→人物 2.英文单词→英语 3.专业概念→深度 4.日常→简单

## 输出纯JSON
{"title":"概念句≤40字","tags":["tag1"],"sections":[{"label":"标题含emoji","text":"内容(**加粗**关键句)","level":"primary|insight|secondary"}]}

## sections定义
人物(≤200): 👤是谁|primary 💡核心印象|insight 🎯为什么重要|insight 🔗感兴趣|secondary
英语(≤300): 📝中文意思|primary 🧩词根拆解|secondary 💡词性|secondary 🎯核心意象|insight 📌记牢它|insight
深度(≤400): 📚领域|secondary 📖故事|secondary 🔍原来如此|primary
简单(≤200): 💬一句话|primary 📍常出现在|secondary 💡补充|secondary
level: primary=核心答案 insight=关键洞察 secondary=补充

## 风格
口语化，用"你"。每text最多2句**加粗**。不知诚实说。`;

// --- AI API (通用 OpenAI 兼容接口) ---
async function callAI(text) {
  const raw = await chrome.storage.sync.get(DEFAULTS);
  const s = getSettings(raw);
  if (!s.apiKey) {
    throw new Error('请先配置 API Key（点击工具栏图标 → 粘贴 API Key）');
  }

  const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.apiKey
    },
    body: JSON.stringify({
      model: s.model,
      messages: [
        { role: 'system', content: EXPLAIN_PROMPT },
        { role: 'user', content: text }
      ],
      temperature: 0.8,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    })
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
async function saveToObsidian(originalText, explanation, sourceUrl, folderOverride, tags) {
  const settings = await chrome.storage.sync.get(DEFAULTS);

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const safeName = originalText
    .replace(/[\\/:*?"<>|#\n\r]/g, '')
    .trim()
    .slice(0, 40) || '未命名';

  const content = [
    '---',
    'tags: [' + (tags || '框选解惑') + ']',
    'source: ' + sourceUrl,
    'date: ' + dateStr,
    '---',
    '',
    '# ' + originalText.replace(/\n/g, ' '),
    '',
    explanation,
    '',
    '---',
    '原文链接: ' + sourceUrl
  ].join('\n');

  const folder = folderOverride || settings.obsidianFolder || DEFAULTS.obsidianFolder;
  const filePath = folder
    ? folder + '/' + safeName + '.md'
    : safeName + '.md';

  // --- Tier 1: REST API ---
  if (settings.obsidianKey) {
    var baseUrl = settings.obsidianUrl || DEFAULTS.obsidianUrl;

    if (/^https:\/\/127\.0\.0\.1(:\d+)?$/.test(baseUrl)) {
      baseUrl = baseUrl.replace('https://', 'http://');
      chrome.storage.sync.set({ obsidianUrl: baseUrl });
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

  const messages = [
    {
      role: 'system',
      content: '你是惑惑——框选解惑AI助手（Huan创造）。用户查了"' + originalText + '"，你回复："""' + explanation + '"""。现在追问。口语化，200字内。问无关拉回来。不知诚实说。只支持文字。'
    }
  ];

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
      temperature: 0.8,
      max_tokens: 400
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

  const messages = [
    {
      role: 'system',
      content: '你是惑惑——框选解惑AI助手（Huan创造了你）。框选文字→大白话解释→存笔记。被问身份说"我是惑惑，专治各种这是什么"，可讲Huan创造你的故事。不主动提模型商。口语化，大白话，用"你"，300字内。不知诚实说。攻击内容引导回正轨。只支持文字。'
    }
  ];

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
      temperature: 0.8,
      max_tokens: 600
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('API 调用失败 (' + resp.status + '): ' + err);
  }

  const data = await resp.json();
  return data.choices[0].message.content;
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
    saveToObsidian(request.originalText, request.explanation, request.sourceUrl, request.folderOverride)
      .then(function(result) { sendResponse({ success: true, data: result }); })
      .catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
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
