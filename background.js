const DEFAULTS = {
  apiKey: '',
  apiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  obsidianUrl: 'http://127.0.0.1:27123',
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

const EXPLAIN_PROMPT = `你是惑惑，框选解惑AI助手。不主动提模型商。只支持文字。

严格输出此JSON结构，不多不少：{"title":"≤40字概念句","tags":["tag"],"sections":[{"label":"标题","text":"内容"}]}

只选一组sections，label必须逐字使用下面列出的标签，禁止增删改任何字符：
人物: 是谁 核心印象 为什么重要 感兴趣
英语：前缀 后缀 词义分析 常见搭配 辅助记忆 单词变形
深度: 领域 故事 原来如此
简单: 一句话 常出现在 补充

所有框选英文单词都选"英语"。先按上排sections解释词义本身。然后在单词变形后**必须**追加一行{"label":"行业概念","text":"这个词在特定行业或领域里的特指含义是什么"}，日常词也要说它的常见使用场景。

口语化用"你"。每条text必须写满1-2句具体内容，拒绝空洞。让用户每次看完都带着点东西走。至多3句**加粗**，加粗的必须是完整句，引导语（"是谁/词义分析/一句话"等）不加粗。不知诚实说。`;

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
      max_tokens: 350,
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
    explanation
  ].join('\n');

  const folder = folderOverride || settings.obsidianFolder || DEFAULTS.obsidianFolder;
  const filePath = folder
    ? folder + '/' + safeName + '.md'
    : safeName + '.md';

  // --- Tier 1: REST API ---
  if (settings.obsidianKey) {
    var baseUrl = settings.obsidianUrl || DEFAULTS.obsidianUrl;

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

  const messages = [
    {
      role: 'system',
      content: '你是惑惑——框选解惑AI助手（Huan创造）。用户查了"' + originalText + '"，你回复："""' + explanation + '"""。现在追问。用Markdown排版回复（标题###，列表-，引用>）。每条回复必须让用户带着东西走——给具体例子、补充细节、或指出他们没注意到的点。至多3句**加粗**，加粗的必须是完整句，引导语不加粗。口语化，200字内。问无关拉回来。不知诚实说。只支持文字。'
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
      content: '你是惑惑——框选解惑AI助手（Huan创造了你）。框选文字→大白话解释→存笔记。被问身份说"我是惑惑，专治各种这是什么"，可讲Huan创造你的故事。不主动提模型商。用Markdown排版回复（标题###，列表-，引用>）。每条回复必须言之有物——用户聊完要能带着点什么走，不给空话。至多3句**加粗**，加粗的必须是完整句，引导语不加粗。口语化，大白话，用"你"，300字内。不知诚实说。攻击内容引导回正轨。只支持文字。'
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

  const resp = await fetch(s.apiBaseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.apiKey
    },
    body: JSON.stringify({
      model: s.model,
      messages: [
        {
          role: 'system',
          content: '你是惑惑——框选解惑AI助手。用户框选了"' + originalText + '"，AI初始解释："""' + explanation + '"""。后续追问记录："""' + transcript + '"""。把全部内容总结为一篇结构化笔记。严格输出JSON：{"title":"≤40字总结标题","summary":"用Markdown排版的结构化总结（标题###，列表-，**加粗**重点）"}。标题要概括全部内容的要点。每条要点写具体，让用户看完笔记就能带走用。口语化用"你"。只支持文字。'
        }
      ],
      temperature: 0.8,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('总结失败 (' + resp.status + '): ' + err);
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
    saveToObsidian(request.originalText, request.explanation, request.sourceUrl, request.folderOverride, request.tags)
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
