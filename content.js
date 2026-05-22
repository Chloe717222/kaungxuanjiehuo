(function() {
  'use strict';

  var selectedText = '';
  var toolbarEl = null;
  var popupEl = null;
  var popupShadow = null;
  var isSpeaking = false;
  var initialExplanation = '';
  var explainData = null;
  var titleExplain = '';
  var noteTags = '';
  var chatHistory = [];
  var saveMode = 'explanation';
  var _extraPopups = [];

  // 缓存 storage 设置，避免频繁异步读取
  var _settingsCache = null;
  var _settingsCacheTime = 0;

  function getObsidianSettings(callback) {
    var now = Date.now();
    if (_settingsCache && (now - _settingsCacheTime) < 60000) {
      callback(_settingsCache);
      return;
    }
    chrome.storage.sync.get(['obsidianKey', 'obsidianFolder'], function(s) {
      _settingsCache = s;
      _settingsCacheTime = Date.now();
      callback(s);
    });
  }

  // ============================================================
  //  浮动按钮
  // ============================================================
  function createToolbar(x, y) {
    removeToolbar();
    toolbarEl = document.createElement('div');
    toolbarEl.id = 'we-toolbar';
    Object.assign(toolbarEl.style, {
      position:'fixed', left:x+'px', top:y+'px',
      zIndex:'2147483647', userSelect:'none'
    });
    var btn = document.createElement('button');
    var icon = document.createElement('img');
    try { icon.src = chrome.runtime.getURL('icons/icon16.png'); } catch(e) { icon.style.display = 'none'; }
    icon.style.cssText = 'width:18px;height:18px;vertical-align:middle;margin-right:6px;flex-shrink:0;';
    btn.appendChild(icon);
    var label = document.createElement('span');
    label.textContent = '框选解惑';
    btn.appendChild(label);
    btn.addEventListener('mousedown', function(e) { e.stopPropagation(); e.preventDefault(); showPopup(); });
    toolbarEl.appendChild(btn);
    document.body.appendChild(toolbarEl);

    if (!document.getElementById('we-toolbar-style')) {
      var s = document.createElement('style');
      s.id = 'we-toolbar-style';
      s.textContent = '' +
        '#we-toolbar button{display:flex;align-items:center;padding:7px 18px;border:none;border-radius:20px;' +
          'background:rgba(255,255,255,0.92);color:#1d1d1f;' +
          'font-size:14px;font-weight:500;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC",sans-serif;' +
          'cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.1),0 0 0 0.5px rgba(0,0,0,0.06);' +
          'backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);' +
          'transition:all 0.2s;}' +
        '#we-toolbar button:hover{background:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.14),0 0 0 0.5px rgba(0,0,0,0.08);transform:translateY(-1px);}' +
        '#we-toolbar button:active{transform:scale(0.96);}';
      document.head.appendChild(s);
    }
  }

  function removeToolbar() {
    if (isSpeaking) { cancelSpeaking(); }
    if (toolbarEl) { toolbarEl.remove(); toolbarEl = null; }
  }

  // ============================================================
  //  弹窗
  // ============================================================
  function createPopup(hasObsidian) {
    removePopup();
    // reset state
    initialExplanation = ''; explainData = null; chatHistory = []; saveMode = 'explanation';

    popupEl = document.createElement('div');
    popupEl.id = 'we-popup-host';
    popupEl._hasObsidian = hasObsidian;
    Object.assign(popupEl.style, {
      position:'fixed',
      left: Math.max(8, Math.round((window.innerWidth - 440) / 2)) + 'px',
      top: Math.max(8, Math.round((window.innerHeight - 550) / 2)) + 'px',
      zIndex:'2147483646',
      width:'440px', height:'550px',
      minWidth:'340px', minHeight:'400px',
      overflow:'hidden'
    });

    popupShadow = popupEl.attachShadow({ mode:'open' });

    var style = document.createElement('style');
    style.textContent = getStyles();
    popupShadow.appendChild(style);

    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = getHTML();
    popupShadow.appendChild(card);

    document.body.appendChild(popupEl);

    bindEvents(hasObsidian);
    popupEl._dragCleanup = makeDraggable(popupEl, popupShadow.querySelector('.header'));
    popupEl._resizeCleanup = makeResizable(popupEl);

    return popupShadow;
  }

  function bindEvents(hasObsidian) {
    var r = popupShadow;
    r.querySelector('.close').addEventListener('click', removePopup);
    r.querySelector('.speak-btn').addEventListener('click', speak);
    r.querySelector('.chat-send').addEventListener('click', sendChat);
    r.querySelector('.chat-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    // Prevent host page from intercepting keydown events in the save-folder-input
    r.querySelector('.save-folder-input').addEventListener('keydown', function(e) {
      e.stopPropagation();
      if (e.key === '/' && e.defaultPrevented) {
        // Host page capture handler blocked the "/" — manually insert it
        var start = this.selectionStart;
        var end = this.selectionEnd;
        this.value = this.value.substring(0, start) + '/' + this.value.substring(end);
        this.selectionStart = this.selectionEnd = start + 1;
        this.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    // Click to append "/" for easy note name entry
    r.querySelector('.save-folder-input').addEventListener('focus', function() {
      if (this.value && this.value.charAt(this.value.length - 1) !== '/') {
        this.value += '/';
        this.selectionStart = this.selectionEnd = this.value.length;
      }
    });
    // Show word-box (text + speak) for all text
    r.querySelector('.word-box').style.display = 'flex';
    r.querySelector('.word-text').textContent = selectedText;
    r.querySelector('.word-phonetic').textContent = '';
    // Footer always visible (download & clipboard don't need Obsidian)
    r.querySelector('.footer').style.display = 'flex';
    if (!hasObsidian) {
      r.querySelector('.save-way[data-way="obsidian"]').style.display = 'none';
    }
    // Save mode toggle
    r.querySelectorAll('.save-mode-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        r.querySelectorAll('.save-mode-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        saveMode = btn.dataset.mode;
      });
    });
    // Save way buttons
    r.querySelectorAll('.save-way').forEach(function(btn) {
      btn.addEventListener('click', function() {
        doSave(btn.dataset.way);
      });
    });
    // 委托：AI 回复中英文短语的朗读喇叭
    r.querySelector('.chat-messages').addEventListener('click', function(e) {
      var btn = e.target.closest('.inline-speak');
      if (!btn) return;
      e.stopPropagation();
      var word = btn.getAttribute('data-word');
      if (word) speakText(word, btn);
    });
  }

  function removePopup() {
    if (isSpeaking) { cancelSpeaking(); }
    if (outsideClickTimer) { clearTimeout(outsideClickTimer); outsideClickTimer = 0; }
    if (popupEl) {
      popupEl.style.outline = '';
      if (popupEl._dragCleanup) { popupEl._dragCleanup(); popupEl._dragCleanup = null; }
      if (popupEl._resizeCleanup) { popupEl._resizeCleanup(); popupEl._resizeCleanup = null; }
      popupEl.remove();
      popupEl = null; popupShadow = null;
    }
  }

  function getHTML() {
    return '' +
      '<div class="header">' +
        '<div class="header-left">' +
          '<span class="header-title">框选解惑</span>' +
          '<span class="header-slogan">专治各种「这是什么？」</span>' +
        '</div>' +
        '<button class="close">&times;</button>' +
      '</div>' +
      '<div class="body">' +
        // Word box — selected text + phonetic + speak icon (English only)
        '<div class="word-box" style="display:none;">' +
          '<div class="word-text-row">' +
            '<span class="word-text"></span>' +
            '<span class="word-phonetic"></span>' +
          '</div>' +
          '<button class="speak-btn" title="朗读单词发音">🔊</button>' +
        '</div>' +
        // Loading
        '<div class="loading">' +
          '<div class="spinner"></div>' +
          '<p style="color:#86868b;font-size:13px;">正在生成解释...</p>' +
        '</div>' +
        // Initial explanation
        '<div class="content" style="display:none;"></div>' +
        // Chat messages (hidden until explanation loads)
        '<div class="chat-area" style="display:none;">' +
          '<div class="chat-messages"></div>' +
        '</div>' +
        // Error
        '<div class="error-msg" style="display:none;"></div>' +
      '</div>' +
      // Chat input — outside body so gap to footer is fixed
      '<div class="chat-input-row" style="display:none;">' +
        '<input type="text" class="chat-input" placeholder="还有疑问？继续问...">' +
        '<button class="chat-send">发</button>' +
      '</div>' +
      // Footer
      '<div class="footer" style="display:none;">' +
        '<div class="save-config-row">' +
          '<input type="text" class="save-folder-input" placeholder="保存路径 (文件夹 或 文件夹/笔记名.md)">' +
          '<button class="save-mode-btn active" data-mode="explanation">仅保存框选词回复</button>' +
          '<button class="save-mode-btn" data-mode="full">保存含追问笔记</button>' +
        '</div>' +
        '<div class="footer-divider"></div>' +
        '<div class="save-actions">' +
          '<button class="save-way" data-way="obsidian" title="需要 Obsidian 运行中且已配置 API Key">📡 同步到知识库</button>' +
          '<button class="save-way" data-way="download" title="下载为 Markdown 文件到本地">📥 下载文件</button>' +
          '<button class="save-way" data-way="clipboard" title="复制 Markdown 内容，可粘贴到任何笔记软件">📋 复制内容</button>' +
        '</div>' +
      '</div>';
  }

  function getStyles() {
    return [
      '*{box-sizing:border-box;margin:0;padding:0;}',
      // Card
      '.card{background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,0.12),0 0 0 0.5px rgba(0,0,0,0.06);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC",sans-serif;font-size:15px;color:#1d1d1f;line-height:1.5;width:100%;height:100%;display:flex;flex-direction:column;}',
      // Header
      '.header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:#fff;border-bottom:1px solid #e8e8ed;cursor:move;user-select:none;flex-shrink:0;}',
      '.header-left{display:flex;align-items:baseline;gap:8px;}',
      '.header-title{font-size:15px;font-weight:600;color:#1d1d1f;letter-spacing:-0.01em;}',
      '.header-slogan{font-size:11px;color:#86868b;font-weight:400;white-space:nowrap;}',
      '.close{width:28px;height:28px;border:none;border-radius:50%;background:transparent;color:#86868b;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}',
      '.close:hover{background:#f0f0f0;color:#1d1d1f;}',
      // Body
      '.body{padding:20px;overflow-y:auto;flex:1;}',
      '.body::-webkit-scrollbar{width:4px;}',
      '.body::-webkit-scrollbar-thumb{background:#d2d2d7;border-radius:2px;}',
      // Word box
      '.word-box{display:flex;align-items:center;gap:8px;padding:10px 14px;margin-bottom:14px;background:#f5f5f7;border-radius:12px;}',
      '.word-text-row{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;flex:1;}',
      '.word-text{font-size:20px;font-weight:600;color:#1d1d1f;letter-spacing:-0.02em;word-break:break-word;line-height:1.3;}',
      '.word-phonetic{font-size:15px;color:#86868b;font-style:italic;white-space:nowrap;}',
      '.speak-btn{width:36px;height:36px;border:none;border-radius:50%;background:transparent;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;}',
      '.speak-btn:hover{background:#e8e8ed;transform:scale(1.08);}',
      '.speak-btn.speaking{background:#007aff;color:#fff;animation:pulse 1s ease-in-out infinite;}',
      '@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(0,122,255,0.3);}50%{box-shadow:0 0 0 8px rgba(0,122,255,0);}}',
      // Loading
      '.loading{text-align:center;padding:28px 0;}',
      '.spinner{width:28px;height:28px;border:3px solid #f0f0f0;border-top-color:#86868b;border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto 14px;}',
      '@keyframes spin{to{transform:rotate(360deg);}}',
      '@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(12px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}',
      // Content typography
      '.note-title{font-size:17px;font-weight:700;margin:0 0 4px;color:#1d1d1f;line-height:1.5;}',
      '.note-phonetic{font-size:15px;color:#86868b;margin:0 0 20px;font-style:italic;letter-spacing:0.02em;}',
      '.content p{margin:6px 0 14px;color:#3a3a3c;font-size:15px;line-height:1.7;}',
      '.content strong{font-weight:700;color:#1d1d1f;}',
      '.content em{color:#86868b;font-style:normal;font-size:14px;}',
      '.content h3{font-size:16px;font-weight:700;margin:18px 0 10px;color:#1d1d1f;}',
      '.content ul,.content ol{margin:6px 0 14px;padding-left:18px;}',
      '.content li{margin:4px 0;}',
      '.content blockquote{margin:6px 0 14px;padding:4px 10px;border-left:3px solid #007aff;color:#666;font-size:14px;}',
      // Chat area
      '.chat-area{margin-top:16px;}',
      '.chat-messages{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;}',
      '.chat-msg{padding:0;border-radius:0;font-size:15px;line-height:1.7;max-width:100%;word-break:break-word;}',
      '.chat-msg.user{align-self:flex-end;background:#007aff;color:#fff;padding:8px 12px;border-radius:10px;border-bottom-right-radius:4px;max-width:92%;font-size:13px;line-height:1.55;}',
      '.chat-msg.assistant{align-self:flex-start;background:transparent;color:#3a3a3c;}',
      '.chat-msg.assistant p{margin:6px 0 14px;}',
      '.chat-msg.assistant strong{font-weight:700;color:#1d1d1f;}',
      '.chat-msg.assistant h3{font-size:16px;font-weight:700;margin:18px 0 10px;color:#1d1d1f;}',
      '.chat-msg.assistant ul,.chat-msg.assistant ol{margin:6px 0 14px;padding-left:18px;}',
      '.chat-msg.assistant li{margin:4px 0;}',
      '.chat-msg.assistant blockquote{margin:6px 0 14px;padding:4px 10px;border-left:3px solid #007aff;color:#666;font-size:14px;}',
      '.chat-msg p{margin:2px 0;}',
      '.chat-msg p:first-child{margin-top:0;}',
      '.chat-msg p:last-child{margin-bottom:0;}',
      '.chat-msg strong{font-weight:700;color:#fff;}',
      '.chat-msg h3{font-size:14px;font-weight:700;margin:10px 0 4px;}',
      '.chat-msg ul,.chat-msg ol{margin:4px 0;padding-left:18px;}',
      '.chat-msg li{margin:2px 0;}',
      '.chat-msg blockquote{margin:6px 0;padding:4px 10px;border-left:3px solid rgba(255,255,255,0.5);color:rgba(255,255,255,0.85);font-size:12px;}',
      '.chat-input-row{display:flex;gap:10px;padding:12px 20px;flex-shrink:0;border-top:1px solid #e8e8ed;}',
      '.chat-input{flex:1;padding:8px 12px;border:1px solid #d1d1d6;border-radius:8px;font-size:13px;font-family:inherit;outline:none;background:#fff;color:#1d1d1f;transition:border-color 0.15s;}',
      '.chat-input:focus{border-color:#007aff;box-shadow:0 0 0 2px rgba(0,122,255,0.1);}',
      '.chat-input::placeholder{color:#aeaeb2;}',
      '.chat-send{padding:8px 20px;border:none;border-radius:8px;background:#007aff;color:#fff;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.15s;white-space:nowrap;flex-shrink:0;min-width:58px;}',
      '.chat-send:hover{background:#0066d6;}',
      '.chat-send:active{background:#0055b3;}',
      '.chat-send:disabled{opacity:0.4;cursor:default;}',
      '.chat-speak-btn{width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:#86868b;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;}',
      '.chat-speak-btn:hover{background:#f0f0f0;color:#1d1d1f;}',
      '.chat-speak-btn.speaking{background:#007aff;color:#fff;}',
      // Inline speaker in AI chat messages
      '.en-phrase-wrap{display:inline;white-space:normal;}',
      '.en-phrase-wrap .inline-speak{margin-left:1px;}',
      '.inline-speak{width:22px;height:22px;border:none;border-radius:50%;background:transparent;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;line-height:1;transition:all 0.15s;vertical-align:middle;margin-left:2px;}',
      '.inline-speak:hover{background:#e8e8ed;transform:scale(1.12);}',
      '.inline-speak.speaking{background:#007aff;color:#fff;}',
      // Error
      '.error-msg{padding:20px 0;text-align:center;color:#ff3b30;font-size:14px;}',
      // Footer
      '.footer{padding:12px 20px;border-top:1px solid #f0f0f0;flex-shrink:0;display:flex;flex-direction:column;gap:12px;}',
      '.save-config-row{display:flex;align-items:center;gap:10px;}',
      '.save-mode-btn{padding:5px 12px;border:1px solid #d0d0d0;border-radius:8px;background:#fff;color:#555;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.15s;white-space:nowrap;}',
      '.save-mode-btn.active{background:#007aff;color:#fff;border-color:#007aff;}',
      '.save-mode-btn:hover:not(.active){background:#f0f0f0;}',
      '.save-folder-input{flex:1;padding:6px 10px;border:1px solid #d0d0d0;border-radius:8px;font-size:12px;font-family:inherit;color:#1d1d1f;background:#fff;outline:none;transition:border-color 0.15s;}',
      '.save-folder-input:focus{color:#007aff;}',
      '.save-folder-input::placeholder{color:#aeaeb2;}',
      '.footer-divider{height:1px;background:#e8e8ed;margin:0;}',
      '.save-actions{display:flex;gap:10px;}',
      '.save-way{flex:1;padding:8px 6px;border:none;border-radius:8px;background:#f5f5f7;color:#1d1d1f;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;justify-content:center;gap:3px;line-height:1.3;white-space:normal;}',
      '.save-way:hover{background:#e8e8ed;}',
      '.save-way:active{background:#dcdce0;}',
      '.save-way:disabled{opacity:0.5;cursor:default;}',
      '.save-way.saved{background:#e3f9e5;color:#1d7a2b;}',
      '.body{position:relative;}',
    ].join('');
  }

  // ============================================================
  //  Draggable + Resizable
  // ============================================================
  var resizeEdge = null;

  function makeDraggable(host, header) {
    var ox=0, oy=0, dragging=false;

    function onHeaderDown(e) {
      if (resizeEdge) return;
      dragging=true; host.style.transform='none';
      ox=e.clientX-host.offsetLeft; oy=e.clientY-host.offsetTop; e.preventDefault();
    }

    function onMove(e) {
      if (dragging) {
        host.style.left=clamp(e.clientX-ox,0,window.innerWidth-100)+'px';
        host.style.top=clamp(e.clientY-oy,0,window.innerHeight-60)+'px';
      }
    }

    function onUp() { dragging=false; }

    header.addEventListener('mousedown', onHeaderDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    return function cleanup() {
      header.removeEventListener('mousedown', onHeaderDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }

  function makeResizable(host) {
    var EDGE = 8, sx, sy, sw, sh, sl, st;

    function onMove(e) {
      if (resizeEdge) {
        var dx = e.clientX - sx, dy = e.clientY - sy;
        var minW = 340, minH = 360, maxW = window.innerWidth - 16, maxH = window.innerHeight - 16;

        if (resizeEdge.indexOf('e') >= 0) host.style.width = clamp(sw + dx, minW, maxW) + 'px';
        if (resizeEdge.indexOf('w') >= 0) {
          var nw = clamp(sw - dx, minW, maxW);
          host.style.width = nw + 'px';
          host.style.left = (sl + sw - nw) + 'px';
        }
        if (resizeEdge.indexOf('s') >= 0) host.style.height = clamp(sh + dy, minH, maxH) + 'px';
        if (resizeEdge.indexOf('n') >= 0) {
          var nh = clamp(sh - dy, minH, maxH);
          host.style.height = nh + 'px';
          host.style.top = (st + sh - nh) + 'px';
        }
        return;
      }
      // 只在鼠标靠近边缘时计算 reflow（避免每次 mousemove 都调用 getBoundingClientRect）
      if (!host.isConnected) return;
      var edgeDist = Math.min(
        e.clientX - host.offsetLeft,
        host.offsetLeft + host.offsetWidth - e.clientX,
        e.clientY - host.offsetTop,
        host.offsetTop + host.offsetHeight - e.clientY
      );
      if (edgeDist > EDGE + 4) { host.style.cursor = ''; return; }

      var r = host.getBoundingClientRect();
      var t = e.clientY - r.top < EDGE && e.clientY - r.top >= -2;
      var b = r.bottom - e.clientY < EDGE && r.bottom - e.clientY >= -2;
      var l = e.clientX - r.left < EDGE && e.clientX - r.left >= -2;
      var ri = r.right - e.clientX < EDGE && r.right - e.clientX >= -2;

      if ((t && l) || (b && ri)) host.style.cursor = 'nwse-resize';
      else if ((t && ri) || (b && l)) host.style.cursor = 'nesw-resize';
      else if (t || b) host.style.cursor = 'ns-resize';
      else if (l || ri) host.style.cursor = 'ew-resize';
      else host.style.cursor = '';
    }

    function onDown(e) {
      if (!host.isConnected) return;
      var r = host.getBoundingClientRect();
      var t = e.clientY - r.top < EDGE && e.clientY - r.top >= -2;
      var b = r.bottom - e.clientY < EDGE && r.bottom - e.clientY >= -2;
      var l = e.clientX - r.left < EDGE && e.clientX - r.left >= -2;
      var ri = r.right - e.clientX < EDGE && r.right - e.clientX >= -2;

      if (!t && !b && !l && !ri) return;

      resizeEdge = (t ? 'n' : (b ? 's' : '')) + (l ? 'w' : (ri ? 'e' : ''));
      sx = e.clientX; sy = e.clientY;
      sw = r.width; sh = r.height;
      sl = r.left; st = r.top;
      e.preventDefault();
    }

    function onUp() { resizeEdge = null; }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);

    return function cleanup() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
    };
  }

  function clamp(v,min,max){return Math.min(Math.max(v,min),max);}

  // ============================================================
  //  获取初始解释
  // ============================================================
  function showPopup() {
    removeToolbar();

    // Check if Obsidian is configured — determines if save button shows
    getObsidianSettings(function(settings) {
      var hasObsidian = !!(settings.obsidianKey && settings.obsidianKey.trim());
      var defaultFolder = settings.obsidianFolder || '';
      createPopupContinue(hasObsidian, defaultFolder);
    });

    function createPopupContinue(hasObsidian, defaultFolder) {
    var root = createPopup(hasObsidian);
    var folderInput = root.querySelector('.save-folder-input');
    if (folderInput && defaultFolder) {
      folderInput.value = defaultFolder;
      folderInput.placeholder = defaultFolder;
    }
    var loadingEl = root.querySelector('.loading');
    var contentEl = root.querySelector('.content');
    var errorEl = root.querySelector('.error-msg');
    var chatArea = root.querySelector('.chat-area');
    var chatInputRow = root.querySelector('.chat-input-row');

    // Stream the explanation token by token
    var streamContent = '';
    var isJsonExplain = false;
    var explainPort = chrome.runtime.connect({ name: 'stream-explain' });
    explainPort.postMessage({ text: selectedText });
    explainPort.onMessage.addListener(function(msg) {
      if (!popupShadow) { try { explainPort.disconnect(); } catch(e) {} return; }
      if (msg.type === 'token') {
        streamContent += msg.content;
        // Detect JSON mode on first token; suppress raw JSON during streaming
        if (!isJsonExplain && streamContent.trim().charAt(0) === '{') {
          isJsonExplain = true;
        }
        if (!isJsonExplain) {
          loadingEl.style.display = 'none';
          contentEl.style.display = 'block';
          contentEl.innerHTML = renderChatMD(streamContent);
        }
      } else if (msg.type === 'done') {
        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
        initialExplanation = streamContent;
        var parsed = safeParseJSON(streamContent);
        if (parsed.ok) {
          explainData = parsed.data;
          titleExplain = explainData.title || selectedText;
          noteTags = (explainData.tags || []).join(', ');
          if (explainData.phonetic) {
            var phoneticEl = root.querySelector('.word-phonetic');
            if (phoneticEl) phoneticEl.textContent = explainData.phonetic;
          }
          contentEl.innerHTML = renderStructured(explainData);
        } else {
          titleExplain = selectedText;
          noteTags = '';
        }
        // 把初始解释注入 chatHistory（不显示），追问自然携带上下文，零额外 token
        chatHistory.push({ role: 'user', content: '帮我解释一下"' + selectedText + '"是什么意思' });
        chatHistory.push({ role: 'assistant', content: explainData ? buildMarkdown(explainData) : initialExplanation });
        chatArea.style.display = 'block';
        chatInputRow.style.display = 'flex';
      } else if (msg.type === 'error') {
        loadingEl.style.display = 'none';
        errorEl.textContent = '获取解释失败: ' + msg.error;
        errorEl.style.display = 'block';
      }
    });
  }
  }

  // ============================================================
  //  通用对话弹窗 (Ctrl+Q / 插件图标点击)
  // ============================================================
  function openChatDialog() {
    removePopup();
    removeToolbar();
    chatHistory = [];

    popupEl = document.createElement('div');
    popupEl.id = 'we-popup-host';
    popupEl._hasObsidian = false;
    Object.assign(popupEl.style, {
      position:'fixed',
      left: Math.max(8, Math.round((window.innerWidth - 480) / 2)) + 'px',
      top: Math.max(8, Math.round((window.innerHeight - 500) / 2)) + 'px',
      zIndex:'2147483646',
      width:'480px', height:'500px',
      minWidth:'340px', minHeight:'360px',
      overflow:'hidden'
    });

    popupShadow = popupEl.attachShadow({ mode:'open' });

    var style = document.createElement('style');
    style.textContent = getStyles() +
      '.header-right{display:flex;align-items:center;flex-shrink:0;}' +
      '.chat-input-textarea{flex:1;padding:10px 14px;border:1px solid #d1d1d6;border-radius:12px;font-size:14px;font-family:inherit;outline:none;background:#fff;color:#1d1d1f;resize:none;min-height:44px;max-height:120px;line-height:1.5;transition:border-color 0.15s;}' +
      '.chat-input-textarea:focus{border-color:#007aff;box-shadow:0 0 0 2px rgba(0,122,255,0.1);}' +
      '.chat-input-textarea::placeholder{color:#aeaeb2;}' +
      '.welcome-msg{text-align:center;padding:40px 20px;color:#86868b;font-size:14px;line-height:1.7;}' +
      '.welcome-msg b{color:#1d1d1f;}';
    popupShadow.appendChild(style);

    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '' +
      '<div class="header">' +
        '<div class="header-left">' +
          '<span class="header-title">框选解惑</span>' +
          '<span class="header-slogan">专治各种「这是什么？」</span>' +
        '</div>' +
        '<div class="header-right">' +
          '<button class="close">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="body">' +
        '<div class="chat-messages">' +
          '<div class="welcome-msg">' +
            '<b>你好！我是AI助手惑惑</b><br>' +
            '随便问，我能答尽答～' +
          '</div>' +
        '</div>' +
        '<div class="chat-input-row">' +
          '<textarea class="chat-input-textarea" placeholder="输入你的问题... (Enter 发)" rows="1"></textarea>' +
          '<button class="chat-send">发</button>' +
        '</div>' +
      '</div>' +
      '<div class="footer" style="display:flex;">' +
        '<input type="text" class="save-folder-input" placeholder="保存路径 (文件夹 或 文件夹/笔记名.md)">' +
        '<div class="save-actions">' +
          '<button class="save-way" data-way="obsidian" title="需要知识库运行中且已配置 API Key">📡 同步到知识库</button>' +
          '<button class="save-way" data-way="download" title="下载为 Markdown 文件到本地">📥 下载文件</button>' +
          '<button class="save-way" data-way="clipboard" title="复制 Markdown 内容，可粘贴到任何笔记软件">📋 复制内容</button>' +
        '</div>' +
      '</div>';
    popupShadow.appendChild(card);

    document.body.appendChild(popupEl);

    // Bind events
    popupShadow.querySelector('.close').addEventListener('click', removePopup);
    popupShadow.querySelector('.chat-send').addEventListener('click', sendGeneralChat);
    var textarea = popupShadow.querySelector('.chat-input-textarea');
    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendGeneralChat(); }
    });
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    // Save buttons in chat dialog
    getObsidianSettings(function(settings) {
      var hasKey = !!(settings.obsidianKey && settings.obsidianKey.trim());
      if (!hasKey && popupShadow) {
        var obsBtn = popupShadow.querySelector('.save-way[data-way="obsidian"]');
        if (obsBtn) obsBtn.style.display = 'none';
      }
      var folderInput = popupShadow && popupShadow.querySelector('.save-folder-input');
      if (folderInput && settings.obsidianFolder) {
        folderInput.value = settings.obsidianFolder;
        folderInput.placeholder = settings.obsidianFolder;
      }
      if (folderInput) {
        folderInput.addEventListener('keydown', function(e) {
          e.stopPropagation();
          if (e.key === '/' && e.defaultPrevented) {
            var start = this.selectionStart, end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '/' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1;
            this.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        folderInput.addEventListener('focus', function() {
          if (this.value && this.value.charAt(this.value.length - 1) !== '/') {
            this.value += '/';
            this.selectionStart = this.selectionEnd = this.value.length;
          }
        });
      }
    });
    popupShadow.querySelectorAll('.save-way').forEach(function(btn) {
      btn.addEventListener('click', function() {
        doSaveChat(btn.dataset.way);
      });
    });

    popupEl._dragCleanup = makeDraggable(popupEl, popupShadow.querySelector('.header'));
    popupEl._resizeCleanup = makeResizable(popupEl);

    setTimeout(function() { textarea.focus(); }, 150);
  }

  function sendGeneralChat() {
    if (!popupShadow) return;
    var input = popupShadow.querySelector('.chat-input-textarea');
    var sendBtn = popupShadow.querySelector('.chat-send');
    var question = input.value.trim();
    if (!question) return;

    // Hide welcome message
    var welcome = popupShadow.querySelector('.welcome-msg');
    if (welcome) welcome.style.display = 'none';

    input.disabled = true; sendBtn.disabled = true;
    input.style.height = 'auto';
    addChatMsg('user', question);
    input.value = '';

    // Create streaming message container
    var msgs = popupShadow.querySelector('.chat-messages');
    var streamMsgDiv = document.createElement('div');
    streamMsgDiv.className = 'msg assistant';
    msgs.appendChild(streamMsgDiv);
    msgs.scrollTop = msgs.scrollHeight;

    var streamContent = '';
    var genPort = chrome.runtime.connect({ name: 'stream-general' });
    genPort.postMessage({
      history: chatHistory // full history includes the user message just added
    });
    genPort.onMessage.addListener(function(msg) {
      if (!popupShadow) { try { genPort.disconnect(); } catch(e) {} return; }
      if (msg.type === 'token') {
        streamContent += msg.content;
        streamMsgDiv.innerHTML = renderChatMD(streamContent);
        injectWordSpeakers(streamMsgDiv);
        msgs.scrollTop = msgs.scrollHeight;
      } else if (msg.type === 'done') {
        chatHistory.push({ role: 'assistant', content: streamContent });
        input.disabled = false; sendBtn.disabled = false;
        input.focus();
      } else if (msg.type === 'error') {
        streamMsgDiv.innerHTML = renderChatMD('抱歉，出错了：' + msg.error);
        chatHistory.push({ role: 'assistant', content: '抱歉，出错了：' + msg.error });
        input.disabled = false; sendBtn.disabled = false;
        input.focus();
      }
    });
  }


  // ============================================================
  //  追问对话
  // ============================================================
  function sendChat() {
    if (!popupShadow) return;
    var input = popupShadow.querySelector('.chat-input');
    var sendBtn = popupShadow.querySelector('.chat-send');
    var question = input.value.trim();
    if (!question) return;

    input.disabled = true; sendBtn.disabled = true;
    addChatMsg('user', question);
    input.value = '';

      // Create streaming message container (no typing indicator)
    var msgs = popupShadow.querySelector('.chat-messages');
    var streamMsgDiv = document.createElement('div');
    streamMsgDiv.className = 'msg assistant';
    msgs.appendChild(streamMsgDiv);
    msgs.scrollTop = msgs.scrollHeight;

    var streamContent = '';
    var chatPort = chrome.runtime.connect({ name: 'stream-chat' });
    chatPort.postMessage({
      originalText: selectedText,
      explanation: explainData ? buildMarkdown(explainData) : initialExplanation,
      history: chatHistory.slice(0, -1), // exclude the user message just added
      question: question
    });
    chatPort.onMessage.addListener(function(msg) {
      if (!popupShadow) { try { chatPort.disconnect(); } catch(e) {} return; }
      if (msg.type === 'token') {
        streamContent += msg.content;
        streamMsgDiv.innerHTML = renderChatMD(streamContent);
        injectWordSpeakers(streamMsgDiv);
        msgs.scrollTop = msgs.scrollHeight;
      } else if (msg.type === 'done') {
        chatHistory.push({ role: 'assistant', content: streamContent });
        input.disabled = false; sendBtn.disabled = false;
        input.focus();
      } else if (msg.type === 'error') {
        streamMsgDiv.innerHTML = renderChatMD('抱歉，出错了：' + msg.error);
        chatHistory.push({ role: 'assistant', content: '抱歉，出错了：' + msg.error });
        input.disabled = false; sendBtn.disabled = false;
        input.focus();
      }
    });
  }

  function addChatMsg(role, content) {
    if (!popupShadow) return null;
    var msgs = popupShadow.querySelector('.chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    div.innerHTML = renderChatMD(content);
    injectWordSpeakers(div);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    chatHistory.push({ role: role, content: content });
    return div;
  }

  // 给容器内的英文单词追加朗读喇叭（连续英文串为一个喇叭）
  function injectWordSpeakers(container) {
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (node.parentNode && node.parentNode.classList.contains('en-phrase-wrap')) return NodeFilter.FILTER_REJECT;
        return /[a-zA-Z]/.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(textNode) {
      var text = textNode.textContent;
      var frag = document.createDocumentFragment();
      var lastIdx = 0;
      // 匹配连续英文单词序列（任意长度，空格/连字符连接），
      // 确保完整句子如 "This is a test" 只加一个喇叭
      var re = /([a-zA-Z]+(?:[\s'-][a-zA-Z]+)*)/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
        }
        var phrase = m[1];
        var wrap = document.createElement('span');
        wrap.className = 'en-phrase-wrap';
        var phraseSpan = document.createElement('span');
        phraseSpan.textContent = phrase;
        wrap.appendChild(phraseSpan);
        var btn = document.createElement('button');
        btn.className = 'inline-speak';
        btn.textContent = '🔊';
        btn.title = '读出发音';
        btn.setAttribute('data-word', phrase);
        wrap.appendChild(btn);
        frag.appendChild(wrap);
        lastIdx = m.index + phrase.length;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      if (frag.childNodes.length > 0) {
        textNode.parentNode.replaceChild(frag, textNode);
      }
    });
  }

  // ============================================================
  //  保存 Helper：确保标题包含检索词原文
  // ============================================================
  function formatNoteTitle(title, term) {
    if (!term) return title || term;
    if (!title) return term;
    if (/^[a-zA-Z]/.test(term)) {
      if (title.toLowerCase().indexOf(term.toLowerCase()) >= 0) return title;
      return term + ' ' + title;
    }
    return title;
  }

  // ============================================================
  //  保存（三途径：Obsidian API / 下载 / 剪贴板）
  // ============================================================

  function pollObsidianSave(saveParams, btn, origText) {
    var attempts = 0;
    (function poll() {
      setTimeout(function() {
        chrome.runtime.sendMessage(saveParams, function(retryResp) {
          if (retryResp && retryResp.success && retryResp.data && retryResp.data.method === 'rest') {
            btn.disabled = false;
            btn.textContent = '✓ 已同步'; btn.classList.add('saved');
            showToast('已保存到知识库');
          } else if (++attempts < 20) {
            poll();
          } else {
            btn.disabled = false;
            btn.textContent = origText;
            showToast('保存失败：无法连接 Obsidian，请确认 Obsidian 已打开');
          }
        });
      }, 1000);
    })();
  }

  function doSave(way) {
    if (!popupShadow) return;

    var explanationText = explainData ? buildMarkdown(explainData) : (initialExplanation || '');
    var btn = popupShadow.querySelector('.save-way[data-way="' + way + '"]');
    var origText = btn.textContent;
    btn.textContent = '...'; btn.disabled = true;

    var savePath = (popupShadow.querySelector('.save-folder-input') || {}).value || '';
    var parsed = parseSavePath(savePath);

    function executeSave(noteTitle, noteTags, noteBody) {
      if (way === 'obsidian') {
        chrome.runtime.sendMessage({
          action: 'saveToObsidian',
          originalText: noteTitle || selectedText,
          explanation: noteBody,
          sourceUrl: window.location.href,
          folderOverride: parsed.folder.trim(),
          tags: noteTags.join(', '),
          customFileName: parsed.noteName
        }, function(resp) {
          btn.disabled = false;
          if (resp && resp.success && resp.data) {
            if (resp.data.method === 'rest') {
              btn.textContent = '✓ 已同步'; btn.classList.add('saved');
              showToast('已保存到知识库');
            } else if (resp.data.method === 'uri') {
              openObsidianUri(resp.data.uri);
              btn.textContent = '...'; showToast('正在连接 Obsidian...');
              pollObsidianSave({
                action: 'saveToObsidian',
                originalText: noteTitle || selectedText,
                explanation: noteBody,
                sourceUrl: window.location.href,
                folderOverride: parsed.folder.trim(),
                tags: noteTags.join(', '),
                customFileName: parsed.noteName
              }, btn, origText);
              return;
            }
          } else {
            btn.textContent = origText;
            showToast('保存失败：' + (resp ? resp.error : '无响应'));
          }
        });
        return;
      }

      // Build final markdown for download/clipboard
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
        }).catch(function() {
          btn.textContent = origText;
          showToast('复制失败');
        });
        btn.disabled = false;
        return;
      }
    }

    // Call note planning AI before saving
    chrome.runtime.sendMessage({
      action: 'planNote',
      originalText: selectedText,
      explanation: explanationText,
      history: (saveMode === 'full' && chatHistory.length > 0) ? chatHistory : []
    }, function(resp) {
      if (resp && resp.success) {
        try {
          var parsed = safeParseJSON(resp.data);
          if (parsed.ok && parsed.data.title) {
            executeSave(parsed.data.title, parsed.data.tags || [], parsed.data.body || explanationText);
            return;
          }
        } catch (e) {}
      }
      // Fallback: construct basic note
      var fallbackBody = explanationText;
      if (saveMode === 'full' && chatHistory.length > 0) {
        fallbackBody += '\n\n---\n\n## 追问\n\n';
        for (var i = 0; i < chatHistory.length; i++) {
          var m = chatHistory[i];
          fallbackBody += (m.role === 'user' ? '**Q:** ' : '**A:** ') + m.content + '\n\n';
        }
      }
      executeSave(titleExplain || selectedText, [], fallbackBody);
    });
  }

  function openObsidianUri(uri) {
    try {
      var a = document.createElement('a');
      a.href = uri; a.style.display = 'none'; a.target = '_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {}
    try {
      var w = window.open(uri, '_blank');
      if (w) w.close();
    } catch (e) {}
  }

  // ============================================================
  //  聊天窗口保存
  // ============================================================
  function doSaveChat(way) {
    if (!popupShadow) return;

    // Extract first user message as originalText
    var firstUserMsg = '';
    var aiResponses = [];
    for (var i = 0; i < chatHistory.length; i++) {
      var m = chatHistory[i];
      if (m.role === 'user' && !firstUserMsg) firstUserMsg = m.content;
      if (m.role === 'assistant') aiResponses.push(m.content);
    }
    var explanationText = aiResponses.join('\n\n');

    var btn = popupShadow.querySelector('.save-way[data-way="' + way + '"]');
    var origText = btn.textContent;
    btn.textContent = '...'; btn.disabled = true;

    var savePath = (popupShadow.querySelector('.save-folder-input') || {}).value || '';
    var parsed = parseSavePath(savePath);

    // Build fallback raw content
    var fallbackLines = ['# 框选解惑 · AI 对话记录', '', '> ' + new Date().toISOString().split('T')[0], ''];
    for (var i = 0; i < chatHistory.length; i++) {
      var m = chatHistory[i];
      fallbackLines.push(m.role === 'user' ? '**🙋 我**：' + m.content : '**🤖 惑惑**：' + m.content);
      fallbackLines.push('');
    }
    var fallbackContent = fallbackLines.join('\n');
    var safeName = '对话记录_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    var effectiveFileName = parsed.noteName || safeName;

    function executeSaveChat(noteTitle, noteTags, noteBody) {
      if (way === 'obsidian') {
        chrome.runtime.sendMessage({
          action: 'saveToObsidian',
          originalText: noteTitle || effectiveFileName,
          explanation: noteBody,
          sourceUrl: window.location.href,
          folderOverride: parsed.folder.trim(),
          tags: noteTags.join(', '),
          customFileName: parsed.noteName || ''
        }, function(resp) {
          btn.disabled = false;
          if (resp && resp.success && resp.data) {
            if (resp.data.method === 'rest') {
              btn.textContent = '✓ 已同步'; btn.classList.add('saved');
              showToast('已保存到知识库');
            } else if (resp.data.method === 'uri') {
              openObsidianUri(resp.data.uri);
              btn.textContent = '...'; showToast('正在连接 Obsidian...');
              pollObsidianSave({
                action: 'saveToObsidian',
                originalText: noteTitle || effectiveFileName,
                explanation: noteBody,
                sourceUrl: window.location.href,
                folderOverride: parsed.folder.trim(),
                tags: noteTags.join(', '),
                customFileName: parsed.noteName || ''
              }, btn, origText);
              return;
            }
          } else {
            btn.textContent = origText;
            showToast('保存失败');
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
          var safeDownloadName = noteTitle.replace(/[\\/:*?"<>|#\n\r]/g, '').trim().slice(0, 40) || '未命名';
          var blob = new Blob([fullContent], { type: 'text/markdown;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = safeDownloadName + '.md';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          btn.textContent = '✓ 已下载'; btn.classList.add('saved');
          showToast('已下载 Markdown 文件');
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
      originalText: firstUserMsg || selectedText,
      explanation: explanationText || initialExplanation || '',
      history: chatHistory
    }, function(resp) {
      if (resp && resp.success) {
        try {
          var parsed = safeParseJSON(resp.data);
          if (parsed.ok && parsed.data.title) {
            executeSaveChat(parsed.data.title, parsed.data.tags || [], parsed.data.body || fallbackContent);
            return;
          }
        } catch (e) {}
      }
      // Fallback: save raw chat content
      executeSaveChat(effectiveFileName, [], fallbackContent);
    });
  }

  // ============================================================
  //  朗读
  // ============================================================
  function speak() {
    if (!popupShadow) return;
    speakText(selectedText, popupShadow.querySelector('.speak-btn'));
  }


  // ============================================================
  //  语音朗读（使用 chrome.tts 扩展 API）
  //  Chrome 限制 content script 直接调用 speechSynthesis，
  //  使用 chrome.tts API 可绕过此限制且不受页面 CSP 影响。
  // ============================================================

  // 语音端口（延迟初始化，断开后自动重连）
  var _speechPort = null;
  var _currentSpeakBtn = null;

  function getSpeechPort() {
    if (_speechPort === null) {
      _speechPort = chrome.runtime.connect({name: 'speech'});

      _speechPort.onDisconnect.addListener(function() {
        _speechPort = null;
        isSpeaking = false;
        if (_currentSpeakBtn) {
          _currentSpeakBtn.classList.remove('speaking');
          _currentSpeakBtn = null;
        }
      });

      _speechPort.onMessage.addListener(function(msg) {
        switch (msg.type) {
          case '__WE_SPEECH_START':
            isSpeaking = true;
            break;
          case '__WE_SPEECH_END':
          case '__WE_SPEECH_ERROR':
            isSpeaking = false;
            if (_currentSpeakBtn) {
              _currentSpeakBtn.classList.remove('speaking');
              _currentSpeakBtn = null;
            }
            // 清除所有喇叭按钮的 speaking 状态
            if (popupShadow) {
              popupShadow.querySelectorAll('.inline-speak.speaking').forEach(function(b) {
                b.classList.remove('speaking');
              });
            }
            break;
        }
      });
    }
    return _speechPort;
  }

  function cancelSpeaking() {
    try { getSpeechPort().postMessage({action: 'cancel'}); } catch(e) {}
    isSpeaking = false;
    if (_currentSpeakBtn) {
      _currentSpeakBtn.classList.remove('speaking');
      _currentSpeakBtn = null;
    }
    if (popupShadow) {
      popupShadow.querySelectorAll('.inline-speak.speaking').forEach(function(b) {
        b.classList.remove('speaking');
      });
    }
  }

  function speakText(text, btn) {
    if (!text || !btn) return;

    // 如果正在朗读，取消并返回
    if (isSpeaking) {
      cancelSpeaking();
      btn.classList.remove('speaking');
      return;
    }

    // 通过 background script 的 chrome.tts API 播放语音
    _currentSpeakBtn = btn;
    try {
      getSpeechPort().postMessage({
        action: 'speak',
        text: text,
        lang: detectLang(text)
      });
    } catch(e) {
      _currentSpeakBtn = null;
      btn.classList.remove('speaking');
      return;
    }
    btn.classList.add('speaking');
    isSpeaking = true;
  }

  function detectLang(text) {
    if (/[一-鿿]/.test(text)) return 'zh-CN';
    if (/[가-힯]/.test(text)) return 'ko-KR';
    if (/[฀-๿]/.test(text)) return 'th-TH';
    if (/[぀-ヿ]/.test(text)) return 'ja-JP';
    return 'en-US';
  }

  // ============================================================
  //  Toast 提示
  // ============================================================
  function showToast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);'
      + 'background:#1d1d1f;color:#fff;padding:10px 24px;border-radius:20px;'
      + 'font-size:14px;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,0.25);'
      + 'pointer-events:none;animation:toastIn 0.3s ease';
    document.body.appendChild(t);
    setTimeout(function() {
      t.style.opacity = '0'; t.style.transition = 'opacity 0.3s';
      setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 3000);
  }

  // ============================================================
  //  健壮 JSON 提取：处理 AI 常见的格式问题
  // ============================================================
  function extractJSON(raw) {
    // 1. 去掉 markdown 代码块包裹
    var text = raw
      .replace(/```(?:json)?\s*\n?/gi, '')
      .replace(/```\s*$/gi, '')
      .trim();

    // 2. 括号配对法找最外层 JSON 对象（避免贪婪正则在多对象场景出错）
    var start = text.indexOf('{');
    if (start === -1) return text;

    var depth = 0;
    var inString = false;
    var escaped = false;
    for (var i = start; i < text.length; i++) {
      var ch = text.charAt(i);
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    // 没有找到配对的闭合括号，返回全文本
    return text;
  }

  function repairJSON(text) {
    // 修复常见 AI 犯错：
    // a) 尾部逗号：},] 或 ,} 或 ,]
    var cleaned = text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    // b) 字符串值里的未转义换行（把裸换行替换为 \n）
    //    在 JSON 字符串值内部，literal newline 是非法的
    var inStr = false, esc = false, buf = '';
    for (var i = 0; i < cleaned.length; i++) {
      var c = cleaned.charAt(i);
      if (esc) { buf += c; esc = false; continue; }
      if (c === '\\') { buf += c; esc = true; continue; }
      if (c === '"') { inStr = !inStr; buf += c; continue; }
      if (inStr) {
        if (c === '\n') buf += '\\n';
        else if (c === '\r') { /* skip */ }
        else if (c === '\t') buf += '\\t';
        else buf += c;
      } else {
        buf += c;
      }
    }
    return buf;
  }

  // 返回 { ok: true, data: object } 或 { ok: false, raw: string }
  function safeParseJSON(raw) {
    var jsonStr = extractJSON(raw);

    // 先直接试
    try { return { ok: true, data: JSON.parse(jsonStr) }; } catch (e) { /* continue */ }

    // 修复后再试
    var repaired = repairJSON(jsonStr);
    try { return { ok: true, data: JSON.parse(repaired) }; } catch (e) { /* continue */ }

    return { ok: false, raw: raw };
  }
  var LABEL_ICON = {
    '是谁': '👤', '核心印象': '💡', '为什么重要': '🎯', '感兴趣': '🔗',
    '前缀': '🔤', '后缀': '🔡', '音标详解': '🔊', '词义分析': '📝', '常见搭配': '🔗', '辅助记忆': '🧠', '单词变形': '🔄', '行业概念': '🏭',
    '领域': '📚', '故事': '📖', '原来如此': '🔍',
    '一句话': '💬', '常出现在': '📍', '补充': '💡'
  };

  function iconLabel(label) {
    return (LABEL_ICON[label] || '') + label;
  }

  function renderInlineMD(text) {
    return escapeHTML(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }

  function renderStructured(data) {
    var html = '<h2 class="note-title">' + escapeHTML(data.title || '') + '</h2>';
    // 音标显示在标题下方
    if (data.phonetic) {
      html += '<div class="note-phonetic">' + escapeHTML(data.phonetic) + '</div>';
    }
    var sections = data.sections || [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      html += '<p>' + escapeHTML(iconLabel(sec.label || '')) + '：' +
        renderInlineMD(sec.text || '') + '</p>';
    }
    return html;
  }

  function buildMarkdown(data) {
    var lines = [];
    var sections = data.sections || [];
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      lines.push(iconLabel(s.label || '') + '：' + (s.text || ''));
    }
    return lines.join('\n\n');
  }

  function renderChatMD(md) {
    var lines = escapeHTML(md).split('\n');
    var out = [];
    var inUl = false, inOl = false;

    function closeLists() {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (inUl) { out.push('</ul>'); inUl = false; }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

      // ### Heading
      var h = line.match(/^### (.+)/);
      if (h) { closeLists(); out.push('<h3>' + h[1] + '</h3>'); continue; }

      // > Blockquote
      var bq = line.match(/^&gt; (.+)/);
      if (bq) { closeLists(); out.push('<blockquote>' + bq[1] + '</blockquote>'); continue; }

      // - Unordered list
      var ul = line.match(/^[\-\*] (.+)/);
      if (ul) {
        if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
        out.push('<li>' + ul[1] + '</li>');
        continue;
      }

      // 1. Ordered list
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

  function escapeHTML(s) {
    var d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  // ============================================================
  //  独立新弹窗（"这是什么"功能）
  // ============================================================
  function launchNewExplorer(word) {
    if (_extraPopups.length >= 5) { showToast('最多同时打开 5 个窗口'); return; }

    var baseLeft = 80 + _extraPopups.length * 28;
    var baseTop  = 80 + _extraPopups.length * 28;

    var el = document.createElement('div');
    el.id = 'we-popup-host';
    Object.assign(el.style, {
      position:'fixed',
      left: Math.min(baseLeft, window.innerWidth - 460) + 'px',
      top: Math.min(baseTop, window.innerHeight - 570) + 'px',
      zIndex:'2147483646',
      width:'440px', height:'550px',
      minWidth:'340px', minHeight:'400px',
      overflow:'hidden'
    });

    var shadow = el.attachShadow({ mode:'open' });
    var style = document.createElement('style');
    style.textContent = getStyles();
    shadow.appendChild(style);
    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = getHTML();
    shadow.appendChild(card);
    document.body.appendChild(el);

    // 实例状态
    var inst = {
      el: el, shadow: shadow, text: word,
      chatHistory: [], initialExplanation: '', explainData: null,
      titleExplain: word, noteTags: '', saveMode: 'explanation', _hasObsidian: false
    };

    // Obsidian 配置
    getObsidianSettings(function(s) {
      inst._hasObsidian = !!(s.obsidianKey && s.obsidianKey.trim());
      if (!inst.shadow) return;
      var fi = inst.shadow.querySelector('.save-folder-input');
      if (fi && s.obsidianFolder) { fi.value = s.obsidianFolder; fi.placeholder = s.obsidianFolder; }
      if (fi) { fi.addEventListener('keydown', function(e) {
        e.stopPropagation();
        if (e.key === '/' && e.defaultPrevented) {
          var start = this.selectionStart, end = this.selectionEnd;
          this.value = this.value.substring(0, start) + '/' + this.value.substring(end);
          this.selectionStart = this.selectionEnd = start + 1;
          this.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
        fi.addEventListener('focus', function() {
          if (this.value && this.value.charAt(this.value.length - 1) !== '/') {
            this.value += '/';
            this.selectionStart = this.selectionEnd = this.value.length;
          }
        }); }
      if (!inst._hasObsidian) {
        var ob = inst.shadow.querySelector('.save-way[data-way="obsidian"]');
        if (ob) ob.style.display = 'none';
      }
    });

    // 关闭
    shadow.querySelector('.close').addEventListener('click', function() { closeExplorer(inst); });
    // 朗读
    shadow.querySelector('.speak-btn').addEventListener('click', function() {
      speakText(word, shadow.querySelector('.speak-btn'));
    });
    // 所有文字 → 显示 word-box
    var wb = shadow.querySelector('.word-box');
    if (wb) { wb.style.display = 'flex'; wb.querySelector('.word-text').textContent = word; }
    // Footer
    shadow.querySelector('.footer').style.display = 'flex';

    // 追问输入
    shadow.querySelector('.chat-send').addEventListener('click', function() { sendExplorerChat(inst); });
    shadow.querySelector('.chat-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendExplorerChat(inst); }
    });

    // 保存模式切换
    shadow.querySelectorAll('.save-mode-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        shadow.querySelectorAll('.save-mode-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        inst.saveMode = btn.dataset.mode;
      });
    });
    // 保存按钮
    shadow.querySelectorAll('.save-way').forEach(function(btn) {
      btn.addEventListener('click', function() { doExplorerSave(inst, btn.dataset.way); });
    });
    // 委托：AI 回复中英文短语的朗读喇叭
    shadow.querySelector('.chat-messages').addEventListener('click', function(e) {
      var btn = e.target.closest('.inline-speak');
      if (!btn) return;
      e.stopPropagation();
      var word = btn.getAttribute('data-word');
      if (word) speakText(word, btn);
    });


    // 拖拽 + 缩放
    el._dragCleanup = makeDraggable(el, shadow.querySelector('.header'));
    el._resizeCleanup = makeResizable(el);

    _extraPopups.push(inst);

    // ---- 加载 AI 解释 ----
    var loadingEl = shadow.querySelector('.loading');
    var contentEl = shadow.querySelector('.content');
    var errorEl = shadow.querySelector('.error-msg');
    var chatArea = shadow.querySelector('.chat-area');
    var chatInputRow = shadow.querySelector('.chat-input-row');

    // Stream the explanation token by token
    var streamContent = '';
    var isJsonExplain = false;
    var explainPort = chrome.runtime.connect({ name: 'stream-explain' });
    explainPort.postMessage({ text: word });
    explainPort.onMessage.addListener(function(msg) {
      if (!inst.shadow) { try { explainPort.disconnect(); } catch(e) {} return; }
      if (msg.type === 'token') {
        streamContent += msg.content;
        // Detect JSON mode on first token; suppress raw JSON during streaming
        if (!isJsonExplain && streamContent.trim().charAt(0) === '{') {
          isJsonExplain = true;
        }
        if (!isJsonExplain) {
          loadingEl.style.display = 'none';
          contentEl.style.display = 'block';
          contentEl.innerHTML = renderChatMD(streamContent);
        }
      } else if (msg.type === 'done') {
        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
        inst.initialExplanation = streamContent;
        var parsed = safeParseJSON(streamContent);
        if (parsed.ok) {
          inst.explainData = parsed.data;
          inst.titleExplain = parsed.data.title || word;
          inst.noteTags = (parsed.data.tags || []).join(', ');
          var pe = shadow.querySelector('.word-phonetic');
          if (pe && parsed.data.phonetic) pe.textContent = parsed.data.phonetic;
          contentEl.innerHTML = renderStructured(parsed.data);
        } else {
          inst.titleExplain = word; inst.noteTags = '';
        }
        // 把初始解释注入 chatHistory（不显示），追问自然携带上下文，零额外 token
        inst.chatHistory.push({ role: 'user', content: '帮我解释一下"' + word + '"是什么意思' });
        inst.chatHistory.push({ role: 'assistant', content: inst.explainData ? buildMarkdown(inst.explainData) : inst.initialExplanation });
        chatArea.style.display = 'block';
        chatInputRow.style.display = 'flex';
      } else if (msg.type === 'error') {
        loadingEl.style.display = 'none';
        errorEl.textContent = '获取解释失败: ' + msg.error;
        errorEl.style.display = 'block';
      }
    });
    return inst;
  }

  function closeExplorer(inst) {
    if (!inst || !inst.el) return;
    if (isSpeaking) { cancelSpeaking(); }
    if (inst._dragCleanup) { inst._dragCleanup(); inst._dragCleanup = null; }
    if (inst._resizeCleanup) { inst._resizeCleanup(); inst._resizeCleanup = null; }
    inst.el.remove(); inst.el = null; inst.shadow = null;
    for (var i = 0; i < _extraPopups.length; i++) {
      if (_extraPopups[i] === inst) { _extraPopups.splice(i, 1); break; }
    }
  }

  function sendExplorerChat(inst) {
    if (!inst.shadow) return;
    var input = inst.shadow.querySelector('.chat-input');
    var sendBtn = inst.shadow.querySelector('.chat-send');
    var question = input.value.trim();
    if (!question) return;
    input.disabled = true; sendBtn.disabled = true;
    addExplorerChatMsg(inst, 'user', question);
    input.value = '';

    // Create streaming message container
    var msgs = inst.shadow.querySelector('.chat-messages');
    var streamMsgDiv = document.createElement('div');
    streamMsgDiv.className = 'msg assistant';
    msgs.appendChild(streamMsgDiv);
    msgs.scrollTop = msgs.scrollHeight;

    var streamContent = '';
    var chatPort = chrome.runtime.connect({ name: 'stream-chat' });
    chatPort.postMessage({
      originalText: inst.text,
      explanation: inst.explainData ? buildMarkdown(inst.explainData) : inst.initialExplanation,
      history: inst.chatHistory.slice(0, -1), // exclude the user message just added
      question: question
    });
    chatPort.onMessage.addListener(function(msg) {
      if (!inst.shadow) { try { chatPort.disconnect(); } catch(e) {} return; }
      if (msg.type === 'token') {
        streamContent += msg.content;
        streamMsgDiv.innerHTML = renderChatMD(streamContent);
        injectWordSpeakers(streamMsgDiv);
        msgs.scrollTop = msgs.scrollHeight;
      } else if (msg.type === 'done') {
        inst.chatHistory.push({ role: 'assistant', content: streamContent });
        input.disabled = false; sendBtn.disabled = false;
        input.focus();
      } else if (msg.type === 'error') {
        streamMsgDiv.innerHTML = renderChatMD('抱歉，出错了：' + msg.error);
        inst.chatHistory.push({ role: 'assistant', content: '抱歉，出错了：' + msg.error });
        input.disabled = false; sendBtn.disabled = false;
        input.focus();
      }
    });
  }

  function addExplorerChatMsg(inst, role, content) {
    if (!inst.shadow) return null;
    var msgs = inst.shadow.querySelector('.chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    div.innerHTML = renderChatMD(content);
    injectWordSpeakers(div);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    inst.chatHistory.push({ role: role, content: content });
    return div;
  }

  function doExplorerSave(inst, way) {
    if (!inst.shadow) return;
    var explanationText = inst.explainData ? buildMarkdown(inst.explainData) : (inst.initialExplanation || '');
    var btn = inst.shadow.querySelector('.save-way[data-way="' + way + '"]');
    var origText = btn.textContent;
    btn.textContent = '...'; btn.disabled = true;

    var savePath = (inst.shadow.querySelector('.save-folder-input') || {}).value || '';
    var parsed = parseSavePath(savePath);

    function executeSave(noteTitle, noteTags, noteBody) {
      if (way === 'obsidian') {
        chrome.runtime.sendMessage({
          action: 'saveToObsidian',
          originalText: noteTitle || inst.text,
          explanation: noteBody,
          sourceUrl: window.location.href,
          folderOverride: parsed.folder.trim(),
          tags: noteTags.join(', '),
          customFileName: parsed.noteName
        }, function(resp) {
          btn.disabled = false;
          if (resp && resp.success && resp.data) {
            if (resp.data.method === 'rest') {
              btn.textContent = '✓ 已同步'; btn.classList.add('saved');
              showToast('已保存到知识库');
            } else if (resp.data.method === 'uri') {
              openObsidianUri(resp.data.uri);
              btn.textContent = '...'; showToast('正在连接 Obsidian...');
              pollObsidianSave({
                action: 'saveToObsidian',
                originalText: noteTitle || inst.text,
                explanation: noteBody,
                sourceUrl: window.location.href,
                folderOverride: parsed.folder.trim(),
                tags: noteTags.join(', '),
                customFileName: parsed.noteName
              }, btn, origText);
              return;
            }
          } else {
            btn.textContent = origText;
            showToast('保存失败：' + (resp ? resp.error : '无响应'));
          }
        });
        return;
      }

      // Build final markdown for download/clipboard
      var tagsLine = '';
      if (noteTags.length > 0) {
        tagsLine = '\n\n> 标签：' + noteTags.join('、');
      }
      var fullContent = '# ' + noteTitle + '\n\n' + noteBody + tagsLine;

      if (way === 'download') {
        try {
          var safeName = noteTitle.replace(/[\\/:*?"<>|#\n\r]/g, '').trim().slice(0, 40) || '未命名';
          var blob = new Blob([fullContent], { type:'text/markdown;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = safeName + '.md';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          btn.textContent = '✓ 已下载'; btn.classList.add('saved');
          showToast('已下载 Markdown 文件');
        } catch(e) { btn.textContent = origText; showToast('下载失败'); }
        btn.disabled = false; return;
      }
      if (way === 'clipboard') {
        navigator.clipboard.writeText(fullContent).then(function() {
          btn.textContent = '✓ 已复制'; btn.classList.add('saved');
          showToast('已复制到剪贴板');
        }).catch(function() { btn.textContent = origText; showToast('复制失败'); });
        btn.disabled = false; return;
      }
    }

    // Call note planning AI before saving
    chrome.runtime.sendMessage({
      action: 'planNote',
      originalText: inst.text,
      explanation: explanationText,
      history: (inst.saveMode === 'full' && inst.chatHistory.length > 0) ? inst.chatHistory : []
    }, function(resp) {
      if (resp && resp.success) {
        try {
          var parsed = safeParseJSON(resp.data);
          if (parsed.ok && parsed.data.title) {
            executeSave(parsed.data.title, parsed.data.tags || [], parsed.data.body || explanationText);
            return;
          }
        } catch (e) {}
      }
      // Fallback
      var fallbackBody = explanationText;
      if (inst.saveMode === 'full' && inst.chatHistory.length > 0) {
        fallbackBody += '\n\n---\n\n## 追问\n\n';
        for (var i = 0; i < inst.chatHistory.length; i++) {
          var m = inst.chatHistory[i];
          fallbackBody += (m.role === 'user' ? '**Q:** ' : '**A:** ') + m.content + '\n\n';
        }
      }
      executeSave(inst.titleExplain || inst.text, [], fallbackBody);
    });
  }

  // ============================================================
  //  页面框选检测（防抖）
  // ============================================================
  var selDebounceTimer = 0;
  document.addEventListener('mouseup', function(e) {
    if (isOurs(e.target)) return;
    clearTimeout(selDebounceTimer);
    selDebounceTimer = setTimeout(function() {
      var sel = window.getSelection();
      var text = (sel||'').toString().trim();
      if (!text) { removeToolbar(); return; }
      selectedText = text;
      var rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect) return;
      createToolbar(
        Math.min(rect.right+8, window.innerWidth-160),
        Math.max(rect.bottom+6, 10)
      );
    }, 250);
  });

  var outsideClickTimer = 0;

  document.addEventListener('mousedown', function(e) {
    // 点击弹窗外围仅闪烁红色提示，不关闭
    if (popupEl && !isOurs(e.target) && !popupEl.contains(e.target)) {
      popupEl.style.outline = '3px solid #ff3b30';
      popupEl.style.outlineOffset = '-3px';
      if (outsideClickTimer) { clearTimeout(outsideClickTimer); }
      outsideClickTimer = setTimeout(function() {
        outsideClickTimer = 0;
        if (popupEl) popupEl.style.outline = '';
      }, 3000);
      return;
    }
    // 点到任意弹窗 → 清理主弹窗的 outline
    if (isOurs(e.target)) {
      if (outsideClickTimer) { clearTimeout(outsideClickTimer); outsideClickTimer = 0; }
      if (popupEl) popupEl.style.outline = '';
    }
    if (toolbarEl && !isOurs(e.target) && !toolbarEl.contains(e.target)) removeToolbar();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key==='Escape') {
      if (toolbarEl) removeToolbar();
    }
  });

  function isOurs(el) {
    if (!el) return false;
    var id = el.id;
    if (id==='we-toolbar' || id==='we-popup-host') return true;
    var p = el.parentElement;
    return p && (p.id==='we-toolbar' || p.id==='we-popup-host');
  }


  // 监听来自 background 的消息（快捷键 / 图标点击）
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'openChat') {
      openChatDialog();
    }
  });

})();
