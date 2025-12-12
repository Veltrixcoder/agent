import { DurableObject } from "cloudflare:workers";

// AI Agent Durable Object
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
      
      // Accept the WebSocket connection
      this.ctx.acceptWebSocket(server);
      
      // Initialize state
      const conversationHistory = (await this.ctx.storage.get("conversationHistory")) || [];
      
      // Send welcome message
      server.send(JSON.stringify({
        type: "welcome",
        message: "Connected to AI Agent! How can I help you today?"
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

  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      
      // Get conversation history
      let history = (await this.ctx.storage.get("conversationHistory")) || [];
      
      // Add user message
      const userMessage = {
        role: "user",
        content: data.content,
        timestamp: new Date().toISOString()
      };
      history.push(userMessage);
      
      // Prepare messages for AI (keep last 10 messages for context)
      const aiMessages = [
        {
          role: "system",
          content: "You are a helpful AI assistant. Be concise and friendly."
        },
        ...history.slice(-10).map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];
      
      // Call Cloudflare AI
      const aiResponse = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: aiMessages
      });
      
      // Extract response text
      const responseText = aiResponse.response || aiResponse.result?.response || "Sorry, I couldn't process that.";
      
      // Add assistant message to history
      const assistantMessage = {
        role: "assistant",
        content: responseText,
        timestamp: new Date().toISOString()
      };
      history.push(assistantMessage);
      
      // Save updated history
      await this.ctx.storage.put("conversationHistory", history);
      
      // Send response back
      ws.send(JSON.stringify({
        success: true,
        response: responseText,
        messageCount: history.length
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

// HTML Frontend
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Agent Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .chat-container {
            width: 90%;
            max-width: 800px;
            height: 90vh;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .chat-header h1 {
            font-size: 24px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .status {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
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
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .clear-btn {
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s;
        }
        .clear-btn:hover {
            background: rgba(255,255,255,0.3);
        }
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .message {
            display: flex;
            gap: 10px;
            animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        .message.user {
            flex-direction: row-reverse;
        }
        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            word-wrap: break-word;
        }
        .message.user .message-content {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-bottom-right-radius: 4px;
        }
        .message.assistant .message-content {
            background: #f3f4f6;
            color: #1f2937;
            border-bottom-left-radius: 4px;
        }
        .welcome-message {
            text-align: center;
            padding: 40px 20px;
            color: #6b7280;
        }
        .welcome-message h2 {
            font-size: 28px;
            margin-bottom: 10px;
            color: #667eea;
        }
        .input-area {
            padding: 20px;
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            display: flex;
            gap: 10px;
        }
        #messageInput {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #e5e7eb;
            border-radius: 12px;
            font-size: 16px;
            outline: none;
            transition: border-color 0.3s;
        }
        #messageInput:focus {
            border-color: #667eea;
        }
        #sendBtn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 12px;
            font-size: 16px;
            cursor: pointer;
            transition: transform 0.2s;
            font-weight: 600;
        }
        #sendBtn:hover:not(:disabled) {
            transform: scale(1.05);
        }
        #sendBtn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .typing-indicator {
            display: none;
            padding: 12px 16px;
            background: #f3f4f6;
            border-radius: 18px;
            width: fit-content;
        }
        .typing-indicator.active {
            display: block;
        }
        .typing-indicator span {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #9ca3af;
            margin: 0 2px;
            animation: typing 1.4s infinite;
        }
        .typing-indicator span:nth-child(2) {
            animation-delay: 0.2s;
        }
        .typing-indicator span:nth-child(3) {
            animation-delay: 0.4s;
        }
        @keyframes typing {
            0%, 60%, 100% { transform: translateY(0); }
            30% { transform: translateY(-10px); }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h1>🤖 AI Agent Chat</h1>
            <div style="display: flex; align-items: center; gap: 15px;">
                <div class="status">
                    <div class="status-dot" id="statusDot"></div>
                    <span id="statusText">Connecting...</span>
                </div>
                <button class="clear-btn" onclick="clearChat()">Clear Chat</button>
            </div>
        </div>
        
        <div class="messages" id="messages">
            <div class="welcome-message">
                <h2>👋 Welcome!</h2>
                <p>Start chatting with your AI agent powered by Cloudflare</p>
            </div>
        </div>
        
        <div class="input-area">
            <input type="text" id="messageInput" placeholder="Type your message..." onkeypress="handleKeyPress(event)">
            <button id="sendBtn" onclick="sendMessage()">Send ✉️</button>
        </div>
    </div>

    <script>
        let ws = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        const agentId = new URLSearchParams(window.location.search).get('id') || crypto.randomUUID();

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
                        // Don't display welcome message as a chat message
                        return;
                    }
                    
                    if (data.success && data.response) {
                        hideTypingIndicator();
                        addMessage('assistant', data.response);
                    } else if (!data.success && data.error) {
                        hideTypingIndicator();
                        addMessage('assistant', 'Error: ' + data.error);
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
                
                // Attempt to reconnect
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

        function addMessage(role, content) {
            const messagesDiv = document.getElementById('messages');
            const welcomeMsg = messagesDiv.querySelector('.welcome-message');
            if (welcomeMsg) {
                welcomeMsg.remove();
            }
            
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${role}\`;
            messageDiv.innerHTML = \`
                <div class="message-content">\${escapeHtml(content)}</div>
            \`;
            
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function showTypingIndicator() {
            const messagesDiv = document.getElementById('messages');
            const indicator = document.createElement('div');
            indicator.className = 'typing-indicator active';
            indicator.id = 'typingIndicator';
            indicator.innerHTML = '<span></span><span></span><span></span>';
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
                            <h2>👋 Welcome!</h2>
                            <p>Start chatting with your AI agent powered by Cloudflare</p>
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
            return div.innerHTML;
        }

        // Connect on page load
        connectWebSocket();
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
      
      // Pass through the request to the Durable Object
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

    // 404
    return new Response("Not Found", { status: 404 });
  }
};
