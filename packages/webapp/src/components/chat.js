import { LitElement, html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  loadMessages,
  saveMessages,
  clearMessages,
} from "../utils/chatStore.js";
import "./chat.css"; // Import the CSS file

export class ChatInterface extends LitElement {
  static get properties() {
    return {
      messages: { type: Array },
      inputMessage: { type: String },
      isLoading: { type: Boolean },
      isRetrieving: { type: Boolean },
      ragEnabled: { type: Boolean }
    };
  }

  constructor() {
    super();
    // Initialize component state
    this.messages = [];
    this.inputMessage = "";
    this.isLoading = false;
    this.isRetrieving = false;
    this.ragEnabled = true; // Enable by default
  }

  // Render into light DOM so external CSS applies
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Load chat history from localStorage when component is added to the DOM
    this.messages = loadMessages();
  }

  updated(changedProps) {
    // Save chat history to localStorage whenever messages change
    if (changedProps.has("messages")) {
      saveMessages(this.messages);
    }
  }

  formatMessage(content) {
    // Format code blocks with backticks
    content = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="${lang}">${this._escapeHtml(
        code.trim()
      )}</code></pre>`;
    });

    // Format inline code
    content = content.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Split content into blocks (separated by double newlines)
    const blocks = content.split("\n\n");

    // Process each block
    content = blocks
      .map((block) => {
        // Check if the block is a list (lines starting with - or *)
        const lines = block.trim().split("\n");
        const isList = lines.every((line) => /^\s*[-*]\s+/.test(line));

        if (isList) {
          // Format as unordered list
          const listItems = lines
            .map((line) => line.replace(/^\s*[-*]\s+(.+)$/, "<li>$1</li>"))
            .join("");
          return `<ul>${listItems}</ul>`;
        }

        // If not a list and doesn't start with HTML tag, wrap in paragraph
        return block.trim().startsWith("<") ? block : `<p>${block}</p>`;
      })
      .join("\n");

    return content;
  }

  _escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  render() {
    return html`
      <div class="chat-container">
        <div class="chat-header">
          <button class="clear-cache-btn" @click=${this._clearCache}>
            🧹Clear Chat
          </button>
          <label class="rag-toggle">
            <input type="checkbox" ?checked=${this.ragEnabled} @change=${this._toggleRag}>
            Use Employee Handbook
          </label>
        </div>
        <div class="chat-messages">
          ${this.messages.map(message => html`
            <div class="message ${message.role === 'user' ? 'user-message' : 'ai-message'}">
              <div class="message-content">
                <span class="message-sender">${message.role === 'user' ? 'You' : 'AI'}</span>
                ${unsafeHTML(this.formatMessage(message.content))}
                ${this.ragEnabled && message.sources && message.sources.length > 0 ? html`
                  <details class="sources">
                    <summary>📚 Sources</summary>
                    <div class="sources-content">
                      ${message.sources.map(source => html`<p>${source}</p>`)}
                    </div>
                  </details>
                ` : ''}
              </div>
            </div>
          `)}
          ${this.isRetrieving ? html`
            <div class="message system-message">
              <p>📚 Searching employee handbook...</p>
            </div>
          ` : ''}
          ${this.isLoading && !this.isRetrieving ? html`
            <div class="message ai-message">
              <div class="message-content">
                <span class="message-sender">AI</span>
                <p>Thinking...</p>
              </div>
            </div>
          ` : ''}
        </div>
        <div class="chat-input">
          <input
            type="text"
            placeholder="Ask about company policies, benefits, etc..."
            .value=${this.inputMessage}
            @input=${this._handleInput}
            @keyup=${this._handleKeyUp}
          />
          <button
            @click=${this._sendMessage}
            ?disabled=${this.isLoading || !this.inputMessage.trim()}
          >
            Send
          </button>
        </div>
      </div>
    `;
  }

  // Clear chat history from localStorage and UI
  _clearCache() {
    clearMessages();
    this.messages = [];
  }

  // Handle RAG toggle change
  _toggleRag(e) {
    this.ragEnabled = e.target.checked;
  }

  // Update inputMessage state as the user types
  _handleInput(e) {
    this.inputMessage = e.target.value;
  }

  // Send message on Enter key if not loading
  _handleKeyUp(e) {
    if (e.key === "Enter" && this.inputMessage.trim() && !this.isLoading) {
      this._sendMessage();
    }
  }

  // Handle sending a message and receiving a response
  async _sendMessage() {
    if (!this.inputMessage.trim() || this.isLoading) return;

    // Add user's message to the chat
    const userMessage = {
      role: "user",
      content: this.inputMessage,
    };

    this.messages = [...this.messages, userMessage];
    const userQuery = this.inputMessage;
    this.inputMessage = "";
    this.isLoading = true;

    // Show retrieval status if RAG is enabled
    if (this.ragEnabled) {
      this.isRetrieving = true;
    }

    try {
      // Call the API endpoint
      const apiResponse = await this._apiCall(userQuery);

      // Stop showing retrieval status
      this.isRetrieving = false;

      // Add AI's response to the chat with sources if available
      const aiMessage = {
        role: "assistant",
        content: apiResponse.reply,
        sources: apiResponse.sources || []
      };

      this.messages = [...this.messages, aiMessage];
    } catch (error) {
      // Handle errors gracefully
      console.error("Error calling model:", error);
      this.isRetrieving = false;
      this.messages = [
        ...this.messages,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        },
      ];
    } finally {
      this.isLoading = false;
    }
  }

  // Call the API endpoint with RAG support
  async _apiCall(message) {
    const res = await fetch("http://localhost:3001/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        message,
        useRAG: this.ragEnabled 
      }),
    });
    const data = await res.json();
    return data;
  }
}

customElements.define("chat-interface", ChatInterface);