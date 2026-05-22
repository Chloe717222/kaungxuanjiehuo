var PRESETS = {
  deepseek: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai:   { url: 'https://api.openai.com/v1',   model: 'gpt-4o' },
  custom:   { url: '',                             model: '' }
};

var DEFAULTS = {
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

var currentPreset = 'deepseek';

// AI 辅助对话框状态
var aiHelper = {
  targetType: 'dialogue',  // 'dialogue' | 'save'
  messages: [],
  generatedPrompt: '',
  isWaiting: false
};

var els = {
  apiKey:      document.getElementById('api-key'),
  apiUrl:      document.getElementById('api-url'),
  apiUrlField: document.getElementById('api-url-field'),
  modelName:   document.getElementById('model-name'),
  modelField:  document.getElementById('model-field'),
  obsidianUrl: document.getElementById('obsidian-url'),
  obsidianKey: document.getElementById('obsidian-key'),
  obsidianFolder: document.getElementById('obsidian-folder'),
  obsidianVault: document.getElementById('obsidian-vault'),
  form:        document.getElementById('settings-form'),
  status:      document.getElementById('status'),
  presetChips: document.querySelectorAll('.preset-chip'),

  // 对话提示词
  dialogueChips:  document.querySelectorAll('.mode-chips[data-group="dialogue"] .mode-chip'),
  dialogueField:  document.getElementById('dialogue-custom-field'),
  dialogueEditor: document.getElementById('dialogue-prompt'),

  // 保存模板
  saveChips:  document.querySelectorAll('.mode-chips[data-group="save"] .mode-chip'),
  saveField:  document.getElementById('save-custom-field'),
  saveEditor: document.getElementById('save-prompt'),

  // AI 辅助对话框
  aiHelperBtns:  document.querySelectorAll('.ai-helper-btn'),
  aiOverlay:     document.getElementById('ai-helper-overlay'),
  aiTitle:       document.getElementById('ai-helper-title'),
  aiTypeTag:     document.getElementById('ai-helper-type-tag'),
  aiGuide:       document.getElementById('ai-helper-guide'),
  aiMessages:    document.getElementById('ai-helper-messages'),
  aiInput:       document.getElementById('ai-helper-input'),
  aiSendBtn:     document.getElementById('ai-helper-send'),
  aiFillBtn:     document.getElementById('ai-helper-fill'),
  aiCloseBtn:    document.querySelector('.ai-helper-close'),

};


// =============================================================
//  Preset chips
// =============================================================
els.presetChips.forEach(function(chip) {
  chip.addEventListener('click', function() {
    selectPreset(this.dataset.preset);
  });
});

function selectPreset(preset) {
  currentPreset = preset;
  els.presetChips.forEach(function(c) { c.classList.remove('active'); });
  document.querySelector('.preset-chip[data-preset="' + preset + '"]').classList.add('active');

  if (preset === 'custom') {
    els.apiUrlField.style.display = 'block';
    els.modelField.style.display = 'block';
  } else {
    els.apiUrlField.style.display = 'none';
    els.modelField.style.display = 'none';
    els.apiUrl.value = PRESETS[preset].url;
    els.modelName.value = PRESETS[preset].model;
  }
}

// =============================================================
//  对话提示词 模式切换
// =============================================================
els.dialogueChips.forEach(function(chip) {
  chip.addEventListener('click', function() {
    selectDialogueMode(this.dataset.mode);
  });
});

function selectDialogueMode(mode) {
  els.dialogueChips.forEach(function(c) { c.classList.remove('active'); });
  document.querySelector('.mode-chips[data-group="dialogue"] .mode-chip[data-mode="' + mode + '"]').classList.add('active');
  els.dialogueField.style.display = mode === 'custom' ? 'block' : 'none';
}

// =============================================================
//  保存模板 模式切换
// =============================================================
els.saveChips.forEach(function(chip) {
  chip.addEventListener('click', function() {
    selectSaveMode(this.dataset.mode);
  });
});

function selectSaveMode(mode) {
  els.saveChips.forEach(function(c) { c.classList.remove('active'); });
  document.querySelector('.mode-chips[data-group="save"] .mode-chip[data-mode="' + mode + '"]').classList.add('active');
  els.saveField.style.display = mode === 'custom' ? 'block' : 'none';
}

// =============================================================
//  AI 辅助对话框
// =============================================================
els.aiHelperBtns.forEach(function(btn) {
  btn.addEventListener('click', function() {
    openAIHelper(this.dataset.target);
  });
});

els.aiCloseBtn.addEventListener('click', closeAIHelper);
els.aiSendBtn.addEventListener('click', aiHelperSend);
els.aiInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiHelperSend(); }
});
els.aiFillBtn.addEventListener('click', aiHelperFill);

