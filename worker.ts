import { Agent, routeAgentRequest } from "agents";

// --- 1. The Agent Class (Logic) ---

// Define the shape of your Agent's memory
interface AgentState {
  history: { role: string; content: string }[];
}

export class MyAgent extends Agent<Env, AgentState> {
  // Set initial state for new agents
  readonly initialState = {
    history: [{ role: "system", content: "You are a helpful assistant." }]
  };

  async onRequest(request: Request) {
    // 1. Get user message
    const body = await request.json() as { message: string };
    
    // 2. Update local state
    this.state.history.push({ role: "user", content: body.message });

    // 3. Call AI with full history (context window)
    const aiResponse = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: this.state.history
    });

    // 4. Save AI response to state
    const reply = aiResponse.response || "I couldn't generate a response.";
    this.state.history.push({ role: "assistant", content: reply });
    
    // 5. Persist state to Durable Object storage
    this.setState(this.state);

    // 6. Return response
    return Response.json({ 
      reply, 
      historyLength: this.state.history.length 
    });
  }
}

// --- 2. The Worker (Router) ---

export default {
  async fetch(request, env, ctx) {
    // Automatically routes to /agents/MyAgent/:id
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
};
