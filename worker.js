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

    // Handle HTTP API
    if (url.pathname === "/api/chat" && request.method === "POST") {
      const { message } = await request.json();
      const response = await this.handleChat(message);
      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
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
      message: "Connected to AI Agent",
      timestamp: Date.now(),
    });

    ws.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data);
        await this.handleMessage(ws, data);
      } catch (error) {
        this.sendToClient(ws, {
          type: "error",
          message: "Invalid message format: " + error.message,
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
      this.sendToClient(ws, {
        type: "error",
        message: "Error processing message: " + error.message,
      });
    }
  }

  async initDatabase() {
    try {
      // Create tables if they don't exist
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
    this.sendToClient(ws, { type: "status", message: "Thinking..." });

    // Save user message
    await this.saveMessage("user", message);

    // Get conversation history
    const history = await this.getConversationHistory();

    // Call AI model
    let aiResponse;
    try {
      if (this.env.AI) {
        // Use Cloudflare Workers AI
        const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: history,
        });
        aiResponse = response.response;
      } else {
        // Fallback response
        aiResponse = this.generateFallbackResponse(message);
      }
    } catch (error) {
      aiResponse = `I encountered an error: ${error.message}. Please try again.`;
    }

    // Save AI response
    await this.saveMessage("assistant", aiResponse);

    // Send response to client
    this.sendToClient(ws, {
      type: "chat_response",
      message: aiResponse,
      timestamp: Date.now(),
    });
  }

  async handleResearch(ws, query) {
    this.sendToClient(ws, { type: "status", message: "Researching..." });

    try {
      // Perform web search (mock implementation - integrate with real API)
      const searchResults = await this.searchWeb(query);

      // Generate summary with AI
      let summary;
      if (this.env.AI) {
        const prompt = `Based on these search results, provide a concise summary for the query "${query}":\n\n${JSON.stringify(searchResults, null, 2)}`;
        const response = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [{ role: "user", content: prompt }],
        });
        summary = response.response;
      } else {
        summary = `Found ${searchResults.length} results for: ${query}`;
      }

      // Save research to database
      await this.state.storage.sql.exec(
        "INSERT INTO research (query, results, summary, timestamp) VALUES (?, ?, ?, ?)",
        query,
        JSON.stringify(searchResults),
        summary,
        Date.now()
      );

      // Send results
      this.sendToClient(ws, {
        type: "research_response",
        query,
        results: searchResults,
        summary,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.sendToClient(ws, {
        type: "error",
        message: `Research failed: ${error.message}`,
      });
    }
  }

  async searchWeb(query) {
    // Mock implementation - replace with actual search API
    // Options: Brave Search API, Google Custom Search, SerpAPI, etc.
    return [
      {
        title: `Result 1 for ${query}`,
        url: "https://example.com/1",
        snippet: "This is a sample search result. Integrate with a real search API for actual results.",
      },
      {
        title: `Result 2 for ${query}`,
        url: "https://example.com/2",
        snippet: "Another sample result showing what the structure looks like.",
      },
      {
        title: `Result 3 for ${query}`,
        url: "https://example.com/3",
        snippet: "Add your API key and endpoint to get real search results.",
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
      message: "Note saved successfully",
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

  async getConversationHistory() {
    const result = await this.state.storage.sql.exec(
      "SELECT role, content FROM messages ORDER BY timestamp DESC LIMIT 20"
    );

    // Reverse to get chronological order
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
      message: "Conversation history cleared",
    });
  }

  generateFallbackResponse(message) {
    const responses = [
      "That's an interesting question. To enable AI responses, configure Workers AI in your wrangler.toml.",
      "I'm currently running in fallback mode. Add the AI binding to access Cloudflare's AI models.",
      "I understand you're asking about that. For intelligent responses, enable Workers AI integration.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  sendToClient(ws, data) {
    try {
      if (ws.readyState === 1) { // OPEN
        ws.send(JSON.stringify(data));
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.sessions.forEach((ws) => {
      try {
        if (ws.readyState === 1) {
          ws.send(message);
        }
      } catch (error) {
        console.error("Failed to broadcast:", error);
      }
    });
  }
}

// ============================================================================
// MAIN WORKER (Entry Point)
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve HTML client for root path
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_CLIENT, {
        headers: { 
          "Content-Type": "text/html",
          "Cache-Control": "no-cache"
        },
      });
    }

    // Handle favicon
    if (url.pathname === "/favicon.ico") {
      return new Response("🤖", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Handle agent requests
    if (url.pathname === "/agent") {
      // Get or create agent instance
      const agentId = url.searchParams.get("id") || "default";
      const id = env.AGENT.idFromName(agentId);
      const agent = env.AGENT.get(id);
      return agent.fetch(request);
    }

    // API endpoint for quick testing
    if (url.pathname === "/api/test") {
      return new Response(
        JSON.stringify({
          status: "ok",
          message: "AI Agent Worker is running",
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
// EMBEDDED HTML CLIENT (with inline CSS)
// ============================================================================

const HTML_CLIENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #111827; color: #fff; height: 100vh; overflow: hidden; }
    .container { display: flex; flex-direction: column; height: 100vh; }
    .header { background: #1f2937; border-bottom: 1px solid #374151; padding: 1rem; }
    .header-content { max-width: 64rem; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
    .title { font-size: 1.5rem; font-weight: bold; }
    .status { display: flex; align-items: center; gap: 0.5rem; }
    .status-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; }
    .status-dot.connected { background: #10b981; }
    .status-dot.disconnected { background: #ef4444; }
    .status-text { font-size: 0.875rem; color: #9ca3af; }
    .tabs { background: #1f2937; border-bottom: 1px solid #374151; }
    .tabs-content { max-width: 64rem; margin: 0 auto; display: flex; gap: 0.25rem; padding: 0 1rem; }
    .tab { padding: 0.75rem 1rem; border-bottom: 2px solid transparent; color: #9ca3af; cursor: pointer; background: none; border-top: none; border-left: none; border-right: none; font-size: 1rem; transition: all 0.2s; }
    .tab:hover { color: #d1d5db; }
    .tab.active { border-bottom-color: #3b82f6; color: #60a5fa; }
    .messages { flex: 1; overflow-y: auto; padding: 1rem; }
    .messages-content { max-width: 64rem; margin: 0 auto; }
    .message { display: flex; margin-bottom: 1rem; }
    .message.user { justify-content: flex-end; }
    .message.assistant, .message.system { justify-content: flex-start; }
    .message-bubble { max-width: 48rem; padding: 1rem; border-radius: 0.5rem; }
    .message.user .message-bubble { background: #2563eb; }
    .message.assistant .message-bubble { background: #1f2937; }
    .message.system .message-bubble { background: #374151; }
    .message-text { white-space: pre-wrap; word-wrap: break-word; }
    .research-result { display: block; padding: 0.75rem; background: #0f172a; border-radius: 0.375rem; margin-top: 0.5rem; text-decoration: none; color: inherit; transition: background 0.2s; }
    .research-result:hover { background: #1e293b; }
    .research-title { font-size: 0.875rem; font-weight: 500; color: #60a5fa; margin-bottom: 0.25rem; }
    .research-snippet { font-size: 0.75rem; color: #9ca3af; }
    .input-area { border-top: 1px solid #374151; padding: 1rem; background: #1f2937; }
    .input-content { max-width: 64rem; margin: 0 auto; display: flex; gap: 0.5rem; }
    .input { flex: 1; padding: 0.75rem 1rem; background: #111827; border: 1px solid #374151; border-radius: 0.5rem; color: #fff; font-size: 1rem; outline: none; }
    .input:focus { border-color: #3b82f6; }
    .button { padding: 0.75rem 1.5rem; background: #2563eb; color: #fff; border: none; border-radius: 0.5rem; cursor: pointer; font-size: 1rem; font-weight: 500; transition: background 0.2s; }
    .button:hover { background: #1d4ed8; }
    .button:disabled { background: #374151; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-content">
        <h1 class="title">🤖 AI Agent</h1>
        <div class="status">
          <div id="status-indicator" class="status-dot disconnected"></div>
          <span id="status-text" class="status-text">Connecting...</span>
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
          placeholder="Type a message..."
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
          console.log('WebSocket connected');
          updateStatus(true);
          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            handleMessage(data);
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        };

        ws.onclose = () => {
          console.log('WebSocket closed');
          updateStatus(false);
          reconnectTimeout = setTimeout(connect, 3000);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          updateStatus(false);
        };
      } catch (error) {
        console.error('Failed to connect:', error);
        updateStatus(false);
        reconnectTimeout = setTimeout(connect, 3000);
      }
    }

    function handleMessage(data) {
      console.log('Received:', data);
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
          addMessage('system', 'Note saved successfully');
          break;
        case 'error':
          addMessage('system', 'Error: ' + data.message);
          break;
      }
    }

    function sendMessage() {
      const input = document.getElementById('input');
      const message = input.value.trim();
      if (!message || !ws || ws.readyState !== WebSocket.OPEN) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          addMessage('system', 'Not connected. Reconnecting...');
          connect();
        }
        return;
      }

      if (currentTab === 'chat') {
        addMessage('user', message);
        ws.send(JSON.stringify({ type: 'chat', message }));
      } else if (currentTab === 'research') {
        addMessage('user', '🔍 ' + message);
        ws.send(JSON.stringify({ type: 'research', query: message }));
      } else if (currentTab === 'notes') {
        ws.send(JSON.stringify({ type: 'save_note', note: message }));
      }

      input.value = '';
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(btn => {
        btn.classList.remove('active');
      });
      document.getElementById('tab-' + tab).classList.add('active');

      if (tab === 'notes' && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_notes' }));
      }

      const input = document.getElementById('input');
      input.placeholder = tab === 'chat' ? 'Ask me anything...' :
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
        '<p style="font-weight: bold; margin-bottom: 0.5rem;">Research Results:</p>' +
        '<p class="message-text" style="margin-bottom: 0.75rem; color: #d1d5db;">' + escapeHtml(data.summary) + '</p>' +
        '<div>' + resultsHtml + '</div>' +
        '</div>';
      
      messagesContainer.appendChild(div);
      messagesContainer.parentElement.scrollTop = messagesContainer.parentElement.scrollHeight;
    }

    function displayNotes(notes) {
      messagesContainer.innerHTML = '';
      if (notes.length === 0) {
        addMessage('system', 'No notes saved yet');
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

    // Start connection
    connect();
  </script>
</body>
</html>`;