// 点击遮罩关闭
els.aiOverlay.addEventListener('click', function(e) {
  if (e.target === els.aiOverlay) closeAIHelper();
});

function openAIHelper(type) {
  chrome.storage.sync.get(['apiKey'], function(items) {
    if (!items.apiKey) {
      alert('请先在「AI 服务配置」中填写 API Key 并保存，才能使用 AI 辅助生成功能。');
      return;
    }
    proceedOpen(type);
  });
}

function proceedOpen(type) {
  aiHelper.targetType = type;
  aiHelper.messages = [];
  aiHelper.generatedPrompt = '';
  aiHelper.isWaiting = false;

  // 重置对话框状态
  els.aiMessages.innerHTML = '';
  els.aiInput.value = '';
  els.aiFillBtn.disabled = true;
  els.aiSendBtn.disabled = false;
  els.aiInput.disabled = false;

  // 设置标题和标签
  if (type === 'dialogue') {
    els.aiTitle.textContent = '🤖 生成对话提示词';
    els.aiTypeTag.textContent = '对话提示词';
    els.aiGuide.textContent = '描述你想要的 AI 回答风格，例如：\n• "通俗一点，像朋友聊天"\n• "正式专业，带引用和推理过程"\n• "简洁直接，三句话以内说清楚"\n• "幽默风趣，多举生活例子"\n\n也可以贴一段你喜欢的对话风格参考。';
  } else {
    els.aiTitle.textContent = '🤖 生成保存模板';
    els.aiTypeTag.textContent = '保存模板';
    els.aiGuide.textContent = '描述你想要的笔记保存格式，例如：\n• "标题用核心陈述句，正文分段落"\n• "直接给我一个默认的就行"\n• "你可以从你的 Obsidian 笔记复制链接过来，我参考它的格式"\n\n📌 获取笔记链接：在 Obsidian 中打开一篇笔记 → 右上角 ··· → 复制笔记链接，粘贴到这里。\n\n说明：标题默认规则是「一句核心陈述句，必须含搜索原词」。';
  }

  els.aiOverlay.style.display = 'flex';
  setTimeout(function() { els.aiInput.focus(); }, 100);
}

function closeAIHelper() {
  els.aiOverlay.style.display = 'none';
}

function aiHelperSend() {
  var text = els.aiInput.value.trim();
  if (!text || aiHelper.isWaiting) return;

  // 添加用户消息
  addAIMsg('user', text);
  els.aiInput.value = '';
  aiHelper.isWaiting = true;
  els.aiSendBtn.disabled = true;
  els.aiInput.disabled = true;

  chrome.runtime.sendMessage({
    action: 'generatePrompt',
    userInput: text,
    promptType: aiHelper.targetType
  }, function(resp) {
    aiHelper.isWaiting = false;
    els.aiSendBtn.disabled = false;
    els.aiInput.disabled = false;
    els.aiInput.focus();

    if (resp && resp.success) {
      aiHelper.generatedPrompt = resp.data;
      addAIMsg('assistant', resp.data);
      els.aiFillBtn.disabled = false;
    } else {
      addAIMsg('assistant', '生成失败，请重试。\n' + (resp ? resp.error : '无响应'));
    }
  });
}

