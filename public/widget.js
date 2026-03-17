/**
 * OpenClaw Web Widget
 * 可嵌入任意网页的聊天 Widget
 *
 * 使用方式：
 *   <script src="https://yourserver.com/widget.js"
 *           data-title="My Assistant"
 *           data-color="#6366f1"
 *           data-api-base="https://yourserver.com">
 *   </script>
 *
 * 可配置属性（data-*）：
 *   data-title      - 聊天窗口标题（默认 "Assistant"）
 *   data-color      - 主题色（默认 "#6366f1"）
 *   data-api-base   - 后端 API 地址（默认与 widget.js 同域）
 *   data-placeholder - 输入框占位文字
 *   data-welcome    - 欢迎语（首条消息）
 */
(function () {
  'use strict';

  // ── 读取配置 ────────────────────────────────────────────────────────────────
  const currentScript = document.currentScript;
  const apiBase = currentScript?.dataset.apiBase
    || window.location.origin;
  const themeColor = currentScript?.dataset.color || '#6366f1';
  const title = currentScript?.dataset.title || 'Assistant';
  const placeholder = currentScript?.dataset.placeholder || 'Type a message…';
  const welcomeMsg = currentScript?.dataset.welcome || 'Hi! How can I help you today?';

  // ── 防止重复初始化 ────────────────────────────────────────────────────────
  if (document.getElementById('__openclaw-widget-root')) return;

  // ── Shadow DOM 容器（样式完全隔离）────────────────────────────────────────
  const host = document.createElement('div');
  host.id = '__openclaw-widget-root';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // ── 注入样式 ───────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

    /* 浮动气泡按钮 */
    #bubble {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${themeColor};
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483646;
      transition: transform 0.2s, box-shadow 0.2s;
      outline: none;
    }
    #bubble:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.22); }
    #bubble svg { width: 26px; height: 26px; fill: #fff; }

    /* 聊天面板 */
    #panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      width: 360px;
      max-width: calc(100vw - 32px);
      height: 520px;
      max-height: calc(100vh - 120px);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 8px 40px rgba(0,0,0,0.16);
      display: flex;
      flex-direction: column;
      z-index: 2147483646;
      overflow: hidden;
      transform-origin: bottom right;
      transition: transform 0.25s cubic-bezier(.34,1.56,.64,1), opacity 0.2s;
    }
    #panel.hidden { transform: scale(0.85); opacity: 0; pointer-events: none; }

    /* 面板头部 */
    #header {
      background: ${themeColor};
      color: #fff;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #header-title { font-size: 15px; font-weight: 600; }
    #close-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.85);
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      padding: 0 4px;
      border-radius: 4px;
    }
    #close-btn:hover { color: #fff; background: rgba(255,255,255,0.15); }

    /* 任务按钮 */
    #tasks-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.85);
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 4px 6px;
      border-radius: 4px;
    }
    #tasks-btn:hover { color: #fff; background: rgba(255,255,255,0.15); }

    /* 任务面板 */
    #tasks-panel {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }
    #tasks-panel.hidden { display: none; }
    #chat-area {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }
    #chat-area.hidden { display: none; }

    /* 任务列表 */
    #tasks-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .task-item {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .task-info { flex: 1; min-width: 0; }
    .task-name { font-size: 13px; font-weight: 600; color: #0f172a; margin-bottom: 2px; }
    .task-schedule { font-size: 11px; color: #94a3b8; font-family: monospace; }
    .task-message { font-size: 12px; color: #64748b; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .task-delete {
      background: none;
      border: none;
      color: #cbd5e1;
      cursor: pointer;
      font-size: 16px;
      padding: 0 2px;
      flex-shrink: 0;
      line-height: 1;
    }
    .task-delete:hover { color: #ef4444; }
    .tasks-empty { text-align: center; color: #94a3b8; font-size: 13px; padding: 24px 0; }

    /* 新建任务表单 */
    #task-form {
      border-top: 1px solid #e2e8f0;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: #fff;
      flex-shrink: 0;
    }
    #task-form input, #task-form textarea {
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      padding: 7px 10px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      color: #1e293b;
      resize: none;
    }
    #task-form input:focus, #task-form textarea:focus { border-color: ${themeColor}; }
    #task-form textarea { min-height: 52px; }
    #task-submit {
      background: ${themeColor};
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 7px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
    }
    #task-submit:hover { opacity: 0.88; }
    #task-submit:disabled { opacity: 0.4; cursor: not-allowed; }
    .task-form-hint { font-size: 11px; color: #94a3b8; }

    /* 消息列表 */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }
    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 2px; }

    /* 消息气泡 */
    .msg {
      max-width: 82%;
      padding: 9px 13px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .msg.user {
      align-self: flex-end;
      background: ${themeColor};
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .msg.assistant {
      align-self: flex-start;
      background: #f1f5f9;
      color: #1e293b;
      border-bottom-left-radius: 4px;
    }
    .msg.error {
      align-self: center;
      background: #fef2f2;
      color: #dc2626;
      font-size: 13px;
      text-align: center;
    }

    /* 打字动画 */
    .typing { display: flex; gap: 4px; align-items: center; padding: 12px 13px; }
    .typing span {
      width: 7px; height: 7px; border-radius: 50%; background: #94a3b8;
      animation: bounce 1.2s infinite;
    }
    .typing span:nth-child(2) { animation-delay: 0.2s; }
    .typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-5px); }
    }

    /* 输入区域 */
    #input-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #e2e8f0;
      flex-shrink: 0;
      background: #fff;
    }
    #input {
      flex: 1;
      border: 1.5px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 14px;
      font-family: inherit;
      resize: none;
      min-height: 38px;
      max-height: 120px;
      outline: none;
      transition: border-color 0.15s;
      line-height: 1.45;
      color: #1e293b;
    }
    #input:focus { border-color: ${themeColor}; }
    #input::placeholder { color: #94a3b8; }
    #send-btn {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: ${themeColor};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.15s, transform 0.1s;
    }
    #send-btn:hover:not(:disabled) { opacity: 0.88; transform: scale(1.05); }
    #send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    #send-btn svg { width: 18px; height: 18px; fill: #fff; }
  `;
  shadow.appendChild(style);

  // ── DOM 构建 ────────────────────────────────────────────────────────────────
  // 注意：动态值（title、placeholder）通过 setAttribute/textContent 设置，
  // 避免直接拼入 innerHTML 导致 XSS。
  shadow.innerHTML += `
    <button id="bubble" title="Open chat" aria-label="Open assistant chat">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
    </button>
    <div id="panel" class="hidden" role="dialog">
      <div id="header">
        <span id="header-title"></span>
        <div style="display:flex;gap:2px">
          <button id="tasks-btn" aria-label="Scheduled tasks" title="Scheduled tasks">⏰</button>
          <button id="close-btn" aria-label="Close chat">×</button>
        </div>
      </div>
      <div id="chat-area">
        <div id="messages" role="log" aria-live="polite"></div>
        <div id="input-row">
          <textarea id="input" rows="1" aria-label="Message input"></textarea>
          <button id="send-btn" aria-label="Send message">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
      <div id="tasks-panel" class="hidden">
        <div id="tasks-list"></div>
        <div id="task-form">
          <input id="task-name" type="text" placeholder="Task name" maxlength="100" />
          <input id="task-schedule" type="text" placeholder="Cron expression (e.g. 0 9 * * *)" maxlength="50" />
          <span class="task-form-hint">minute hour day month weekday</span>
          <textarea id="task-message" placeholder="Message to send to agent" maxlength="500"></textarea>
          <button id="task-submit">Add Task</button>
        </div>
      </div>
    </div>
  `;

  // 动态值通过 DOM API 安全设置
  shadow.getElementById('panel').setAttribute('aria-label', title);
  shadow.getElementById('header-title').textContent = title;
  shadow.getElementById('input').setAttribute('placeholder', placeholder);

  // ── 获取 DOM 元素 ──────────────────────────────────────────────────────────
  const bubble = shadow.getElementById('bubble');
  const panel = shadow.getElementById('panel');
  const closeBtn = shadow.getElementById('close-btn');
  const messagesEl = shadow.getElementById('messages');
  const input = shadow.getElementById('input');
  const sendBtn = shadow.getElementById('send-btn');
  const tasksBtn = shadow.getElementById('tasks-btn');
  const chatArea = shadow.getElementById('chat-area');
  const tasksPanel = shadow.getElementById('tasks-panel');
  const tasksList = shadow.getElementById('tasks-list');
  const taskName = shadow.getElementById('task-name');
  const taskSchedule = shadow.getElementById('task-schedule');
  const taskMessage = shadow.getElementById('task-message');
  const taskSubmit = shadow.getElementById('task-submit');

  // ── 状态 ────────────────────────────────────────────────────────────────────
  let isOpen = false;
  let isSending = false;
  let isInitialized = false;
  let showingTasks = false;

  // ── 面板开关 ────────────────────────────────────────────────────────────────
  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('hidden', !isOpen);
    if (isOpen) {
      if (!isInitialized) init();
      setTimeout(() => input.focus(), 50);
    }
  }

  bubble.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', togglePanel);
  tasksBtn.addEventListener('click', toggleTasks);

  // ── 任务面板切换 ────────────────────────────────────────────────────────────
  function toggleTasks() {
    showingTasks = !showingTasks;
    chatArea.classList.toggle('hidden', showingTasks);
    tasksPanel.classList.toggle('hidden', !showingTasks);
    tasksBtn.style.background = showingTasks ? 'rgba(255,255,255,0.2)' : '';
    if (showingTasks) loadTasks();
  }

  // ── 加载并渲染任务列表 ─────────────────────────────────────────────────────
  async function loadTasks() {
    try {
      const res = await fetch(`${apiBase}/api/tasks`, { credentials: 'include' });
      if (!res.ok) return;
      const { tasks } = await res.json();
      renderTasks(tasks);
    } catch { /* ignore */ }
  }

  function renderTasks(tasks) {
    tasksList.innerHTML = '';
    if (tasks.length === 0) {
      tasksList.innerHTML = '<div class="tasks-empty">No scheduled tasks yet</div>';
      return;
    }
    for (const task of tasks) {
      const el = document.createElement('div');
      el.className = 'task-item';
      el.innerHTML = `
        <div class="task-info">
          <div class="task-name"></div>
          <div class="task-schedule"></div>
          <div class="task-message"></div>
        </div>
        <button class="task-delete" aria-label="Delete task">×</button>
      `;
      el.querySelector('.task-name').textContent = task.name;
      el.querySelector('.task-schedule').textContent = task.schedule;
      el.querySelector('.task-message').textContent = task.message;
      el.querySelector('.task-delete').addEventListener('click', () => deleteTask(task.id));
      tasksList.appendChild(el);
    }
  }

  async function deleteTask(taskId) {
    try {
      const res = await fetch(`${apiBase}/api/tasks/${taskId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) loadTasks();
    } catch { /* ignore */ }
  }

  // ── 创建任务 ────────────────────────────────────────────────────────────────
  taskSubmit.addEventListener('click', async () => {
    const name = taskName.value.trim();
    const schedule = taskSchedule.value.trim();
    const message = taskMessage.value.trim();

    if (!name || !schedule || !message) return;

    taskSubmit.disabled = true;
    try {
      const res = await fetch(`${apiBase}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, schedule, message }),
      });
      if (res.ok) {
        taskName.value = '';
        taskSchedule.value = '';
        taskMessage.value = '';
        loadTasks();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to create task');
      }
    } catch { /* ignore */ } finally {
      taskSubmit.disabled = false;
    }
  });

  // ── 初始化：调用 /api/session 建立 cookie ─────────────────────────────────
  async function init() {
    isInitialized = true;
    try {
      await fetch(`${apiBase}/api/session`, { credentials: 'include' });
      // 展示欢迎语
      appendMessage('assistant', welcomeMsg);
    } catch {
      appendMessage('error', 'Unable to connect to assistant. Please refresh the page.');
    }
  }

  // ── 追加消息气泡 ────────────────────────────────────────────────────────────
  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  // ── 追加打字指示器 ─────────────────────────────────────────────────────────
  function appendTyping() {
    const div = document.createElement('div');
    div.className = 'msg assistant typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  // ── 滚动到底部 ─────────────────────────────────────────────────────────────
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── 自动调整输入框高度 ─────────────────────────────────────────────────────
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // ── 发送：Enter（不含 Shift）发送，Shift+Enter 换行 ──────────────────────
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // ── 核心：发送消息并处理 SSE 流 ────────────────────────────────────────────
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isSending) return;

    isSending = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    // 显示用户消息
    appendMessage('user', text);

    // 显示打字指示器
    const typingEl = appendTyping();

    // 创建 assistant 气泡（稍后替换打字动画）
    let assistantBubble = null;
    let fullText = '';

    try {
      const response = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        typingEl.remove();
        const data = await response.json().catch(() => ({}));

        if (response.status === 429) {
          appendMessage('error', '⏳ Too many messages. Please wait a moment.');
        } else if (response.status === 401) {
          appendMessage('error', '🔄 Session expired. Please refresh the page.');
        } else {
          appendMessage('error', data.error || 'Something went wrong. Please try again.');
        }
        return;
      }

      // ── 解析 SSE 流 ────────────────────────────────────────────────────────
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 按 SSE 帧边界（\n\n）分割并处理
        const frames = buffer.split('\n\n');
        buffer = frames.pop(); // 最后一段可能是不完整帧，留到下次

        for (const frame of frames) {
          processSSEFrame(frame);
        }
      }

      // 处理剩余 buffer
      if (buffer.trim()) processSSEFrame(buffer);

    } catch (err) {
      typingEl.remove();
      if (assistantBubble) assistantBubble.remove();
      appendMessage('error', '🔌 Connection lost. Please check your network and try again.');
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      input.focus();
    }

    /**
     * 处理单个 SSE 帧
     * 支持 OpenAI-compatible delta 格式 和 OpenResponses 格式
     */
    function processSSEFrame(frame) {
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: error')) continue;

        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();

          if (dataStr === '[DONE]') {
            // 流结束
            if (typingEl.parentNode) typingEl.remove();
            return;
          }

          try {
            const data = JSON.parse(dataStr);

            // 处理 error 事件
            if (data.error) {
              if (typingEl.parentNode) typingEl.remove();
              appendMessage('error', data.error);
              return;
            }

            // 提取文本 delta（兼容多种格式）
            let delta = '';

            // OpenAI chat completions 格式
            if (data.choices?.[0]?.delta?.content) {
              delta = data.choices[0].delta.content;
            }
            // OpenResponses 格式
            else if (data.delta?.text) {
              delta = data.delta.text;
            }
            // 纯文本
            else if (typeof data.text === 'string') {
              delta = data.text;
            }

            if (delta) {
              // 第一个 delta：替换打字动画为真实气泡
              if (typingEl.parentNode) {
                assistantBubble = document.createElement('div');
                assistantBubble.className = 'msg assistant';
                typingEl.replaceWith(assistantBubble);
              }

              fullText += delta;
              assistantBubble.textContent = fullText;
              scrollToBottom();
            }
          } catch {
            // 忽略无法解析的帧
          }
        }
      }
    }
  }
})();
