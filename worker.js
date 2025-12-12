import { Agent } from "agents";

// Define your AI Agent
export class ChatAgent extends Agent {
  // Called when a WebSocket connects
  async onConnect(connection, ctx) {
    console.log("Client connected:", connection.id);
    
    // Initialize state if it doesn't exist
    const state = await this.getState();
    if (!state.conversationHistory) {
      await this.setState({
        conversationHistory: [],
        createdAt: new Date().toISOString()
      });
    }
    
    // Send welcome message
    connection.send(JSON.stringify({
      type: "welcome",
      message: "Connected to AI Agent! How can I help you today?"
    }));
  }

  // Called when a message is received via WebSocket
  async onMessage(connection, message) {
    try {
      const data = JSON.parse(message);
      const response = await this.handleMessage(data.content);
      connection.send(JSON.stringify(response));
    } catch (error) {
      console.error("Message handling error:", error);
      connection.send(JSON.stringify({
        success: false,
        error: "Failed to process message"
      }));
    }
  }

  // Called when a WebSocket disconnects
  async onClose(connection, code, reason) {
    console.log("Client disconnected:", connection.id, code, reason);
  }

  // Called on HTTP requests
  async onRequest(request) {
    const url = new URL(request.url);
    
    // Handle HTTP POST for messages (fallback)
    if (url.pathname === "/message" && request.method === "POST") {
      const body = await request.json();
      const response = await this.handleMessage(body.content);
      return new Response(JSON.stringify(response), {
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
    
    // Handle clear history
    if (url.pathname === "/clear" && request.method === "POST") {
      await this.setState({
        conversationHistory: [],
        lastInteraction: new Date().toISOString()
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
    
    return new Response(JSON.stringify({ error: "Not Found" }), { 
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  
  // Handle message processing
  async handleMessage(content) {
    try {
      const state = await this.getState();
      const history = state.conversationHistory || [];
      
      history.push({
        role: "user",
        content: content,
        timestamp: new Date().toISOString()
      });

      const aiResponse = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          {
            role: "system",
            content: "You are a helpful AI assistant. Be concise and friendly."
          },
          ...history.slice(-10)
        ]
      });

      const assistantMessage = {
        role: "assistant",
        content: aiResponse.response,
        timestamp: new Date().toISOString()
      };

      history.push(assistantMessage);

      await this.setState({
        conversationHistory: history,
        lastInteraction: new Date().toISOString()
      });

      return {
        success: true,
        response: aiResponse.response,
        messageCount: history.length
      };

    } catch (error) {
      console.error("Error processing message:", error);
      return {
        success: false,
        error: "Failed to process your message. Please try again."
      };
    }
  }
}

// HTML Frontend
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare AI Agent Chat</title>
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
      padding: 20px;
    }
    
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      width: 100%;
      max-width: 800px;
      height: 90vh;
      max-height: 700px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .header h1 {
      font-size: 24px;
      font-weight: 600;
    }
    
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
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
    
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 30px;
      background: #f8f9fa;
    }
    
    .message {
      margin-bottom: 20px;
      display: flex;
      gap: 12px;
      animation: slideIn 0.3s ease;
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
    
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }
    
    .message.user .avatar {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    
    .message.assistant .avatar {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }
    
    .bubble {
      max-width: 70%;
      padding: 15px 20px;
      border-radius: 18px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    
    .message.user .bubble {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-bottom-right-radius: 4px;
    }
    
    .message.assistant .bubble {
      background: white;
      color: #333;
      border-bottom-left-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .typing {
      display: flex;
      gap: 4px;
      padding: 15px 20px;
    }
    
    .typing span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #999;
      animation: typing 1.4s infinite;
    }
    
    .typing span:nth-child(2) { animation-delay: 0.2s; }
    .typing span:nth-child(3) { animation-delay: 0.4s; }
    
    @keyframes typing {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-10px); }
    }
    
    .input-area {
      padding: 20px 30px;
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
      padding: 15px 20px;
      border: 2px solid #e5e7eb;
      border-radius: 25px;
      font-size: 15px;
      outline: none;
      transition: border-color 0.3s;
    }
    
    #messageInput:focus {
      border-color: #667eea;
    }
    
    button {
      padding: 15px 30px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 25px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
    }
    
    button:active {
      transform: translateY(0);
    }
    
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    
    .clear-btn {
      padding: 10px 20px;
      background: #ef4444;
      font-size: 13px;
    }
    
    .empty-state {
      text-align: center;
      color: #999;
      padding: 60px 20px;
    }
    
    .empty-state h2 {
      font-size: 28px;
      margin-bottom: 10px;
      color: #667eea;
    }
    
    .empty-state p {
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 AI Agent Chat</h1>
      <div>
        <div class="status">
          <span class="status-dot" id="statusDot"></span>
          <span id="statusText">Connecting...</span>
        </div>
        <button class="clear-btn" onclick="clearChat()">Clear Chat</button>
      </div>
    </div>
    
    <div class="messages" id="messages">
      <div class="empty-state">
        <h2>👋 Welcome!</h2>
        <p>Start chatting with your AI agent powered by Cloudflare</p>
      </div>
    </div>
    
    <div class="input-area">
      <div class="input-wrapper">
        <input 
          type="text" 
          id="messageInput" 
          placeholder="Type your message..."
          autocomplete="off"
        />
      </div>
      <button onclick="sendMessage()" id="sendBtn">Send</button>
    </div>
  </div>

  <script>
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');
    
    let agentId = localStorage.getItem('agentId') || crypto.randomUUID();
    localStorage.setItem('agentId', agentId);
    
    let ws = null;
    let isConnecting = false;
    
    function updateStatus(status) {
      statusText.textContent = status;
      if (status === 'Connected') {
        statusDot.classList.remove('disconnected');
      } else {
        statusDot.classList.add('disconnected');
      }
    }
    
    function connectWebSocket() {
      if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
      
      isConnecting = true;
      updateStatus('Connecting...');
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = protocol + '//' + window.location.host + '/agent?id=' + agentId;
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        isConnecting = false;
        updateStatus('Connected');
        console.log('WebSocket connected');
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'welcome') {
            console.log('Welcome message:', data.message);
          } else if (data.response) {
            removeTypingIndicator();
            addMessage(data.response, 'assistant');
          }
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('Error - Using HTTP');
      };
      
      ws.onclose = () => {
        isConnecting = false;
        updateStatus('Disconnected - Using HTTP');
        console.log('WebSocket disconnected');
        // Try to reconnect after 3 seconds
        setTimeout(() => {
          if (!ws || ws.readyState === WebSocket.CLOSED) {
            connectWebSocket();
          }
        }, 3000);
      };
    }
    
    function addMessage(text, type) {
      const emptyState = messagesDiv.querySelector('.empty-state');
      if (emptyState) emptyState.remove();
      
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message ' + type;
      
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = type === 'user' ? '👤' : '🤖';
      
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      
      messageDiv.appendChild(avatar);
      messageDiv.appendChild(bubble);
      messagesDiv.appendChild(messageDiv);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
    function addTypingIndicator() {
      const typingDiv = document.createElement('div');
      typingDiv.className = 'message assistant';
      typingDiv.id = 'typing-indicator';
      
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = '🤖';
      
      const bubble = document.createElement('div');
      bubble.className = 'bubble typing';
      bubble.innerHTML = '<span></span><span></span><span></span>';
      
      typingDiv.appendChild(avatar);
      typingDiv.appendChild(bubble);
      messagesDiv.appendChild(typingDiv);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
    function removeTypingIndicator() {
      const typing = document.getElementById('typing-indicator');
      if (typing) typing.remove();
    }
    
    async function sendMessage() {
      const message = messageInput.value.trim();
      if (!message) return;
      
      addMessage(message, 'user');
      messageInput.value = '';
      sendBtn.disabled = true;
      addTypingIndicator();
      
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ content: message }));
        } else {
          // Fallback to HTTP
          const response = await fetch('/agent?id=' + agentId + '/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message })
          });
          
