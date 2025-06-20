import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import dotenv from "dotenv";

dotenv.config();

const agentThreads = {};

class FunctionToolExecutor {
  constructor() {
    this.functionTools = [
      {
        func: this.getGeoCoordinates,
        definition: {
          type: "function",
          function: {
            name: "getGeoCoordinates",
            description: "Get geocoordinates (latitude and longitude) from city name.",
            parameters: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "The name of the city to get geocoordinates for.",
                },
              },
              required: ["location"],
            },
          },
        },
      },
      {
        func: this.getWeather,
        definition: {
          type: "function",
          function: {
            name: "getWeather",
            description: "Get current weather for a given city using its coordinates",
            parameters: {
              type: "object",
              properties: {
                lat: { type: "number", description: "Latitude of the city" },
                lon: { type: "number", description: "Longitude of the city" },
              },
              required: ["lat", "lon"],
            },
          },
        },
      }
    ];
    this.processedToolCalls = new Set();
  }

  getGeoCoordinates() {
    return async (args) => {
      const { location } = args;
      const apiKey = process.env.OPEN_WEATHER_API_KEY;
      
      if (!apiKey) {
        return { lat: null, lon: null, error: "OpenWeatherMap API key not configured" };
      }

      const url = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${apiKey}`;
      
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.length === 0) {
          return { lat: null, lon: null };
        }
        return { lat: data[0].lat, lon: data[0].lon };
      } catch (error) {
        console.error(`Error fetching geocoordinates for ${location}:`, error);
        return { lat: null, lon: null, error: error.message };
      }
    };
  }

  getWeather() {
    return async (args) => {
      const { lat, lon } = args;
      const apiKey = process.env.OPEN_WEATHER_API_KEY;
      
      if (!apiKey) {
        return { error: "OpenWeatherMap API key not configured" };
      }
      
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        return {
          location: {
            name: data.name,
            country: data.sys.country,
            coordinates: { lat: data.coord.lat, lon: data.coord.lon }
          },
          current: {
            temp: data.main.temp,
            feels_like: data.main.feels_like,
            humidity: data.main.humidity,
            weather: data.weather[0].description,
            wind: { speed: data.wind.speed }
          }
        };
      } catch (error) {
        console.error(`Error fetching weather data:`, error);
        return { error: error.message };
      }
    };
  }
  
  async invokeTool(toolCall) {
    console.log(`Invoking tool: ${toolCall.function.name}`);
    
    if (this.processedToolCalls.has(toolCall.id)) {
      return {
        toolCallId: toolCall.id,
        output: JSON.stringify({ message: "Tool call already processed" }),
      };
    }
    
    this.processedToolCalls.add(toolCall.id);
    
    // Parse parameters
    let params = {};
    const parameterSource = toolCall.function.parameters || toolCall.function.arguments;
    
    if (parameterSource) {
      try {
        params = typeof parameterSource === 'string' ? JSON.parse(parameterSource) : parameterSource;
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          output: JSON.stringify({ error: "Failed to parse parameters" }),
        };
      }
    }
    
    // Handle missing location parameter
    if (toolCall.function.name === "getGeoCoordinates" && !params.location) {
      return {
        toolCallId: toolCall.id,
        output: JSON.stringify({ error: "No location parameter provided" }),
      };
    }
    
    // Find and execute tool
    const tool = this.functionTools.find(t => t.definition.function.name === toolCall.function.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        output: JSON.stringify({ error: `Tool not found: ${toolCall.function.name}` }),
      };
    }
    
    try {
      const result = await tool.func()(params);
      return {
        toolCallId: toolCall.id,
        output: JSON.stringify(result),
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        output: JSON.stringify({ error: error.message }),
      };
    }
  }

  getFunctionDefinitions() {
    return this.functionTools.map(tool => tool.definition);
  }
}

export class AgentService {
  constructor() {
    this.client = new AIProjectClient(
      process.env.AGENT_STRING,
      new DefaultAzureCredential()
    );
    this.agent = null;
    this.agentId = null;
    this.functionToolExecutor = new FunctionToolExecutor();
    this.activeRuns = new Set();

    this.initPromise = this.initializeAgent();
  }

  async initializeAgent() {
    const functionTools = this.functionToolExecutor.getFunctionDefinitions();
    
    // FIXED: Use the actual deployment name, not model name
    // Common deployment names: "gpt-4", "gpt-4o", "gpt-35-turbo", etc.
    // Default to "gpt-4" if no deployment name is specified
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4";
    
    // Validate that deployment name is provided
    if (!deploymentName || deploymentName.trim() === "") {
      throw new Error("AZURE_OPENAI_DEPLOYMENT environment variable is required and cannot be empty");
    }
    
    try {
      console.log(`Creating agent with deployment name: ${deploymentName}`);
      
      this.agent = await this.client.agents.createAgent({
        model: deploymentName, // This must be your actual deployment name
        name: "Weather Assistant",
        instructions: "You are a helpful weather assistant. When users ask for weather in a city, first call getGeoCoordinates with the city name to get coordinates, then use those coordinates with getWeather to get the weather data.",
        tools: functionTools,
      });
      
      this.agentId = this.agent.id;
      console.log(`Successfully created agent with ID: ${this.agentId} using deployment: ${deploymentName}`);
    } catch (error) {
      console.error("Failed to initialize agent:", error);
      console.error("Error details:", error.message);
      console.error("Attempted deployment name:", deploymentName);
      
      // Provide helpful error message
      if (error.message.includes("'model' is required") || error.statusCode === 400) {
        console.error(`
TROUBLESHOOTING TIPS:
1. Verify your AZURE_OPENAI_DEPLOYMENT environment variable contains your actual deployment name
2. Common deployment names: "gpt-4", "gpt-4o", "gpt-35-turbo" 
3. Check your Azure AI Foundry portal to see your deployed model names
4. The deployment name might be different from the model name (e.g., deployment "my-gpt4" for model "gpt-4")
`);
      }
      
      throw error;
    }
  }

  async getOrCreateThread(sessionId) {
    if (!agentThreads[sessionId]) {
      const thread = await this.client.agents.createThread();
      agentThreads[sessionId] = thread.id;
      return thread.id;
    }
    return agentThreads[sessionId];
  }

  async processMessage(sessionId, message) {
    try {
      this.functionToolExecutor.processedToolCalls.clear();
      
      if (!this.agent) {
        await this.initPromise;
      }
      
      const threadId = await this.getOrCreateThread(sessionId);

      // Cancel any existing active runs
      const activeRuns = await this.client.agents.listRuns(threadId);
      const existingActiveRun = activeRuns.data.find(run => 
        ["queued", "in_progress", "requires_action"].includes(run.status)
      );

      if (existingActiveRun) {
        if (existingActiveRun.status === "requires_action") {
          await this.handleToolCalls(threadId, existingActiveRun.id, existingActiveRun.requiredAction);
        } else {
          await this.client.agents.cancelRun(threadId, existingActiveRun.id);
        }
      }
      
      // Create message and run
      await this.client.agents.createMessage(threadId, {
        role: "user",
        content: message,
      });

      let run = await this.client.agents.createRun(threadId, this.agentId);
      const runKey = `${threadId}-${run.id}`;
      
      if (this.activeRuns.has(runKey)) {
        return { reply: "Request is already being processed. Please wait." };
      }
      
      this.activeRuns.add(runKey);
      
      try {
        // Poll for completion
        let pollCount = 0;
        while (pollCount < 30) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          run = await this.client.agents.getRun(threadId, run.id);
          pollCount++;
          
          if (["completed", "failed", "cancelled"].includes(run.status)) {
            break;
          } else if (run.status === "requires_action") {
            const updatedRun = await this.handleToolCalls(threadId, run.id, run.requiredAction);
            if (updatedRun) {
              run = updatedRun;
              if (run.status === "completed") break;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        if (pollCount >= 30) {
          return { reply: "Request timed out. Please try again." };
        }
        
        if (run.status !== "completed") {
          return { reply: `Sorry, I encountered an error (${run.status}). Please try again.` };
        }
          
        // Get response
        const messages = await this.client.agents.listMessages(threadId);
        const assistantMessages = messages.data
          .filter(msg => msg.role === "assistant")
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        if (assistantMessages.length === 0) {
          return { reply: "I don't have a response at this time. Please try again." };
        }

        let responseText = "";
        for (const contentItem of assistantMessages[0].content) {
          if (contentItem.type === "text") {
            responseText += contentItem.text.value;
          }
        }
        
        return { reply: responseText };
      } finally {
        this.activeRuns.delete(runKey);
      }
    } catch (error) {
      console.error("Agent error:", error);
      return { reply: "Sorry, I encountered an error processing your request. Please try again." };
    }
  }

  async handleToolCalls(threadId, runId, requiredAction) {
    if (!requiredAction?.submitToolOutputs?.toolCalls) {
      return;
    }

    const toolCalls = requiredAction.submitToolOutputs.toolCalls;
    const toolResponses = [];
    
    for (const toolCall of toolCalls) {
      if (toolCall.type === "function") {
        const toolResult = await this.functionToolExecutor.invokeTool(toolCall);
        if (toolResult) {
          toolResponses.push({
            toolCallId: toolCall.id,
            output: typeof toolResult.output === 'string' ? toolResult.output : JSON.stringify(toolResult.output)
          });
        }
      }
    }

    if (toolResponses.length > 0) {
      return await this.client.agents.submitToolOutputsToRun(threadId, runId, toolResponses);
    }
  }
}