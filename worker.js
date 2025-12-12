import { Agent } from "agents";

/**
 * The Frontend HTML
 * Served directly by the Agent when you visit the root URL.
 */
const HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Agent Chat</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f0f2f5; display: flex; justify-content: center; height: 100vh; margin: 0; }
        #app { width: 100%; max-width: 600px; background: white; display: flex; flex-direction: column; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        header { padding: 20px; border-bottom: 1px solid #eee; background: #fff; z-index: 10; }
        h1 { margin: 0; font-size: 1.2rem; color: #333; }
        #chat-history { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; }
        .message { max-width: 80%; padding: 12px 16px; border-radius: 12px; line-height: 1.5; }
        .user { align-self: flex-end; background: #0070f3; color: white; border-bottom-right-radius: 2px; }
        .assistant { align-self: flex-start; background: #f0f0f0; color: #333; border-bottom-left-radius: 2px; }
        form { padding: 20px; border-top: 1px solid #eee; display: flex; gap: 10px; background: #fff; }
        input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; outline: none; }
        input:focus { border-color: #0070f3; }
        button { padding: 12px 24px; background: #0070f3; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; }
        button:disabled { opacity: 0.7; cursor: not-allowed; }
    </style>
</head>
<body>
    <div id="app">
        <header>
            <h1>Agentic AI</h1>
        </header>
        <div id="chat-history">
            </div>
        <form id="chat-form">
            <input type="text" id="message-input" placeholder="Type a message..." autocomplete="off" required>
            <button type="submit">Send</button>
        </form>
    </div>

    <script>
        const form = document.getElementById('chat-form');
        const input = document.getElementById('message-input');
        const history = document.getElementById('chat-history');
        const btn = form.querySelector('button');

        function appendMessage(role, text) {
            const div = document.createElement('div');
            div.className = \`message \${role}\`;
            div.textContent = text;
            history.appendChild(div);
            history.scrollTop = history.scrollHeight;
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;

            // UI Updates
            appendMessage('user', text);
            input.value = '';
            btn.disabled = true;

            try {
                // Call the Agent API
                const res = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });
                
                const data = await res.json();
                appendMessage('assistant', data.response);
            } catch (err) {
                appendMessage('assistant', 'Error: Could not reach agent.');
            } finally {
                btn.disabled = false;
                input.focus();
            }
        });
    </script>
</body>
</html>
`;

/**
 * The Agent Logic
 * Handles both the UI requests and the AI Chat logic
 */
export class MyAgent extends Agent {
  
  async onRequest(request) {
    const url = new URL(request.url);

    // 1. ROUTE: GET / -> Serve Frontend
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }
    
    // 2. ROUTE: POST /chat -> Handle AI Logic
    if (url.pathname === "/chat" && request.method === "POST") {
      const body = await request.json();
      const userMessage = body.message || "Hello";

      // A. Get Context (History)
      const history = this.sql`SELECT * FROM messages ORDER BY created_at DESC LIMIT 5`.toArray();

      // B. Run Inference (Workers AI)
      // Note: We reverse history here because we fetched DESC (newest first) but LLM needs chronological
      const systemPrompt = { role: "system", content: "You are a helpful, witty autonomous agent." };
      const context = history.reverse().map(h => ({ role: h.role, content: h.content }));
      
      const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages: [systemPrompt, ...context, { role: "user", content: userMessage }]
      });

      const aiText = response.response;

      // C. Save State
      this.sql`INSERT INTO messages (role, content, created_at) VALUES ('user', ${userMessage}, ${Date.now()})`;
      this.sql`INSERT INTO messages (role, content, created_at) VALUES ('assistant', ${aiText}, ${Date.now()})`;

      return Response.json({ response: aiText });
    }

    return new Response("Not Found", { status: 404 });
  }

  // Setup Database Table
  async onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        content TEXT,
        created_at INTEGER
      )
    `;
  }
}

/**
 * The Router
 * Forwards all internet traffic to the specific Agent instance.
 */
export default {
  async fetch(request, env) {
    // We route everyone to a single persistent agent named "global-chat"
    // In a multi-user app, you would change this ID based on the user's session/cookie
    const id = env.MY_AGENT.idFromName("global-chat");
    const stub = env.MY_AGENT.get(id);
    return stub.fetch(request);
  }
};
