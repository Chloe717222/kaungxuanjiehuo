var PRESETS = {
  deepseek: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai:   { url: 'https://api.openai.com/v1',   model: 'gpt-4o' },
  custom:   { url: '',                             model: '' }
};

var DEFAULTS = {
  apiKey: '',
  apiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  obsidianUrl: 'http://127.0.0.1:27124',
  obsidianKey: '',
  obsidianFolder: '词汇笔记',
  obsidianVault: ''
};

var currentPreset = 'deepseek';

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
  presetChips: document.querySelectorAll('.preset-chip')
};

// Preset chips
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

// Load saved settings
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
});

// Save
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
    obsidianVault: els.obsidianVault.value.trim()
  }, function() {
    els.status.textContent = '设置已保存';
    els.status.className = 'success';
    setTimeout(function() { els.status.textContent = ''; }, 2500);
  });
});
