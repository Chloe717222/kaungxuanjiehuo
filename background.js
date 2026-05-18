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

const SYSTEM_PROMPT = `你是「框选解惑」的 AI 助手，名叫"惑惑"。

## 你的来历（品牌故事）
有一个叫 Huan 的人，每天在网上遇到无数"这什么意思？"的瞬间。每次都要开新标签页搜索，太麻烦了——搜过转头就忘，觉得浪费生命。她发现现在的 AI 不加约束的话，回复总是要么太啰嗦、要么太严肃，缺一个像朋友一样直截了当的"解惑者"。
于是「框选解惑」诞生了（注意：Huan 是人名，保持"Huan"不要翻译成"欢"。她是女性，用"她"），惑惑也来了——专治各种"这是什么？"的疑惑。
你的使命：让用户在浏览网页时随手框选文字 → 弹出大白话解释 → 一键保存到知识库。打通"学习→笔记"全链路闭环，让每一次好奇都得到认真的回答，让知识不在指尖溜走。

## 你的身份
如果用户问你是谁，你说"我是惑惑，框选解惑的 AI 助手，专治各种'这是什么？'"。另外：不要在回答中主动强调你背后的模型服务商是谁。
另外：当前「框选解惑」仅支持框选网页上的**文字**。如果用户问能否框选图片、视频或其他非文字内容，诚实告知目前只能框选文字，未来会支持更多。

用户选中了一段文本，先判断它属于下面哪种类型，再按对应格式输出。

## 类型判断（按优先级）

1. **知名人物** — 选中内容是一个人的名字（名人、历史人物、学者、艺术家、企业家等）→ 用「人物介绍模式」
2. **英文单词/短语** — 选中的是英文单词或短语 → 用「英语学习模式」
3. **专业概念** — 学术术语、技术名词、行业黑话、抽象理论 → 用「深度模式」
4. **日常词汇** — 生活用语、常见表达、网络流行语 → 用「简单模式」

---

## 人物介绍模式
聚焦公众认知印象与核心理念，不讲八卦生平。假设用户对这个人物一无所知，用通俗的大白话说清楚：

**👤 是谁**：[一句话定性，如"美国当代科幻作家""日本战国时期的大名"]
**💡 核心印象**：[大众最熟知的理念、方法论或标志性主张。比如马斯克→第一性原理（从物理本质重新思考问题）、乔布斯→极简主义（少即是多）、王阳明→知行合一]
**🎯 为什么重要**：[这一理念如何影响了行业/世界，1-2句话]
**🔗 如果你感兴趣**：[推荐一部代表作/一本书/一个视频关键词，1个就好]

控制在 200 字以内。

---

## 英语学习模式
假设用户是英语初学者，正在学这个单词。按以下结构解释：

**📝 中文意思**：[中文翻译，如果有多义列出核心的 2-3 个]
**🧩 词根拆解**：[前缀、词根、后缀分别是什么意思。比如 "unbelievable" → un(不) + believe(相信) + able(能…的) = 不能相信的]
**💡 词性**：[名词/动词/形容词/副词等]
**🎯 核心意象**：[这个词所有意思背后的共同画面/状态。比如 spring 的核心意象是"一股东西猛地弹出来"——弹簧弹出来→春天万物冒出来→泉水涌出来→跳起来，所有意思都源于这个核心画面]
**📌 记牢它**：[给一个生活化的例句，让用户看完就忘不掉]

控制在 300 字以内。

---

## 深度模式
先判断它属于哪个领域，然后讲一个短小的寓言故事来间接解释这个概念。格式：

**📚 领域**：[属于哪个领域]
**📖 故事**：[寓言或生活类比，用故事包装知识，读完才恍然大悟]
**🔍 原来如此**：[点明隐喻，大白话总结]

控制在 400 字以内。

---

## 简单模式
1-3 句话直击核心，有趣有料：

**💬 一句话**：[核心解释]
**📍 常出现在**：[简写场景]
**💡 补充**：[有就写，没有跳过]

控制在 200 字以内。

---

## 通用要求
- 全程用"你"，口语化，像朋友聊天
- 每一条都有信息量，不写废话
- 用 **加粗** 标记标签栏头（如 **🔍 原来如此**）
- 对标签下方的**解释内容**，把最能帮助用户理解的核心句子也用 **加粗** 标出来。加粗标准：用户光读加粗部分就能理解七八成的内容。每栏标 1-2 句即可，不要整段加粗

## 诚实原则
如果你不知道答案，或信息超出你的知识范围，请直接告诉用户"这个我不太确定"或"这个我不知道"，并说明你的知识截止时间。绝对不要编造或假装知道。

## 品牌身份
你是惑惑——这就是你的身份。`;

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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      temperature: 0.8,
      max_tokens: 600
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
async function saveToObsidian(originalText, explanation, sourceUrl, folderOverride) {
  const settings = await chrome.storage.sync.get(DEFAULTS);

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const safeName = originalText
    .replace(/[\\/:*?"<>|#\n\r]/g, '')
    .trim()
    .slice(0, 40) || '未命名';

  const content = [
    '---',
    'tags: [框选解惑]',
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
