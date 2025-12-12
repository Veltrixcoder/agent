/**
 * Cloudflare AI Agent Worker
 * A complete agentic AI system in a single file
 * 
 * Deploy with: npx wrangler deploy
 * 
 * wrangler.toml should contain:
 * 
 * name = "ai-agent"
 * main = "worker.js"
 * compatibility_date = "2024-01-01"
 * 
 * [[durable_objects.bindings]]
 * name = "AGENT"
 * class_name = "AIAgent"
 * 
 * [[migrations]]
 * tag = "v1"
 * new_sqlite_classes = ["AIAgent"]
 * 
 * [ai]
 * binding = "AI"
 */

// ============================================================================
// AI AGENT CLASS (Durable Object)
// ============================================================================

export class AIAgent {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    this.state.blockConcurrencyWhile(async () => {
      await this.initDatabase();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.handleWebSocket(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response("AI Agent API", { status: 200 });
  }

  handleWebSocket(ws) {
    ws.accept();
    this.sessions.add(ws);

    // Send welcome message
    this.sendToClient(ws, {
      type: "connected",
      message: "Connected to AI Agent! Ask me anything.",
      timestamp: Date.now(),
    });

    ws.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data);
        await this.handleMessage(ws, data);
      } catch (error) {
        console.error("Message handling error:", error);
        this.sendToClient(ws, {
          type: "error",
          message: "Error: " + error.message,
        });
      }
    });

    ws.addEventListener("close", () => {
      this.sessions.delete(ws);
    });

    ws.addEventListener("error", (error) => {
      console.error("WebSocket error:", error);
      this.sessions.delete(ws);
    });
  }

  async handleMessage(ws, data) {
    try {
      switch (data.type) {
        case "chat":
          await this.handleChatRequest(ws, data.message);
          break;
        case "research":
          await this.handleResearch(ws, data.query);
          break;
        case "save_note":
          await this.saveNote(ws, data.note);
          break;
        case "get_notes":
          await this.getNotes(ws);
          break;
        case "get_history":
          await this.getHistory(ws);
          break;
        case "clear_history":
          await this.clearHistory(ws);
          break;
        default:
          this.sendToClient(ws, {
            type: "error",
            message: "Unknown message type",
          });
      }
    } catch (error) {
      console.error("Error in handleMessage:", error);
      this.sendToClient(ws, {
        type: "error",
        message: "Processing error: " + error.message,
      });
    }
  }

  async initDatabase() {
    try {
      await this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);

      await this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);

      await this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS research (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query TEXT NOT NULL,
          results TEXT,
          summary TEXT,
          timestamp INTEGER NOT NULL
        )
      `);
    } catch (error) {
      console.error("Database init error:", error);
    }
  }

  async handleChatRequest(ws, message) {
    this.sendToClient(ws, { type: "status", message: "🤔 Thinking..." });

    try {
      // Save user message
      await this.saveMessage("user", message);

      // Get conversation history (last 10 messages)
      const history = await this.getConversationHistory(10);

      // Call AI model
      let aiResponse;
      
      if (this.env.AI) {
        try {
          console.log("Calling Workers AI with history:", history);
          
          const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
            messages: history,
            max_tokens: 512,
          });
          
          console.log("AI Response:", response);
          aiResponse = response.response || response.result?.response || "I received your message but couldn't generate a response.";
          
        } catch (aiError) {
          console.error("AI Error:", aiError);
          aiResponse = this.getIntelligentFallback(message);
        }
      } else {
        console.log("No AI binding available, using fallback");
        aiResponse = this.getIntelligentFallback(message);
      }

      // Save AI response
      await this.saveMessage("assistant", aiResponse);

      // Send response to client
      this.sendToClient(ws, {
        type: "chat_response",
        message: aiResponse,
        timestamp: Date.now(),
      });
      
    } catch (error) {
      console.error("Chat error:", error);
      this.sendToClient(ws, {
        type: "chat_response",
        message: `I encountered an error: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }

  getIntelligentFallback(message) {
    const lowerMsg = message.toLowerCase();
    
    // Pattern matching for common queries
    if (lowerMsg.includes("principle") && lowerMsg.includes("management")) {
      return `The key principles of management include:

1. **Planning** - Setting objectives and determining the best course of action
2. **Organizing** - Arranging resources and tasks to achieve objectives
3. **Leading** - Motivating and directing people toward goals
4. **Controlling** - Monitoring performance and making corrections
5. **Decision Making** - Analyzing situations and choosing optimal solutions

Additional principles:
- Division of Work (Specialization)
- Authority and Responsibility
- Unity of Command
- Scalar Chain (Clear hierarchy)
- Equity and Fair Treatment

Note: Workers AI is not configured. Add the AI binding in wrangler.toml for dynamic responses.`;
    }
    
    if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
      return "Hello! I'm your AI agent. I can help with questions, research, and notes. Workers AI is not configured, so I'm using rule-based responses. To enable full AI capabilities, add the AI binding to your wrangler.toml file.";
    }
    
    if (lowerMsg.includes("help")) {
      return "I can help you with:\n- Answering questions (limited without Workers AI)\n- Web research (switch to Research tab)\n- Taking notes (switch to Notes tab)\n\nTo enable full AI responses, configure Workers AI in wrangler.toml";
    }
    
    // Generic fallback
    return `I received your message: "${message}"

However, Workers AI is not currently configured. To enable intelligent responses:

1. Make sure your wrangler.toml has:
   [ai]
   binding = "AI"

2. Redeploy with: npx wrangler deploy

For now, try asking about "principles of management" or use the Research/Notes features!`;
  }

  async handleResearch(ws, query) {
    this.sendToClient(ws, { type: "status", message: "🔍 Researching..." });

    try {
      const searchResults = await this.searchWeb(query);

      let summary;
      if (this.env.AI) {
        try {
          const prompt = `Provide a 2-3 sentence summary of these search results for the query "${query}":\n\n${JSON.stringify(searchResults)}`;
          const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
            messages: [{ role: "user", content: prompt }],
            max_tokens: 256,
          });
          summary = response.response || response.result?.response;
        } catch (e) {
          summary = `Found ${searchResults.length} results for "${query}". Click the links below to explore.`;
        }
      } else {
        summary = `Found ${searchResults.length} results for "${query}". Enable Workers AI for AI-powered summaries.`;
      }

      await this.state.storage.sql.exec(
        "INSERT INTO research (query, results, summary, timestamp) VALUES (?, ?, ?, ?)",
        query,
        JSON.stringify(searchResults),
        summary,
        Date.now()
      );

      this.sendToClient(ws, {
        type: "research_response",
        query,
        results: searchResults,
        summary,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Research error:", error);
      this.sendToClient(ws, {
        type: "error",
        message: `Research failed: ${error.message}`,
      });
    }
  }

  async searchWeb(query) {
    // Mock search results - replace with real API
    return [
      {
        title: `${query} - Overview`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        snippet: "Search Google for current information about this topic.",
      },
      {
        title: `${query} - Wikipedia`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
        snippet: "Comprehensive encyclopedia article with detailed information.",
      },
      {
        title: `${query} - Latest Updates`,
        url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
        snippet: "Find the most recent information and news articles.",
      },
    ];
  }

  async saveNote(ws, note) {
    await this.state.storage.sql.exec(
      "INSERT INTO notes (content, timestamp) VALUES (?, ?)",
      note,
      Date.now()
    );

    this.sendToClient(ws, {
      type: "note_saved",
      message: "✅ Note saved successfully",
    });
  }

  async getNotes(ws) {
    const result = await this.state.storage.sql.exec(
      "SELECT * FROM notes ORDER BY timestamp DESC LIMIT 50"
    );

    this.sendToClient(ws, {
      type: "notes_response",
      notes: result.rows || [],
    });
  }

  async saveMessage(role, content) {
    await this.state.storage.sql.exec(
      "INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)",
      role,
      content,
      Date.now()
    );
  }

  async getConversationHistory(limit = 20) {
    const result = await this.state.storage.sql.exec(
      `SELECT role, content FROM messages ORDER BY timestamp DESC LIMIT ?`,
      limit
    );

    const messages = (result.rows || []).reverse();
    return messages.map((row) => ({
      role: row.role,
      content: row.content,
    }));
  }

  async getHistory(ws) {
    const history = await this.getConversationHistory();
    this.sendToClient(ws, {
      type: "history_response",
      history,
    });
  }

  async clearHistory(ws) {
    await this.state.storage.sql.exec("DELETE FROM messages");
    this.sendToClient(ws, {
      type: "history_cleared",
      message: "🗑️ Conversation history cleared",
    });
  }

  sendToClient(ws, data) {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  }
}