function addAIMsg(role, content) {
  var div = document.createElement('div');
  div.className = 'ai-helper-msg ' + role;
  div.textContent = content;
  els.aiMessages.appendChild(div);
  els.aiMessages.scrollTop = els.aiMessages.scrollHeight;
  aiHelper.messages.push({ role: role, content: content });
}

function aiHelperFill() {
  if (!aiHelper.generatedPrompt) return;

  if (aiHelper.targetType === 'dialogue') {
    els.dialogueEditor.value = aiHelper.generatedPrompt;
    // 自动切换到自定义模式
    selectDialogueMode('custom');
  } else {
    els.saveEditor.value = aiHelper.generatedPrompt;
    selectSaveMode('custom');
  }
  closeAIHelper();
}

// =============================================================
//  Load saved settings
// =============================================================
chrome.storage.sync.get(DEFAULTS, function(items) {
  // Determine which preset based on saved URL
  var savedUrl = items.apiBaseUrl || DEFAULTS.apiBaseUrl;
  var found = false;
  for (var key in PRESETS) {
    if (key !== 'custom' && PRESETS[key].url === savedUrl) {
      selectPreset(key);
      found = true;
      break;
    }
  }
  if (!found) {
    selectPreset('custom');
    els.apiUrl.value = savedUrl;
    els.modelName.value = items.model || '';
  }

  els.apiKey.value = items.apiKey || '';
  els.obsidianUrl.value = items.obsidianUrl || DEFAULTS.obsidianUrl;
  els.obsidianKey.value = items.obsidianKey || '';
  els.obsidianFolder.value = items.obsidianFolder || DEFAULTS.obsidianFolder;
  els.obsidianVault.value = items.obsidianVault || DEFAULTS.obsidianVault;

  // 对话提示词
  selectDialogueMode(items.promptMode || 'default');
  els.dialogueEditor.value = items.customPrompt || '';

  // 保存模板
  selectSaveMode(items.savePromptMode || 'default');
  els.saveEditor.value = items.customSavePrompt || '';
});

// =============================================================
//  Save
// =============================================================
els.form.addEventListener('submit', function(e) {
  e.preventDefault();

  var apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    els.status.textContent = '请填写 API Key';
    els.status.className = 'error';
    return;
  }

  var apiBaseUrl = currentPreset === 'custom'
    ? els.apiUrl.value.trim().replace(/\/+$/, '')
    : PRESETS[currentPreset].url;
  var model = currentPreset === 'custom'
    ? els.modelName.value.trim()
    : PRESETS[currentPreset].model;

  if (!apiBaseUrl || !model) {
    els.status.textContent = '请填写完整的 API 地址和模型名称';
    els.status.className = 'error';
    return;
  }

  chrome.storage.sync.set({
    apiKey: apiKey,
    apiBaseUrl: apiBaseUrl,
    model: model,
    obsidianUrl: els.obsidianUrl.value.trim().replace(/\/+$/, '') || DEFAULTS.obsidianUrl,
    obsidianKey: els.obsidianKey.value.trim(),
    obsidianFolder: els.obsidianFolder.value.trim(),
    obsidianVault: els.obsidianVault.value.trim(),

    promptMode: document.querySelector('.mode-chips[data-group="dialogue"] .mode-chip.active').dataset.mode,
    customPrompt: els.dialogueEditor.value.trim(),
    savePromptMode: document.querySelector('.mode-chips[data-group="save"] .mode-chip.active').dataset.mode,
    customSavePrompt: els.saveEditor.value.trim()
  }, function() {
    els.status.textContent = '设置已保存';
    els.status.className = 'success';
    setTimeout(function() { els.status.textContent = ''; }, 2500);
  });
});
