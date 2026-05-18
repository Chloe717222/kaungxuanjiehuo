var chatHistory = [];
var isSpeaking = false;

var els = {
  messages: document.getElementById('messages'),
  input: document.getElementById('input'),
  sendBtn: document.getElementById('sendBtn'),
  speakInputBtn: document.getElementById('speakInputBtn'),
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
els.speakInputBtn.addEventListener('click', function() {
  var text = els.input.value.trim();
  if (!text) return;
  var btn = els.speakInputBtn;
  if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking = false; btn.classList.remove('speaking'); return; }
  var u = new SpeechSynthesisUtterance(text);
  u.lang = detectLang(text); u.rate = 0.9;
  u.onstart = function(){ isSpeaking = true; btn.classList.add('speaking'); };
  u.onend = u.onerror = function(){ isSpeaking = false; btn.classList.remove('speaking'); };
  window.speechSynthesis.speak(u);
});
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
  div.innerHTML = renderChatMD(content);
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

function renderChatMD(md) {
  var d = document.createElement('div');
  d.textContent = md;
  var lines = d.innerHTML.split('\n');
  var out = [];
  var inUl = false, inOl = false;

  function closeLists() {
    if (inOl) { out.push('</ol>'); inOl = false; }
    if (inUl) { out.push('</ul>'); inUl = false; }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    var h = line.match(/^### (.+)/);
    if (h) { closeLists(); out.push('<h3>' + h[1] + '</h3>'); continue; }

    var bq = line.match(/^&gt; (.+)/);
    if (bq) { closeLists(); out.push('<blockquote>' + bq[1] + '</blockquote>'); continue; }

    var ul = line.match(/^[\-\*] (.+)/);
    if (ul) {
      if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
      out.push('<li>' + ul[1] + '</li>');
      continue;
    }

    var ol = line.match(/^\d+\. (.+)/);
    if (ol) {
      if (!inOl) { closeLists(); out.push('<ol>'); inOl = true; }
      out.push('<li>' + ol[1] + '</li>');
      continue;
    }

    closeLists();
    if (line === '') {
      out.push('<br>');
    } else {
      out.push('<p>' + line + '</p>');
    }
  }
  closeLists();
  return out.join('');
}

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

function detectLang(text) {
  if (/[一-鿿]/.test(text)) return 'zh-CN';
  if (/[가-힯]/.test(text)) return 'ko-KR';
  if (/[฀-๿]/.test(text)) return 'th-TH';
  if (/[぀-ヿ]/.test(text)) return 'ja-JP';
  return 'en-US';
}

// Focus
setTimeout(function() { els.input.focus(); }, 200);
