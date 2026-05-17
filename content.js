(function() {
  'use strict';

  var selectedText = '';
  var toolbarEl = null;
  var popupEl = null;
  var popupShadow = null;
  var isSpeaking = false;
  var initialExplanation = '';     // 初始解释内容
  var chatHistory = [];            // {role:'user'|'assistant', content}
  var saveMode = 'explanation';    // 'explanation' | 'full'

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
    icon.src = chrome.runtime.getURL('icons/icon16.png');
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
    if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking = false; }
    if (toolbarEl) { toolbarEl.remove(); toolbarEl = null; }
  }

  // ============================================================
  //  弹窗
  // ============================================================
  function createPopup(hasObsidian) {
    removePopup();
    // reset state
    initialExplanation = ''; chatHistory = []; saveMode = 'explanation';

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
    makeDraggable(popupEl, popupShadow.querySelector('.header'));
    makeResizable(popupEl);

    return popupShadow;
  }

  function bindEvents(hasObsidian) {
    var r = popupShadow;
    r.querySelector('.close').addEventListener('click', removePopup);
    r.querySelector('.speak-btn').addEventListener('click', speak);
    r.querySelector('.chat-send').addEventListener('click', sendChat);
    r.querySelector('.re-explain-btn').addEventListener('click', reExplain);
    r.querySelector('.chat-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
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
  }

  function removePopup() {
    if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking = false; }
    if (outsideClickTimer) { clearTimeout(outsideClickTimer); outsideClickTimer = 0; }
    if (popupEl) { popupEl.style.outline = ''; popupEl.remove(); popupEl = null; popupShadow = null; }
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
        // Word box
        '<div class="word-box">' +
          '<span class="word-text">' + escapeHTML(selectedText) + '</span>' +
          '<button class="speak-btn" title="朗读框选的文字">🔊 朗读</button>' +
        '</div>' +
        // Loading
        '<div class="loading">' +
          '<div class="spinner"></div>' +
          '<p style="color:#86868b;font-size:13px;">正在生成解释...</p>' +
        '</div>' +
        // Initial explanation
        '<div class="content" style="display:none;"></div>' +
        // Chat area (hidden until explanation loads)
        '<div class="chat-area" style="display:none;">' +
          '<div class="chat-divider"><span>追问</span></div>' +
          '<div class="chat-messages"></div>' +
          '<div class="chat-input-row">' +
            '<input type="text" class="chat-input" placeholder="还有疑问？继续问...">' +
            '<button class="chat-send">发送</button>' +
          '</div>' +
        '</div>' +
        // Error
        '<div class="error-msg" style="display:none;"></div>' +
        // Re-explain
        '<div class="re-explain-row" style="display:none;">' +
          '<button class="re-explain-btn">🔄 换种方式解释</button>' +
        '</div>' +
      '</div>' +
      // Footer
      '<div class="footer" style="display:none;">' +
        '<div class="save-hint">💡 把解释存到你的知识库</div>' +
        '<div class="save-mode-row">' +
          '<span class="save-mode-label">保存内容：</span>' +
          '<button class="save-mode-btn active" data-mode="explanation" title="只保存 AI 给的第一条解释">仅这条解释</button>' +
          '<button class="save-mode-btn" data-mode="full" title="保存解释 + 后续追问的全部对话">含追问记录</button>' +
        '</div>' +
        '<div class="save-folder-row">' +
          '<span class="save-folder-label">📁</span>' +
          '<input type="text" class="save-folder-input" placeholder="输入文件夹名（可选）">' +
        '</div>' +
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
      '.header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:#fbfbfd;border-bottom:1px solid #f0f0f0;cursor:move;user-select:none;flex-shrink:0;}',
      '.header-left{display:flex;align-items:baseline;gap:8px;}',
      '.header-title{font-size:15px;font-weight:600;color:#1d1d1f;letter-spacing:-0.01em;}',
      '.header-slogan{font-size:11px;color:#86868b;font-weight:400;white-space:nowrap;}',
      '.close{width:28px;height:28px;border:none;border-radius:50%;background:#f0f0f0;color:#86868b;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}',
      '.close:hover{background:#e5e5e5;color:#1d1d1f;}',
      // Body
      '.body{padding:20px;overflow-y:auto;flex:1;}',
      '.body::-webkit-scrollbar{width:4px;}',
      '.body::-webkit-scrollbar-thumb{background:#d2d2d7;border-radius:2px;}',
      // Word box
      '.word-box{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;margin-bottom:20px;background:#f5f5f7;border-radius:14px;}',
      '.word-text{font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.02em;word-break:break-word;line-height:1.3;flex:1;}',
      '.speak-btn{width:36px;height:36px;border:none;border-radius:50%;background:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,0.06);transition:all 0.15s;}',
      '.speak-btn:hover{background:#f0f0f0;transform:scale(1.05);}',
      '.speak-btn.speaking{background:#007aff;color:#fff;animation:pulse 1s ease-in-out infinite;}',
      '@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(0,122,255,0.3);}50%{box-shadow:0 0 0 8px rgba(0,122,255,0);}}',
      // Loading
      '.loading{text-align:center;padding:28px 0;}',
      '.spinner{width:28px;height:28px;border:3px solid #f0f0f0;border-top-color:#86868b;border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto 14px;}',
      '@keyframes spin{to{transform:rotate(360deg);}}',
      '@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(12px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}',
      // Content typography
      '.content h3{font-size:15px;font-weight:600;margin:18px 0 6px;color:#1d1d1f;letter-spacing:-0.01em;}',
      '.content h3:first-child{margin-top:0;}',
      '.content p{margin:4px 0 12px;color:#3a3a3c;font-size:15px;line-height:1.65;}',
      '.content strong{color:#1d1d1f;font-weight:600;}',
      '.content em{color:#86868b;}',
      '.content blockquote{margin:10px 0;padding:10px 14px;border-left:3px solid #007aff;background:#f5f5f7;border-radius:0 10px 10px 0;color:#3a3a3c;font-size:14px;}',
      // Chat area
      '.chat-area{margin-top:16px;}',
      '.chat-divider{display:flex;align-items:center;gap:10px;margin-bottom:12px;color:#86868b;font-size:12px;user-select:none;}',
      '.chat-divider::before,.chat-divider::after{content:"";flex:1;height:1px;background:#f0f0f0;}',
      '.chat-messages{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;max-height:240px;overflow-y:auto;}',
      '.chat-messages::-webkit-scrollbar{width:3px;}',
      '.chat-messages::-webkit-scrollbar-thumb{background:#d2d2d7;border-radius:2px;}',
      '.chat-msg{padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.55;max-width:92%;word-break:break-word;}',
      '.chat-msg.user{align-self:flex-end;background:#007aff;color:#fff;border-bottom-right-radius:4px;}',
      '.chat-msg.assistant{align-self:flex-start;background:#f5f5f7;color:#1d1d1f;border-bottom-left-radius:4px;}',
      '.chat-input-row{display:flex;gap:8px;}',
      '.chat-input{flex:1;padding:8px 12px;border:1px solid #d1d1d6;border-radius:10px;font-size:13px;font-family:inherit;outline:none;background:#fff;color:#1d1d1f;transition:border-color 0.15s;}',
      '.chat-input:focus{border-color:#007aff;box-shadow:0 0 0 2px rgba(0,122,255,0.1);}',
      '.chat-input::placeholder{color:#aeaeb2;}',
      '.chat-send{padding:8px 20px;border:none;border-radius:10px;background:#007aff;color:#fff;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.15s;white-space:nowrap;flex-shrink:0;min-width:58px;}',
      '.chat-send:hover{background:#0066d6;}',
      '.chat-send:active{background:#0055b3;}',
      '.chat-send:disabled{opacity:0.4;cursor:default;}',
      // Error
      '.error-msg{padding:20px 0;text-align:center;color:#ff3b30;font-size:14px;}',
      // Footer
      '.footer{padding:12px 20px;border-top:1px solid #f0f0f0;flex-shrink:0;display:flex;flex-direction:column;gap:8px;}',
      '.save-hint{font-size:11px;color:#86868b;text-align:center;}',
      '.save-mode-row{display:flex;align-items:center;gap:6px;}',
      '.save-mode-label{font-size:12px;color:#86868b;flex-shrink:0;}',
      '.save-mode-btn{padding:5px 12px;border:1px solid #d0d0d0;border-radius:14px;background:#fff;color:#555;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.15s;}',
      '.save-mode-btn.active{background:#007aff;color:#fff;border-color:#007aff;}',
      '.save-mode-btn:hover:not(.active){background:#f0f0f0;}',
      '.save-folder-row{display:flex;align-items:center;gap:6px;}',
      '.save-folder-label{font-size:14px;flex-shrink:0;}',
      '.save-folder-input{flex:1;padding:6px 10px;border:1px solid #d0d0d0;border-radius:8px;font-size:12px;font-family:inherit;color:#1d1d1f;background:#fff;outline:none;transition:border-color 0.15s;}',
      '.save-folder-input:focus{border-color:#007aff;box-shadow:0 0 0 2px rgba(0,122,255,0.1);}',
      '.save-folder-input::placeholder{color:#aeaeb2;}',
      '.save-actions{display:flex;gap:8px;}',
      '.save-way{flex:1;padding:8px 6px;border:none;border-radius:10px;background:#f5f5f7;color:#1d1d1f;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;justify-content:center;gap:3px;line-height:1.3;white-space:normal;}',
      '.save-way:hover{background:#e8e8ed;}',
      '.save-way:active{background:#dcdce0;}',
      '.save-way:disabled{opacity:0.5;cursor:default;}',
      '.save-way.saved{background:#e3f9e5;color:#1d7a2b;}',
      // Re-explain
      '.re-explain-row{text-align:center;padding:8px 0 0;}',
      '.re-explain-btn{padding:6px 16px;border:1px solid #d0d0d0;border-radius:14px;background:#fff;color:#555;font-size:12px;font-family:inherit;cursor:pointer;transition:all 0.15s;}',
      '.re-explain-btn:hover{background:#f5f5f7;border-color:#007aff;color:#007aff;}',
      '.re-explain-btn:disabled{opacity:0.5;cursor:default;}'
    ].join('');
  }

  // ============================================================
  //  保存选项 toggle
  // ============================================================

  // ============================================================
  //  Draggable + Resizable
  // ============================================================
  var resizeEdge = null;

  function makeDraggable(host, header) {
    var ox=0, oy=0, dragging=false;
    header.addEventListener('mousedown', function(e) {
      if (resizeEdge) return;
      dragging=true; host.style.transform='none';
      ox=e.clientX-host.offsetLeft; oy=e.clientY-host.offsetTop; e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (dragging) {
        host.style.left=clamp(e.clientX-ox,0,window.innerWidth-100)+'px';
        host.style.top=clamp(e.clientY-oy,0,window.innerHeight-60)+'px';
      }
    });
    document.addEventListener('mouseup', function() {
      dragging=false;
    });
  }

  function makeResizable(host) {
    var EDGE = 8, sx, sy, sw, sh, sl, st;

    document.addEventListener('mousemove', function(e) {
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
      // Show cursor hint near edges (only when host is connected)
      if (!host.isConnected) return;
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
    });

    document.addEventListener('mousedown', function(e) {
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
    });

    document.addEventListener('mouseup', function() {
      resizeEdge = null;
    });
  }

  function clamp(v,min,max){return Math.min(Math.max(v,min),max);}

  // ============================================================
  //  获取初始解释
  // ============================================================
  function showPopup() {
    removeToolbar();

    // Check if Obsidian is configured — determines if save button shows
    chrome.storage.sync.get(['obsidianKey', 'obsidianFolder'], function(settings) {
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

    chrome.runtime.sendMessage({ action:'explain', text:selectedText }, function(resp) {
      if (!popupShadow) return;
      loadingEl.style.display = 'none';
      if (resp && resp.success) {
        initialExplanation = resp.data;
        contentEl.innerHTML = renderMD(resp.data);
        contentEl.style.display = 'block';
        chatArea.style.display = 'block';
        root.querySelector('.re-explain-row').style.display = 'block';
      } else {
        errorEl.textContent = '获取解释失败: ' + (resp ? resp.error : '未知');
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
        '<button class="close">&times;</button>' +
      '</div>' +
      '<div class="body">' +
        '<div class="chat-messages">' +
          '<div class="welcome-msg">' +
            '<b>你好！我是AI助手惑惑</b><br>' +
            '随便问，我能答尽答～' +
          '</div>' +
        '</div>' +
        '<div class="chat-input-row">' +
          '<textarea class="chat-input-textarea" placeholder="输入你的问题... (Enter 发送)" rows="1"></textarea>' +
          '<button class="chat-send">发送</button>' +
        '</div>' +
      '</div>' +
      '<div class="footer" style="display:flex;">' +
        '<div class="save-folder-row">' +
          '<span class="save-folder-label">📁</span>' +
          '<input type="text" class="save-folder-input" placeholder="保存到哪个文件夹？">' +
        '</div>' +
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
    chrome.storage.sync.get(['obsidianKey', 'obsidianFolder'], function(settings) {
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
    });
    popupShadow.querySelectorAll('.save-way').forEach(function(btn) {
      btn.addEventListener('click', function() {
        doSaveChat(btn.dataset.way);
      });
    });

    makeDraggable(popupEl, popupShadow.querySelector('.header'));
    makeResizable(popupEl);

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

    var typingEl = addChatMsg('assistant', '...');

    chrome.runtime.sendMessage({
      action: 'generalChat',
      history: chatHistory.slice(0, -1) // exclude "..." typing indicator
    }, function(resp) {
      if (!popupShadow) return;
      if (typingEl) typingEl.remove();

      if (resp && resp.success) {
        addChatMsg('assistant', resp.data);
      } else {
        addChatMsg('assistant', '抱歉，出错了：' + (resp ? resp.error : '无响应'));
      }
      input.disabled = false; sendBtn.disabled = false;
      input.focus();
    });
  }

  // ============================================================
  //  换种方式解释
  // ============================================================
  function reExplain() {
    if (!popupShadow) return;
    var btn = popupShadow.querySelector('.re-explain-btn');
    var contentEl = popupShadow.querySelector('.content');
    btn.textContent = '🔄 正在换种方式...'; btn.disabled = true;

    chrome.runtime.sendMessage({
      action: 'reexplain',
      originalText: selectedText,
      previousExplanation: initialExplanation
    }, function(resp) {
      if (!popupShadow) return;
      btn.textContent = '🔄 换种方式解释'; btn.disabled = false;
      if (resp && resp.success) {
        initialExplanation = resp.data;
        contentEl.innerHTML = renderMD(resp.data);
        // Scroll to top of content
        popupShadow.querySelector('.body').scrollTop = contentEl.offsetTop - 20;
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

    // Show typing indicator
    var typingEl = addChatMsg('assistant', '...');

    chrome.runtime.sendMessage({
      action: 'chat',
      originalText: selectedText,
      explanation: initialExplanation,
      history: chatHistory.slice(0, -1), // exclude the one just added
      question: question
    }, function(resp) {
      if (!popupShadow) return;
      // Remove typing indicator
      if (typingEl) typingEl.remove();

      if (resp && resp.success) {
        addChatMsg('assistant', resp.data);
      } else {
        addChatMsg('assistant', '抱歉，出错了：' + (resp ? resp.error : '无响应'));
      }
      input.disabled = false; sendBtn.disabled = false;
      input.focus();
    });
  }

  function addChatMsg(role, content) {
    if (!popupShadow) return null;
    var msgs = popupShadow.querySelector('.chat-messages');
    var div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    div.textContent = content;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    chatHistory.push({ role: role, content: content });
    return div;
  }

  // ============================================================
  //  保存（三途径：Obsidian API / 下载 / 剪贴板）
  // ============================================================
  function doSave(way) {
    if (!popupShadow) return;

    var explanationText = popupShadow.querySelector('.content').textContent || '';

    var fullText = '';
    if (saveMode === 'full') {
      fullText = '## 初始解释\n\n' + explanationText + '\n\n## 追问记录\n\n';
      for (var i = 0; i < chatHistory.length; i++) {
        var m = chatHistory[i];
        fullText += m.role === 'user' ? '**🙋 追问**：' : '**🤖 回答**：';
        fullText += m.content + '\n\n';
      }
    }
    var saveContent = saveMode === 'full' ? fullText : explanationText;

    var btn = popupShadow.querySelector('.save-way[data-way="' + way + '"]');
    var origText = btn.textContent;
    btn.textContent = '...'; btn.disabled = true;

    if (way === 'obsidian') {
      var folderOverride = (popupShadow.querySelector('.save-folder-input') || {}).value || '';
      chrome.runtime.sendMessage({
        action: 'saveToObsidian',
        originalText: selectedText,
        explanation: saveContent,
        sourceUrl: window.location.href,
        folderOverride: folderOverride.trim()
      }, function(resp) {
        btn.disabled = false;
        if (resp && resp.success && resp.data) {
          if (resp.data.method === 'rest') {
            btn.textContent = '✓ 已同步'; btn.classList.add('saved');
            showToast('已保存到知识库');
          } else if (resp.data.method === 'uri') {
            openObsidianUri(resp.data.uri);
            btn.textContent = '✓ 已同步'; btn.classList.add('saved');
            showToast('已在知识库中打开');
          }
        } else {
          btn.textContent = origText;
          showToast('保存失败：' + (resp ? resp.error : '无响应'));
        }
      });
      return;
    }

    if (way === 'download') {
      try {
        var safeName = selectedText.replace(/[\\/:*?"<>|#\n\r]/g, '').trim().slice(0, 40) || '未命名';
        var blob = new Blob([saveContent], { type: 'text/markdown;charset=utf-8' });
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
      navigator.clipboard.writeText(saveContent).then(function() {
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

    // Build chat content as markdown
    var lines = ['# 框选解惑 · AI 对话记录', '', '> ' + new Date().toISOString().split('T')[0], ''];
    for (var i = 0; i < chatHistory.length; i++) {
      var m = chatHistory[i];
      lines.push(m.role === 'user' ? '**🙋 我**：' + m.content : '**🤖 惑惑**：' + m.content);
      lines.push('');
    }
    var saveContent = lines.join('\n');
    var safeName = '对话记录_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

    var btn = popupShadow.querySelector('.save-way[data-way="' + way + '"]');
    var origText = btn.textContent;
    btn.textContent = '...'; btn.disabled = true;

    if (way === 'obsidian') {
      var folderOverride = (popupShadow.querySelector('.save-folder-input') || {}).value || '';
      chrome.runtime.sendMessage({
        action: 'saveToObsidian',
        originalText: safeName,
        explanation: saveContent,
        sourceUrl: window.location.href,
        folderOverride: folderOverride.trim()
      }, function(resp) {
        btn.disabled = false;
        if (resp && resp.success && resp.data) {
          if (resp.data.method === 'rest') {
            btn.textContent = '✓ 已同步'; btn.classList.add('saved');
            showToast('已保存到知识库');
          } else if (resp.data.method === 'uri') {
            openObsidianUri(resp.data.uri);
            btn.textContent = '✓ 已同步'; btn.classList.add('saved');
            showToast('已在知识库中打开');
          }
        } else {
          btn.textContent = origText;
          showToast('保存失败');
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
      }).catch(function() {
        btn.textContent = origText;
        showToast('复制失败');
      });
      btn.disabled = false;
      return;
    }
  }

  // ============================================================
  //  朗读
  // ============================================================
  function speak() {
    if (!popupShadow) return;
    var btn = popupShadow.querySelector('.speak-btn');
    if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking=false; btn.classList.remove('speaking'); return; }
    var u = new SpeechSynthesisUtterance(selectedText);
    u.lang = detectLang(selectedText); u.rate = 0.9;
    u.onstart = function(){ isSpeaking=true; btn.classList.add('speaking'); };
    u.onend = u.onerror = function(){ isSpeaking=false; btn.classList.remove('speaking'); };
    window.speechSynthesis.speak(u);
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
  //  Markdown 渲染
  // ============================================================
  function renderMD(md) {
    var h = md
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/^###?\s(.+)$/gm,'<h3>$1</h3>')
      .replace(/\n\n/g,'</p><p>')
      .replace(/\n/g,'<br>');
    return '<p>'+h+'</p>';
  }

  function escapeHTML(s) {
    var d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  // ============================================================
  //  框选检测
  // ============================================================
  document.addEventListener('mouseup', function(e) {
    setTimeout(function() {
      if (isOurs(e.target)) return;
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
    }, 10);
  });

  var outsideClickTimer = 0;

  document.addEventListener('mousedown', function(e) {
    if (popupEl && !isOurs(e.target) && !popupEl.contains(e.target)) {
      if (outsideClickTimer) {
        // Second outside click → close
        clearTimeout(outsideClickTimer);
        outsideClickTimer = 0;
        popupEl.style.outline = '';
        removePopup();
      } else {
        // First outside click → warn
        popupEl.style.outline = '3px solid #ff3b30';
        popupEl.style.outlineOffset = '-3px';
        outsideClickTimer = setTimeout(function() {
          outsideClickTimer = 0;
          if (popupEl) popupEl.style.outline = '';
        }, 3000);
      }
      return;
    }
    if (toolbarEl && !isOurs(e.target) && !toolbarEl.contains(e.target)) removeToolbar();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key==='Escape') { removePopup(); removeToolbar(); }
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
