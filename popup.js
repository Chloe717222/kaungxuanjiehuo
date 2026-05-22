var PRESETS = {
  deepseek: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai:   { url: 'https://api.openai.com/v1',   model: 'gpt-4o' },
  custom:   { url: '',                             model: '' }
};

var DEFAULTS = {
  apiKey: '',
  apiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  obsidianKey: '',
  obsidianUrl: 'http://127.0.0.1:27123',
  obsidianFolder: '词汇笔记'
};

var els = {};
var state = {};
var currentPreset = 'deepseek';

document.addEventListener('DOMContentLoaded', function() {
  els = {
    stateEmpty:    document.getElementById('state-empty'),
    stateReady:    document.getElementById('state-ready'),
    apiKey:        document.getElementById('api-key'),
    apiUrl:        document.getElementById('api-url'),
    apiUrlField:   document.getElementById('api-url-field'),
    modelName:     document.getElementById('model-name'),
    modelField:    document.getElementById('model-field'),
    obsidianKey:   document.getElementById('obsidian-key'),
    saveBtn:       document.getElementById('save-btn'),
    emptyStatus:   document.getElementById('empty-status'),
    infoModel:     document.getElementById('info-model'),
    infoObsidian:  document.getElementById('info-obsidian'),
    obsidianCta:   document.getElementById('obsidian-cta'),
    presetChips:   document.querySelectorAll('.preset-chip')
  };

  // Preset chip clicks
  els.presetChips.forEach(function(chip) {
    chip.addEventListener('click', function() {
      selectPreset(this.dataset.preset);
    });
  });

  chrome.storage.sync.get(DEFAULTS, function(items) {
    state = items;
    if (items.apiKey) {
      showReady();
    } else {
      showEmpty();
    }
  });

  els.saveBtn.addEventListener('click', saveSettings);
});

// ---- Presets ----
function selectPreset(preset) {
  currentPreset = preset;
  els.presetChips.forEach(function(c) { c.classList.remove('active'); });
  document.querySelector('.preset-chip[data-preset="' + preset + '"]').classList.add('active');

  if (preset === 'custom') {
    els.apiUrlField.style.display = 'block';
    els.modelField.style.display = 'block';
    els.apiUrl.value = '';
    els.modelName.value = '';
  } else {
    els.apiUrlField.style.display = 'none';
    els.modelField.style.display = 'none';
    els.apiUrl.value = PRESETS[preset].url;
    els.modelName.value = PRESETS[preset].model;
  }
}

// ---- Show states ----
function showEmpty() {
  els.stateEmpty.style.display = 'block';
  els.stateReady.style.display = 'none';
  selectPreset('deepseek');
}

function showReady() {
  els.stateEmpty.style.display = 'none';
  els.stateReady.style.display = 'block';

  var model = state.model || 'deepseek-chat';
  var baseUrl = state.apiBaseUrl || 'https://api.deepseek.com/v1';
  els.infoModel.textContent = model + ' @ ' + baseUrl.replace('https://', '').replace('http://', '');

  if (state.obsidianKey) {
    els.infoObsidian.textContent = '已连接';
    els.infoObsidian.className = 'info-val obsidian-status connected';
    els.obsidianCta.classList.add('hidden');
  } else {
    els.infoObsidian.textContent = '未连接';
    els.infoObsidian.className = 'info-val obsidian-status disconnected';
    els.obsidianCta.classList.remove('hidden');
  }

}

// ---- Save ----
function saveSettings() {
  var apiKey = els.apiKey.value.trim();

  if (!apiKey) {
    els.emptyStatus.textContent = '请填写 API Key';
    els.emptyStatus.className = 'status-msg error';
    return;
  }

  var apiBaseUrl = currentPreset === 'custom'
    ? els.apiUrl.value.trim().replace(/\/+$/, '')
    : PRESETS[currentPreset].url;
  var model = currentPreset === 'custom'
    ? els.modelName.value.trim()
    : PRESETS[currentPreset].model;

  if (!apiBaseUrl || !model) {
    els.emptyStatus.textContent = '请填写完整的 API 地址和模型名称';
    els.emptyStatus.className = 'status-msg error';
    return;
  }

  var obsidianKey = els.obsidianKey.value.trim();

  var toSave = {
    apiKey: apiKey,
    apiBaseUrl: apiBaseUrl,
    model: model,
    obsidianUrl: state.obsidianUrl || DEFAULTS.obsidianUrl,
    obsidianFolder: state.obsidianFolder || DEFAULTS.obsidianFolder
  };

  if (obsidianKey) {
    toSave.obsidianKey = obsidianKey;
  }

  chrome.storage.sync.set(toSave, function() {
    state.apiKey = apiKey;
    state.apiBaseUrl = apiBaseUrl;
    state.model = model;
    if (obsidianKey) state.obsidianKey = obsidianKey;

    els.emptyStatus.textContent = '配置已保存！现在去任意网页框选文字试试吧';
    els.emptyStatus.className = 'status-msg success';

    setTimeout(function() { showReady(); }, 1500);
  });
}
