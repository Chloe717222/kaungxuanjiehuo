var chatHistory = [];
var isSpeaking = false;

var els = {
  messages: document.getElementById('messages'),
  messagesInner: document.querySelector('.messages-inner'),
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

  // Create streaming message container (no typing indicator)
  var msgDiv = document.createElement('div');
  msgDiv.className = 'msg assistant';
  (els.messagesInner || els.messages).appendChild(msgDiv);
  els.messages.scrollTop = els.messages.scrollHeight;

  var streamContent = '';
  var port = chrome.runtime.connect({ name: 'stream-general' });
  port.postMessage({ history: chatHistory });
  port.onMessage.addListener(function(msg) {
    if (msg.type === 'token') {
      streamContent += msg.content;
      msgDiv.innerHTML = renderChatMD(streamContent);
      els.messages.scrollTop = els.messages.scrollHeight;
    } else if (msg.type === 'done') {
      chatHistory.push({ role: 'assistant', content: streamContent });
      els.input.disabled = false; els.sendBtn.disabled = false;
      els.input.focus();
    } else if (msg.type === 'error') {
      msgDiv.innerHTML = renderChatMD('抱歉，出了点问题：' + msg.error);
      chatHistory.push({ role: 'assistant', content: '抱歉，出了点问题：' + msg.error });
      els.input.disabled = false; els.sendBtn.disabled = false;
      els.input.focus();
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
  div.innerHTML = renderChatMD(content);
  (els.messagesInner || els.messages).appendChild(div);
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

// Parse save path. Only the last segment ending with .md is treated as note name:
//   "学习笔记/词汇.md" → folder="学习笔记", noteName="词汇"
//   "学习笔记/英语/词汇.md" → folder="学习笔记/英语", noteName="词汇"
//   "学习笔记/英语/词汇" (no .md) → folder="学习笔记/英语/词汇", auto-name.
//   "学习笔记/" or "学习笔记" → folder path, auto-name.
function parseSavePath(input) {
  if (!input || !input.trim()) {
    return { folder: '', noteName: '' };
  }
  var trimmed = input.trim();
  if (trimmed.charAt(trimmed.length - 1) === '/') {
    return { folder: trimmed, noteName: '' };
  }
  if (trimmed.indexOf('/') === -1) {
    if (trimmed.toLowerCase().endsWith('.md')) {
      return { folder: '', noteName: trimmed.slice(0, -3) };
    }
    return { folder: trimmed, noteName: '' };
  }
  var parts = trimmed.split('/');
  var last = parts[parts.length - 1];
  if (last.toLowerCase().endsWith('.md')) {
    return { folder: parts.slice(0, -1).join('/'), noteName: last.slice(0, -3) };
  }
  return { folder: trimmed, noteName: '' };
}

function doSaveChat(way, btn) {
  // Extract first user message and AI responses from chat history
  var firstUserMsg = '';
  var aiResponses = [];
  for (var i = 0; i < chatHistory.length; i++) {
    var m = chatHistory[i];
    if (m.role === 'user' && !firstUserMsg) firstUserMsg = m.content;
    if (m.role === 'assistant') aiResponses.push(m.content);
  }
  var explanationText = aiResponses.join('\n\n');

  // Build fallback raw content
  var fallbackContent = buildChatContent();
  var safeName = '对话记录_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  var savePath = els.folderInput.value.trim();
  var parsed = parseSavePath(savePath);
  var effectiveFileName = parsed.noteName || safeName;

  var origText = btn.textContent;
  btn.textContent = '...'; btn.disabled = true;

  function executeSaveChat(noteTitle, noteTags, noteBody) {
    if (way === 'obsidian') {
      chrome.runtime.sendMessage({
        action: 'saveToObsidian',
        originalText: noteTitle || effectiveFileName,
        explanation: noteBody,
        sourceUrl: '',
        folderOverride: parsed.folder,
        tags: noteTags.join(', '),
        customFileName: parsed.noteName || ''
      }, function(resp) {
        btn.disabled = false;
        if (resp && resp.success && resp.data) {
          if (resp.data.method === 'rest') {
            btn.textContent = '✓ 已同步'; btn.classList.add('saved');
            showToast('已保存到知识库');
            setTimeout(function() { btn.textContent = origText; btn.classList.remove('saved'); }, 2000);
          } else if (resp.data.method === 'uri') {
            // Obsidian 未运行，尝试通过 URI 打开
            (function(uri) {
              try {
                var a = document.createElement('a');
                a.href = uri; a.style.display = 'none'; a.target = '_blank';
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
              } catch (e) {}
              try {
                var w = window.open(uri, '_blank');
                if (w) w.close();
              } catch (e) {}
            })(resp.data.uri);
            btn.textContent = '...'; showToast('正在连接 Obsidian...');
            (function poll(attempts) {
              setTimeout(function() {
                chrome.runtime.sendMessage({
                  action: 'saveToObsidian',
                  originalText: noteTitle || effectiveFileName,
                  explanation: noteBody,
                  sourceUrl: '',
                  folderOverride: parsed.folder,
                  tags: noteTags.join(', '),
                  customFileName: parsed.noteName || ''
                }, function(retryResp) {
                  btn.disabled = false;
                  if (retryResp && retryResp.success && retryResp.data && retryResp.data.method === 'rest') {
                    btn.textContent = '✓ 已同步'; btn.classList.add('saved');
                    showToast('已保存到知识库');
                    setTimeout(function() { btn.textContent = origText; btn.classList.remove('saved'); }, 2000);
                  } else if (attempts < 20) {
                    poll(attempts + 1);
                  } else {
                    btn.textContent = origText;
                    showToast('保存失败：无法连接 Obsidian，请确认 Obsidian 已打开');
                  }
                });
              }, 1000);
            })(0);
          }
        } else {
          btn.textContent = origText;
          showToast('保存失败：' + (resp ? resp.error : '无响应'));
        }
      });
      return;
    }

    var tagsLine = '';
    if (noteTags.length > 0) {
      tagsLine = '\n\n> 标签：' + noteTags.join('、');
    }
    var fullContent = '# ' + noteTitle + '\n\n' + noteBody + tagsLine;

    if (way === 'download') {
      try {
        var safeName = noteTitle.replace(/[\\/:*?"<>|#\n\r]/g, '').trim().slice(0, 40) || '未命名';
        var blob = new Blob([fullContent], { type: 'text/markdown;charset=utf-8' });
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
      navigator.clipboard.writeText(fullContent).then(function() {
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

  // Call AI note planning
  chrome.runtime.sendMessage({
    action: 'planNote',
    originalText: firstUserMsg || '对话',
    explanation: explanationText || fallbackContent,
    history: chatHistory
  }, function(resp) {
    if (resp && resp.success) {
      try {
        var parsed = JSON.parse(resp.data);
        if (parsed.title) {
          executeSaveChat(parsed.title, parsed.tags || [], parsed.body || fallbackContent);
          return;
        }
      } catch (e) {}
    }
    // Fallback: save raw chat content
    executeSaveChat(effectiveFileName, [], fallbackContent);
  });
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
