import { DurableObject } from "cloudflare:workers";

// AI Agent Durable Object with Internet Search
export class ChatAgent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      this.ctx.acceptWebSocket(server);
      
      const conversationHistory = (await this.ctx.storage.get("conversationHistory")) || [];
      
      server.send(JSON.stringify({
        type: "welcome",
        message: "Connected to AI Agent with web search! How can I help you today?"
      }));

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    // Handle clear history
    if (url.pathname === "/clear" && request.method === "POST") {
      await this.ctx.storage.put("conversationHistory", []);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  async searchWeb(query) {
    try {
      // Use Firecrawl API to search and scrape
      const response = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fc-10b48ef8488a472d9151d8545930c65e'
        },
        body: JSON.stringify({
          query: query,
          limit: 5,
          scrapeOptions: {
            formats: ['markdown'],
            onlyMainContent: true
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Firecrawl API error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Search error:', error);
      return null;
    }
  }

  detectSearchIntent(message) {
    const searchKeywords = [
      'search', 'find', 'look up', 'what is', 'who is', 'where is', 'when did',
      'latest', 'current', 'recent', 'news', 'information about', 'tell me about',
      'price of', 'weather', 'how to', 'tutorial', 'guide'
    ];
    
    const lowerMessage = message.toLowerCase();
    return searchKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      
      let history = (await this.ctx.storage.get("conversationHistory")) || [];
      
      const userMessage = {
        role: "user",
        content: data.content,
        timestamp: new Date().toISOString()
      };
      history.push(userMessage);

      // Detect if we need to search the web
      const needsSearch = this.detectSearchIntent(data.content);
      let searchContext = "";
      let searchResults = null;

      if (needsSearch) {
        ws.send(JSON.stringify({
          type: "status",
          message: "🔍 Searching the web..."
        }));

        searchResults = await this.searchWeb(data.content);
        
        if (searchResults && searchResults.data && searchResults.data.length > 0) {
          searchContext = "\n\nWeb Search Results:\n";
          searchResults.data.slice(0, 3).forEach((result, index) => {
            searchContext += `\n${index + 1}. ${result.title}\n`;
            searchContext += `URL: ${result.url}\n`;
            if (result.markdown) {
              searchContext += `Content: ${result.markdown.substring(0, 500)}...\n`;
            }
          });
          
          ws.send(JSON.stringify({
            type: "search",
            results: searchResults.data.slice(0, 3)
          }));
        }
      }

      ws.send(JSON.stringify({
        type: "status",
        message: "💭 Thinking..."
      }));
      
      const systemPrompt = needsSearch 
        ? `You are a helpful AI assistant with access to current web information. Use the provided search results to give accurate, up-to-date answers. Always cite your sources when using information from the search results. Be concise and friendly.${searchContext}`
        : "You are a helpful AI assistant. Be concise and friendly.";

      const aiMessages = [
        {
          role: "system",
          content: systemPrompt
        },
        ...history.slice(-10).map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];
      
      const aiResponse = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: aiMessages
      });
      
      const responseText = aiResponse.response || aiResponse.result?.response || "Sorry, I couldn't process that.";
      
      const assistantMessage = {
        role: "assistant",
        content: responseText,
        timestamp: new Date().toISOString(),
        hasSearch: needsSearch
      };
      history.push(assistantMessage);
      
      await this.ctx.storage.put("conversationHistory", history);
      
      ws.send(JSON.stringify({
        success: true,
        response: responseText,
        messageCount: history.length,
        searchUsed: needsSearch
      }));
      
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(JSON.stringify({
        success: false,
        error: "Failed to process message: " + error.message
      }));
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    console.log("WebSocket closed:", code, reason, wasClean);
    ws.close(1000, "Durable Object is closing WebSocket");
  }

  async webSocketError(ws, error) {
    console.error("WebSocket error:", error);
  }
}

