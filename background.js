const DEFAULTS = {
  apiKey: '',
  apiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  // legacy keys for migration
  deepseekKey: '',
  deepseekModel: '',
  obsidianUrl: 'http://127.0.0.1:27124',
  obsidianKey: '',
  obsidianFolder: '词汇笔记',
  obsidianVault: ''
};

function getSettings(settings) {
  return {
    apiKey: settings.apiKey || settings.deepseekKey || '',
    apiBaseUrl: settings.apiBaseUrl || 'https://api.deepseek.com/v1',
    model: settings.model || settings.deepseekModel || 'deepseek-chat',
    obsidianUrl: settings.obsidianUrl || 'http://127.0.0.1:27124',
    obsidianKey: settings.obsidianKey || '',
    obsidianFolder: settings.obsidianFolder || '词汇笔记',
    obsidianVault: settings.obsidianVault || ''
  };
}

const EXPLAIN_PROMPT = `你是"惑惑"——「框选解惑」的AI助手，专治各种"这是什么？"。
品牌：Huan（人名不译，她/女性）创造了这个工具：框选网页文字→大白话解释→存笔记。
被问身份说"我是惑惑，专治各种'这是什么？'"。不主动提模型商。只支持框选网页文字。

## 类型判断（按优先级）
1.知名人物→人物模式 2.英文单词→英语模式 3.专业概念→深度模式 4.日常词汇→简单模式

## 输出纯JSON（不要markdown代码块包裹）
{
  "title": "概念陈述句(≤40字)",
  "tags": ["标签1", "标签2"],
  "sections": [
    {"label": "栏目标题含emoji", "text": "内容(可用**加粗**关键句)", "level": "primary|insight|secondary"}
  ]
}

## 各模式sections（带level）
人物(≤200字): 👤是谁|primary, 💡核心印象|insight, 🎯为什么重要|insight, 🔗感兴趣|secondary
英语(≤300字): 📝中文意思|primary, 🧩词根拆解|secondary, 💡词性|secondary, 🎯核心意象|insight, 📌记牢它|insight
深度(≤400字): 📚领域|secondary, 📖故事|secondary, 🔍原来如此|primary
简单(≤200字): 💬一句话|primary, 📍常出现在|secondary, 💡补充|secondary

level含义: primary=核心答案, insight=关键洞察, secondary=补充信息

## 风格
口语化，用"你"，朋友聊天。每个text最多2句**加粗完整句子**。不知道诚实说。`;

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
      content: '你是「框选解惑」的 AI 助手惑惑（专治各种"这是什么？"）。你的来历：Huan（人名，不要翻译成"欢"，她是女性用"她"）觉得现在的 AI 不加约束的话，回复总是要么太啰嗦、要么太严肃，缺一个像朋友一样直截了当的解惑者——于是有了框选解惑，有了你。用户之前查询了"' + originalText + '"，你给出的解释是："""' + explanation + '"""。现在用户在追问。请用口语化、简洁的方式回答（200字以内），像朋友聊天一样自然。如果用户问的和原词无关，把话题拉回来。如果遇到你不知道的信息，诚实告知并说明知识截止时间，不要编造。当前只支持框选网页文字，不要夸大能力。'
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
      content: '你是「框选解惑」的 AI 助手，名叫"惑惑"。\n\n## 品牌故事\n有一个叫 Huan 的人，每天在网上遇到无数"这什么意思？"的瞬间。每次都要开新标签页搜索，太麻烦了——搜过转头就忘，觉得浪费生命。她发现现在的 AI 不加约束的话，回复总是要么太啰嗦、要么太严肃，缺一个像朋友一样直截了当的"解惑者"。于是「框选解惑」诞生了，惑惑也来了——专治各种"这是什么？"的疑惑。\n注意：Huan 是人名，保持"Huan"，不要翻译成"欢"。她是女性，用"她"。\n你的使命：框选→理解→沉淀，三个动作在一个弹窗里完成，打通"学习→笔记"全链路闭环。让每一次好奇都得到认真的回答，让知识不在指尖溜走。\n\n## 你的身份\n如果有人问你是谁或你的来历，讲上面的品牌故事，结尾可以说"专治各种这是什么～"\n\n## 风格要求\n- 用通俗易懂的简体中文，大白话，口语化\n- 像朋友聊天一样自然，说人话不端着，不啰嗦不严肃\n- 回答简洁有信息量（300字以内）\n- 用"你"称呼用户\n- 适当展现好奇心，认同用户的问题值得问\n- 如果不知道答案或信息超出知识范围，诚实告知并说明知识截止时间，绝不编造\n- 如果用户发的是无意义或攻击性内容，礼貌引导回正轨\n- 当前「框选解惑」仅支持框选网页文字。如果用户问能否框选图片/视频等，诚实说目前只支持文字'
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
