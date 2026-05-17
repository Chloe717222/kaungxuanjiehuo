var chatHistory = [];

var els = {
  messages: document.getElementById('messages'),
  input: document.getElementById('input'),
  sendBtn: document.getElementById('sendBtn'),
  folderInput: document.getElementById('folderInput'),
  saveObsidian: document.getElementById('saveObsidian'),
  saveDownload: document.getElementById('saveDownload'),
  saveClipboard: document.getElementById('saveClipboard')
};

// Init: check Obsidian config and load default folder
chrome.storage.sync.get(['obsidianKey', 'obsidianFolder'], function(settings) {
  if (!settings.obsidianKey || !settings.obsidianKey.trim()) {
    els.saveObsidian.style.display = 'none';
  }
  if (settings.obsidianFolder) {
    els.folderInput.value = settings.obsidianFolder;
    els.folderInput.placeholder = settings.obsidianFolder;
  }
});

// Send message
function send() {
  var question = els.input.value.trim();
  if (!question) return;

  // Hide welcome
  var welcome = els.messages.querySelector('.welcome');
  if (welcome) welcome.remove();

  els.input.disabled = true; els.sendBtn.disabled = true;

  addMsg('user', question);
  els.input.value = '';
  els.input.style.height = 'auto';

  var typingEl = addMsg('assistant', '...', true);

  chrome.runtime.sendMessage({
    action: 'generalChat',
    history: chatHistory
  }, function(resp) {
    if (typingEl && typingEl.parentNode) typingEl.remove();
    els.input.disabled = false; els.sendBtn.disabled = false;
    els.input.focus();

    if (resp && resp.success) {
            addMsg('assistant', resp.data);
    } else {
      addMsg('assistant', '抱歉，出了点问题：' + (resp ? resp.error : '无响应'));
    }
  });
}

els.sendBtn.addEventListener('click', send);
els.input.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
els.input.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

function addMsg(role, content, isTyping) {
  var div = document.createElement('div');
  div.className = 'msg ' + role;
  if (isTyping) div.classList.add('typing');
  div.textContent = content;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  if (!isTyping) chatHistory.push({ role: role, content: content });
  return div;
}

// ============ Save ============
function buildChatContent() {
  var lines = ['# 框选解惑 · AI 对话记录', '', '> ' + new Date().toISOString().split('T')[0], ''];
  for (var i = 0; i < chatHistory.length; i++) {
    var m = chatHistory[i];
    lines.push(m.role === 'user' ? '**🙋 我**：' + m.content : '**🤖 惑惑**：' + m.content);
    lines.push('');
  }
  return lines.join('\n');
}

function doSaveChat(way, btn) {
  var saveContent = buildChatContent();
  var safeName = '对话记录_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  var origText = btn.textContent;
  btn.textContent = '...'; btn.disabled = true;

  if (way === 'obsidian') {
    var folderOverride = els.folderInput.value.trim();
    chrome.runtime.sendMessage({
      action: 'saveToObsidian',
      originalText: safeName,
      explanation: saveContent,
      sourceUrl: '',
      folderOverride: folderOverride
    }, function(resp) {
      btn.disabled = false;
      if (resp && resp.success && resp.data) {
        btn.textContent = '✓ 已同步'; btn.classList.add('saved');
        showToast('已保存到知识库');
        setTimeout(function() { btn.textContent = origText; btn.classList.remove('saved'); }, 2000);
      } else {
        btn.textContent = origText;
        showToast('保存失败：' + (resp ? resp.error : '无响应'));
      }
    });
    return;
  }

  if (way === 'download') {
    try {
      var blob = new Blob([saveContent], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = safeName + '.md';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      btn.textContent = '✓ 已下载'; btn.classList.add('saved');
      showToast('已下载 Markdown 文件');
      setTimeout(function() { btn.textContent = origText; btn.classList.remove('saved'); }, 2000);
    } catch (e) {
      btn.textContent = origText;
      showToast('下载失败');
    }
    btn.disabled = false;
    return;
  }

  if (way === 'clipboard') {
    navigator.clipboard.writeText(saveContent).then(function() {
      btn.textContent = '✓ 已复制'; btn.classList.add('saved');
      showToast('已复制到剪贴板');
      setTimeout(function() { btn.textContent = origText; btn.classList.remove('saved'); }, 2000);
    }).catch(function() {
      btn.textContent = origText;
      showToast('复制失败');
    });
    btn.disabled = false;
    return;
  }
}

els.saveObsidian.addEventListener('click', function() { doSaveChat('obsidian', els.saveObsidian); });
els.saveDownload.addEventListener('click', function() { doSaveChat('download', els.saveDownload); });
els.saveClipboard.addEventListener('click', function() { doSaveChat('clipboard', els.saveClipboard); });

function showToast(msg) {
  var t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() {
    t.style.opacity = '0'; t.style.transition = 'opacity 0.3s';
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
  }, 2800);
}

// Focus
setTimeout(function() { els.input.focus(); }, 200);
