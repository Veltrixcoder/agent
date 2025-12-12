import { Agent } from "agents";

// Define your AI Agent
export class ChatAgent extends Agent {
  async onConnect(metadata) {
    // Initialize agent state when a client connects
    await this.setState({
      conversationHistory: [],
      userPreferences: metadata?.preferences || {},
      createdAt: new Date().toISOString()
    });
    
    return {
      message: "Connected to AI Agent! How can I help you today?",
      agentId: this.id
    };
  }

  async onMessage(message) {
    try {
      const state = await this.getState();
      const history = state.conversationHistory || [];
      
      // Add user message to history
      history.push({
        role: "user",
        content: message.content,
        timestamp: new Date().toISOString()
      });

      // Call AI model (using Workers AI)
      const aiResponse = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          {
            role: "system",
            content: "You are a helpful AI assistant. Be concise and friendly."
          },
          ...history.slice(-10) // Keep last 10 messages for context
        ]
      });

      const assistantMessage = {
        role: "assistant",
        content: aiResponse.response,
        timestamp: new Date().toISOString()
      };

      // Add AI response to history
      history.push(assistantMessage);

      // Update state
      await this.setState({
        conversationHistory: history,
        lastInteraction: new Date().toISOString()
      });

      // Return response to client
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

  // Custom method to clear conversation history
  async clearHistory() {
    await this.setState({
      conversationHistory: [],
      lastInteraction: new Date().toISOString()
    });
    return { success: true, message: "Conversation history cleared" };
  }

  // Custom method to get conversation summary
  async getSummary() {
    const state = await this.getState();
    const history = state.conversationHistory || [];
    
    return {
      totalMessages: history.length,
      createdAt: state.createdAt,
      lastInteraction: state.lastInteraction,
      messagePreview: history.slice(-3)
    };
  }

  // Schedule a reminder task
  async scheduleReminder(message, delayMinutes) {
    const taskId = await this.schedule(async () => {
      // This will run after the specified delay
      await this.broadcast({
        type: "reminder",
        message: message,
        scheduledFor: new Date().toISOString()
      });
    }, delayMinutes * 60 * 1000); // Convert minutes to milliseconds

    return {
      success: true,
      taskId,
      message: `Reminder scheduled for ${delayMinutes} minutes from now`
    };
  }
}

// Main Worker entry point
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Route: Create or connect to an agent
    if (url.pathname === "/agent") {
      // Get or create agent with a specific ID
      const agentId = url.searchParams.get("id") || crypto.randomUUID();
      const agent = env.ChatAgent.get(env.ChatAgent.idFromName(agentId));
      
      // Handle WebSocket upgrade for real-time communication
      if (request.headers.get("Upgrade") === "websocket") {
        return agent.fetch(request);
      }
      
      // HTTP API for agent operations
      if (request.method === "POST") {
        const body = await request.json();
        const response = await agent.fetch(new Request(`http://agent/message`, {
          method: "POST",
          body: JSON.stringify(body)
        }));
        return response;
      }
      
      return new Response(JSON.stringify({ agentId, endpoint: `/agent?id=${agentId}` }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Route: Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ 
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "Cloudflare AI Agent"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Default route
    return new Response(JSON.stringify({
      message: "Welcome to Cloudflare AI Agent API",
      endpoints: {
        agent: "/agent?id={agentId} - Create or connect to an agent",
        health: "/health - Service health check"
      },
      usage: {
        http: "POST to /agent with JSON body { content: 'your message' }",
        websocket: "Connect to /agent with WebSocket for real-time chat"
      }
    }), {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