// ============================================================================
// MAIN WORKER (Entry Point)
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_CLIENT, {
        headers: { 
          "Content-Type": "text/html",
          "Cache-Control": "no-cache"
        },
      });
    }

    if (url.pathname === "/favicon.ico") {
      return new Response("🤖", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (url.pathname === "/agent") {
      const agentId = url.searchParams.get("id") || "default";
      const id = env.AGENT.idFromName(agentId);
      const agent = env.AGENT.get(id);
      return agent.fetch(request);
    }

    if (url.pathname === "/api/test") {
      return new Response(
        JSON.stringify({
          status: "ok",
          message: "AI Agent Worker is running",
          hasAI: !!env.AI,
          timestamp: Date.now(),
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ============================================================================
// EMBEDDED HTML CLIENT
// ============================================================================

const HTML_CLIENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #fff; height: 100vh; overflow: hidden; }
    .container { display: flex; flex-direction: column; height: 100vh; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 1.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
    .header-content { max-width: 64rem; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
    .title { font-size: 1.75rem; font-weight: bold; text-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .status { display: flex; align-items: center; gap: 0.5rem; background: rgba(0,0,0,0.2); padding: 0.5rem 1rem; border-radius: 1rem; }
    .status-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; animation: pulse 2s infinite; }
    .status-dot.connected { background: #10b981; }
    .status-dot.disconnected { background: #ef4444; animation: none; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .status-text { font-size: 0.875rem; font-weight: 500; }
    .tabs { background: #1a1a1a; border-bottom: 1px solid #333; }
    .tabs-content { max-width: 64rem; margin: 0 auto; display: flex; gap: 0.25rem; padding: 0 1rem; }
    .tab { padding: 0.875rem 1.25rem; border-bottom: 3px solid transparent; color: #888; cursor: pointer; background: none; border-top: none; border-left: none; border-right: none; font-size: 1rem; transition: all 0.3s; font-weight: 500; }
    .tab:hover { color: #ddd; background: rgba(255,255,255,0.05); }
    .tab.active { border-bottom-color: #667eea; color: #fff; background: rgba(102,126,234,0.1); }
    .messages { flex: 1; overflow-y: auto; padding: 2rem 1rem; background: #0a0a0a; }
    .messages-content { max-width: 64rem; margin: 0 auto; }
    .message { display: flex; margin-bottom: 1.5rem; animation: slideIn 0.3s ease-out; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .message.user { justify-content: flex-end; }
    .message.assistant, .message.system { justify-content: flex-start; }
    .message-bubble { max-width: 48rem; padding: 1.25rem; border-radius: 1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .message.user .message-bubble { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .message.assistant .message-bubble { background: #1a1a1a; border: 1px solid #333; }
    .message.system .message-bubble { background: #2a2a2a; border: 1px solid #444; font-size: 0.9rem; }
    .message-text { white-space: pre-wrap; word-wrap: break-word; line-height: 1.6; }
    .research-result { display: block; padding: 1rem; background: #0f0f0f; border: 1px solid #333; border-radius: 0.5rem; margin-top: 0.75rem; text-decoration: none; color: inherit; transition: all 0.2s; }
    .research-result:hover { background: #1a1a1a; border-color: #667eea; transform: translateX(4px); }
    .research-title { font-size: 0.95rem; font-weight: 600; color: #667eea; margin-bottom: 0.5rem; }
    .research-snippet { font-size: 0.85rem; color: #999; line-height: 1.5; }
    .input-area { border-top: 1px solid #333; padding: 1.5rem; background: #1a1a1a; }
    .input-content { max-width: 64rem; margin: 0 auto; display: flex; gap: 0.75rem; }
    .input { flex: 1; padding: 1rem 1.25rem; background: #0a0a0a; border: 2px solid #333; border-radius: 0.75rem; color: #fff; font-size: 1rem; outline: none; transition: all 0.3s; }
    .input:focus { border-color: #667eea; box-shadow: 0 0 0 3px rgba(102,126,234,0.1); }
    .button { padding: 1rem 2rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; border: none; border-radius: 0.75rem; cursor: pointer; font-size: 1rem; font-weight: 600; transition: all 0.3s; box-shadow: 0 4px 12px rgba(102,126,234,0.3); }
    .button:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(102,126,234,0.4); }
    .button:active { transform: translateY(0); }
    .button:disabled { background: #333; cursor: not-allowed; box-shadow: none; }
    .clear-btn { padding: 0.5rem 1rem; background: #ef4444; border-radius: 0.5rem; border: none; color: white; cursor: pointer; font-size: 0.875rem; margin-left: 1rem; }
    .clear-btn:hover { background: #dc2626; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-content">
        <h1 class="title">🤖 AI Agent Assistant</h1>
        <div class="status">
          <div id="status-indicator" class="status-dot disconnected"></div>
          <span id="status-text" class="status-text">Connecting...</span>
          <button class="clear-btn" onclick="clearChat()">Clear Chat</button>
        </div>
      </div>
    </div>

    <div class="tabs">
      <div class="tabs-content">
        <button onclick="switchTab('chat')" id="tab-chat" class="tab active">💬 Chat</button>
        <button onclick="switchTab('research')" id="tab-research" class="tab">🔍 Research</button>
        <button onclick="switchTab('notes')" id="tab-notes" class="tab">📝 Notes</button>
      </div>
    </div>

    <div id="messages" class="messages">
      <div class="messages-content"></div>
    </div>

    <div class="input-area">
      <div class="input-content">
        <input
          id="input"
          type="text"
          placeholder="Ask me anything... Try 'principles of management'"
          class="input"
          onkeypress="if(event.key==='Enter') sendMessage()"
        />
        <button onclick="sendMessage()" class="button">Send</button>
      </div>
    </div>
  </div>

  <script>
    let ws;
    let currentTab = 'chat';
    let reconnectTimeout;
    const messagesContainer = document.querySelector('.messages-content');

    function connect() {
      try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(protocol + '//' + location.host + '/agent');

        ws.onopen = () => {
          console.log('✅ WebSocket connected');
          updateStatus(true);
          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('📨 Received:', data);
            handleMessage(data);
          } catch (e) {
            console.error('❌ Parse error:', e);
          }
        };

        ws.onclose = () => {
          console.log('🔌 WebSocket closed');
          updateStatus(false);
          reconnectTimeout = setTimeout(connect, 3000);
        };

        ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          updateStatus(false);
        };
      } catch (error) {
        console.error('❌ Connection failed:', error);
        updateStatus(false);
        reconnectTimeout = setTimeout(connect, 3000);
      }
    }

    function handleMessage(data) {
      switch (data.type) {
        case 'connected':
          addMessage('system', data.message);
          break;
        case 'chat_response':
          addMessage('assistant', data.message);
          break;
        case 'research_response':
          addResearchResults(data);
          break;
        case 'notes_response':
          displayNotes(data.notes);
          break;
        case 'status':
          addMessage('system', data.message);
          break;
        case 'note_saved':
          addMessage('system', data.message);
          break;
        case 'history_cleared':
          messagesContainer.innerHTML = '';
          addMessage('system', data.message);
          break;
        case 'error':
          addMessage('system', '❌ ' + data.message);
          break;
      }
    }

    function sendMessage() {
      const input = document.getElementById('input');
      const message = input.value.trim();
      if (!message) return;
      
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addMessage('system', '⚠️ Not connected. Reconnecting...');
        connect();
        return;
      }

      if (currentTab === 'chat') {
        addMessage('user', message);
        console.log('📤 Sending chat:', message);
        ws.send(JSON.stringify({ type: 'chat', message }));
      } else if (currentTab === 'research') {
        addMessage('user', '🔍 ' + message);
        ws.send(JSON.stringify({ type: 'research', query: message }));
      } else if (currentTab === 'notes') {
        ws.send(JSON.stringify({ type: 'save_note', note: message }));
      }

      input.value = '';
    }

    function clearChat() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear_history' }));
      }
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');

      if (tab === 'notes' && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_notes' }));
      }

      const input = document.getElementById('input');
      input.placeholder = tab === 'chat' ? 'Ask me anything... Try "principles of management"' :
                         tab === 'research' ? 'Enter research query...' :
                         'Write a note...';
    }

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.innerHTML = '<div class="message-bubble"><p class="message-text">' + escapeHtml(content) + '</p></div>';
      messagesContainer.appendChild(div);
      messagesContainer.parentElement.scrollTop = messagesContainer.parentElement.scrollHeight;
    }

    function addResearchResults(data) {
      const div = document.createElement('div');
      div.className = 'message assistant';
      
      let resultsHtml = data.results.map(r => 
        '<a href="' + escapeHtml(r.url) + '" target="_blank" class="research-result">' +
        '<p class="research-title">' + escapeHtml(r.title) + '</p>' +
        '<p class="research-snippet">' + escapeHtml(r.snippet) + '</p>' +
        '</a>'
      ).join('');
      
      div.innerHTML = '<div class="message-bubble">' +
        '<p style="font-weight: bold; margin-bottom: 0.75rem; font-size: 1.1rem;">🔍 Research Results</p>' +
        '<p class="message-text" style="margin-bottom: 1rem; color: #ddd;">' + escapeHtml(data.summary) + '</p>' +
        '<div>' + resultsHtml + '</div>' +
        '</div>';
      
      messagesContainer.appendChild(div);
      messagesContainer.parentElement.scrollTop = messagesContainer.parentElement.scrollHeight;
    }

    function displayNotes(notes) {
      messagesContainer.innerHTML = '';
      if (notes.length === 0) {
        addMessage('system', '📝 No notes saved yet. Write something!');
        return;
      }
      notes.forEach(note => {
        const date = new Date(note.timestamp).toLocaleString();
        addMessage('assistant', note.content + '\\n\\n📅 ' + date);
      });
    }

    function updateStatus(connected) {
      const indicator = document.getElementById('status-indicator');
      const text = document.getElementById('status-text');
      if (connected) {
        indicator.className = 'status-dot connected';
        text.textContent = 'Connected';
      } else {
        indicator.className = 'status-dot disconnected';
        text.textContent = 'Disconnected';
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    connect();
  </script>
</body>
</html>`;