// Enhanced HTML Frontend
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Agent with Web Search</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .chat-container {
            width: 100%;
            max-width: 1000px;
            height: 90vh;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 24px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        
        .header-left {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .chat-header h1 {
            font-size: 28px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .header-subtitle {
            font-size: 14px;
            opacity: 0.9;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .status {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
            background: rgba(255,255,255,0.15);
            padding: 8px 16px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
        }
        
        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #4ade80;
            animation: pulse 2s infinite;
        }
        
        .status-dot.disconnected {
            background: #ef4444;
            animation: none;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.1); }
        }
        
        .header-actions {
            display: flex;
            gap: 10px;
        }
        
        .clear-btn {
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 10px 20px;
            border-radius: 12px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .clear-btn:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
        }
        
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            background: #f8f9fa;
        }
        
        .messages::-webkit-scrollbar {
            width: 8px;
        }
        
        .messages::-webkit-scrollbar-track {
            background: transparent;
        }
        
        .messages::-webkit-scrollbar-thumb {
            background: #cbd5e0;
            border-radius: 4px;
        }
        
        .message {
            display: flex;
            gap: 12px;
            animation: slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .message.user {
            flex-direction: row-reverse;
        }
        
        .message-avatar {
            width: 40px;
            height: 40px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            flex-shrink: 0;
        }
        
        .message.user .message-avatar {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        
        .message.assistant .message-avatar {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        
        .message-content {
            max-width: 70%;
            padding: 16px 20px;
            border-radius: 18px;
            word-wrap: break-word;
            line-height: 1.6;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        
        .message.user .message-content {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-bottom-right-radius: 4px;
        }
        
        .message.assistant .message-content {
            background: white;
            color: #1f2937;
            border-bottom-left-radius: 4px;
        }
        
        .search-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(102, 126, 234, 0.1);
            color: #667eea;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .search-results {
            margin-top: 12px;
            padding: 12px;
            background: rgba(102, 126, 234, 0.05);
            border-radius: 12px;
            border-left: 3px solid #667eea;
        }
        
        .search-result-item {
            margin-bottom: 8px;
            font-size: 13px;
        }
        
        .search-result-item a {
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
        }
        
        .search-result-item a:hover {
            text-decoration: underline;
        }
        
        .status-message {
            text-align: center;
            padding: 12px;
            background: rgba(102, 126, 234, 0.1);
            border-radius: 12px;
            color: #667eea;
            font-size: 14px;
            font-weight: 600;
            animation: fadeIn 0.3s;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .welcome-message {
            text-align: center;
            padding: 60px 20px;
            color: #6b7280;
        }
        
        .welcome-message h2 {
            font-size: 32px;
            margin-bottom: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: 700;
        }
        
        .welcome-message p {
            font-size: 16px;
            margin-bottom: 24px;
        }
        
        .features {
            display: flex;
            gap: 16px;
            justify-content: center;
            flex-wrap: wrap;
            margin-top: 24px;
        }
        
        .feature {
            background: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 14px;
            color: #4b5563;
        }
        
        .input-area {
            padding: 24px;
            background: white;
            border-top: 1px solid #e5e7eb;
            display: flex;
            gap: 12px;
        }
        
        .input-wrapper {
            flex: 1;
            position: relative;
        }
        
        #messageInput {
            width: 100%;
            padding: 16px 20px;
            border: 2px solid #e5e7eb;
            border-radius: 16px;
            font-size: 16px;
            outline: none;
            transition: all 0.3s;
            font-family: inherit;
        }
        
        #messageInput:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
        }
        
        #sendBtn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 16px 32px;
            border-radius: 16px;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.3s;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }
        
        #sendBtn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
        }
        
        #sendBtn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .typing-indicator {
            display: none;
            padding: 16px 20px;
            background: white;
            border-radius: 18px;
            width: fit-content;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        
        .typing-indicator.active {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .typing-dots {
            display: flex;
            gap: 4px;
        }
        
        .typing-dots span {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #9ca3af;
            animation: typing 1.4s infinite;
        }
        
        .typing-dots span:nth-child(2) {
            animation-delay: 0.2s;
        }
        
        .typing-dots span:nth-child(3) {
            animation-delay: 0.4s;
        }
        
        @keyframes typing {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
            30% { transform: translateY(-10px); opacity: 1; }
        }
        
        @media (max-width: 768px) {
            .chat-header h1 {
                font-size: 20px;
            }
            
            .header-subtitle {
                font-size: 12px;
            }
            
            .message-content {
                max-width: 85%;
            }
            
            .features {
                flex-direction: column;
            }
            
            .header-actions {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="header-left">
                <h1>🤖 AI Agent</h1>
                <div class="header-subtitle">
                    <span>🔍 Powered by Web Search</span>
                    <span>•</span>
                    <span>⚡ Cloudflare AI</span>
                </div>
            </div>
            <div class="header-actions">
                <div class="status">
                    <div class="status-dot" id="statusDot"></div>
                    <span id="statusText">Connecting...</span>
                </div>
                <button class="clear-btn" onclick="clearChat()">
                    🗑️ Clear
                </button>
            </div>
        </div>
        
        <div class="messages" id="messages">
            <div class="welcome-message">
                <h2>👋 Welcome to AI Agent!</h2>
                <p>I can search the web and answer your questions with up-to-date information</p>
                <div class="features">
                    <div class="feature">
                        <span>🔍</span>
                        <span>Real-time Web Search</span>
                    </div>
                    <div class="feature">
                        <span>🧠</span>
                        <span>AI-Powered Responses</span>
                    </div>
                    <div class="feature">
                        <span>⚡</span>
                        <span>Lightning Fast</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="input-area">
            <div class="input-wrapper">
                <input type="text" id="messageInput" placeholder="Ask me anything... (I can search the web!)" onkeypress="handleKeyPress(event)">
            </div>
            <button id="sendBtn" onclick="sendMessage()">
                <span>Send</span>
                <span>✉️</span>
            </button>
        </div>
    </div>

    <script>
        let ws = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const agentId = new URLSearchParams(window.location.search).get('id') || crypto.randomUUID();
        let currentSearchResults = null;

        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}/agent?id=\${agentId}\`;
            
            console.log('Connecting to:', wsUrl);
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('WebSocket connected');
                updateStatus(true);
                reconnectAttempts = 0;
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('Received:', data);
                    
                    if (data.type === 'welcome') {
                        return;
                    }
                    
                    if (data.type === 'status') {
                        showStatusMessage(data.message);
                        return;
                    }
                    
                    if (data.type === 'search') {
                        currentSearchResults = data.results;
                        return;
                    }
                    
                    if (data.success && data.response) {
                        hideTypingIndicator();
                        hideStatusMessage();
                        addMessage('assistant', data.response, data.searchUsed, currentSearchResults);
                        currentSearchResults = null;
                    } else if (!data.success && data.error) {
                        hideTypingIndicator();
                        hideStatusMessage();
                        addMessage('assistant', '❌ Error: ' + data.error);
                    }
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
            ws.onclose = () => {
                console.log('WebSocket disconnected');
                updateStatus(false);
                
                if (reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
                    console.log(\`Reconnecting in \${delay}ms (attempt \${reconnectAttempts})\`);
                    setTimeout(connectWebSocket, delay);
                }
            };
        }

        function updateStatus(connected) {
            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');
            
            if (connected) {
                statusDot.classList.remove('disconnected');
                statusText.textContent = 'Connected';
            } else {
                statusDot.classList.add('disconnected');
                statusText.textContent = 'Disconnected';
            }
        }

        function addMessage(role, content, hasSearch = false, searchResults = null) {
            const messagesDiv = document.getElementById('messages');
            const welcomeMsg = messagesDiv.querySelector('.welcome-message');
            if (welcomeMsg) {
                welcomeMsg.remove();
            }
            
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${role}\`;
            
            let searchResultsHtml = '';
            if (hasSearch && searchResults && searchResults.length > 0) {
                searchResultsHtml = '<div class="search-results"><strong>🔍 Sources:</strong>';
                searchResults.forEach((result, index) => {
                    searchResultsHtml += \`
                        <div class="search-result-item">
                            \${index + 1}. <a href="\${result.url}" target="_blank">\${result.title}</a>
                        </div>
                    \`;
                });
                searchResultsHtml += '</div>';
            }
            
            const avatar = role === 'user' ? '👤' : '🤖';
            const badge = hasSearch ? '<div class="search-badge">🔍 Web Search Used</div>' : '';
            
            messageDiv.innerHTML = \`
                <div class="message-avatar">\${avatar}</div>
                <div class="message-content">
                    \${badge}
                    \${escapeHtml(content)}
                    \${searchResultsHtml}
                </div>
            \`;
            
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function showStatusMessage(message) {
            hideStatusMessage();
            const messagesDiv = document.getElementById('messages');
            const statusDiv = document.createElement('div');
            statusDiv.className = 'status-message';
            statusDiv.id = 'statusMessage';
            statusDiv.textContent = message;
            messagesDiv.appendChild(statusDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function hideStatusMessage() {
            const statusMsg = document.getElementById('statusMessage');
            if (statusMsg) {
                statusMsg.remove();
            }
        }

        function showTypingIndicator() {
            const messagesDiv = document.getElementById('messages');
            const indicator = document.createElement('div');
            indicator.className = 'message assistant';
            indicator.id = 'typingIndicator';
            indicator.innerHTML = \`
                <div class="message-avatar">🤖</div>
                <div class="typing-indicator active">
                    <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
            \`;
            messagesDiv.appendChild(indicator);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function hideTypingIndicator() {
            const indicator = document.getElementById('typingIndicator');
            if (indicator) {
                indicator.remove();
            }
        }

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            
            if (!message || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
            }
            
            addMessage('user', message);
            showTypingIndicator();
            
            ws.send(JSON.stringify({
                content: message
            }));
            
            input.value = '';
            input.focus();
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        }

        async function clearChat() {
            if (!confirm('Are you sure you want to clear the chat history?')) {
                return;
            }
            
            try {
                const response = await fetch(\`/agent/clear?id=\${agentId}\`, {
                    method: 'POST'
                });
                
                if (response.ok) {
                    document.getElementById('messages').innerHTML = \`
                        <div class="welcome-message">
                            <h2>👋 Welcome to AI Agent!</h2>
                            <p>I can search the web and answer your questions with up-to-date information</p>
                            <div class="features">
                                <div class="feature">
                                    <span>🔍</span>
                                    <span>Real-time Web Search</span>
                                </div>
                                <div class="feature">
                                    <span>🧠</span>
                                    <span>AI-Powered Responses</span>
                                </div>
                                <div class="feature">
                                    <span>⚡</span>
                                    <span>Lightning Fast</span>
                                </div>
                            </div>
                        </div>
                    \`;
                }
            } catch (error) {
                console.error('Error clearing chat:', error);
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML.replace(/\n/g, '<br>');
        }

        // Connect on page load
        connectWebSocket();
        
        // Focus input on load
        document.getElementById('messageInput').focus();
    </script>
</body>
</html>`;

// Main Worker entry point
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve the frontend HTML
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_PAGE, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "Cache-Control": "no-cache"
        }
      });
    }

    // Clear chat history endpoint
    if (url.pathname === "/agent/clear") {
      const agentId = url.searchParams.get("id") || crypto.randomUUID();
      const id = env.ChatAgent.idFromName(agentId);
      const stub = env.ChatAgent.get(id);
      
      return stub.fetch(new Request(`http://agent/clear`, {
        method: "POST"
      }));
    }

    // Agent WebSocket/API endpoint
    if (url.pathname === "/agent") {
      const agentId = url.searchParams.get("id") || crypto.randomUUID();
      const id = env.ChatAgent.idFromName(agentId);
      const stub = env.ChatAgent.get(id);
      
      return stub.fetch(request);
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString()
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};