          const data = await response.json();
          removeTypingIndicator();
          
          if (data.response) {
            addMessage(data.response, 'assistant');
          } else if (data.error) {
            addMessage('Error: ' + data.error, 'assistant');
          }
        }
      } catch (error) {
        removeTypingIndicator();
        addMessage('Failed to send message. Please try again.', 'assistant');
        console.error('Send error:', error);
      } finally {
        sendBtn.disabled = false;
        messageInput.focus();
      }
    }
    
    async function clearChat() {
      if (!confirm('Clear chat history?')) return;
      
      try {
        const response = await fetch('/agent?id=' + agentId + '/clear', {
          method: 'POST'
        });
        
        if (response.ok) {
          messagesDiv.innerHTML = \`
            <div class="empty-state">
              <h2>👋 Welcome!</h2>
              <p>Start chatting with your AI agent powered by Cloudflare</p>
            </div>
          \`;
        }
      } catch (error) {
        console.error('Clear error:', error);
        alert('Failed to clear chat');
      }
    }
    
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    
    // Initialize
    connectWebSocket();
    messageInput.focus();
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
    
    // Agent endpoint - pass through to Durable Object
    if (url.pathname.startsWith("/agent")) {
      const agentId = url.searchParams.get("id") || crypto.randomUUID();
      const id = env.ChatAgent.idFromName(agentId);
      const stub = env.ChatAgent.get(id);
      
      // For clear endpoint, rewrite the path
      if (url.pathname.includes("/clear")) {
        const newUrl = new URL(request.url);
        newUrl.pathname = "/clear";
        request = new Request(newUrl, request);
      } else if (url.pathname.includes("/message")) {
        const newUrl = new URL(request.url);
        newUrl.pathname = "/message";
        request = new Request(newUrl, request);
      }
      
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
