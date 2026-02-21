import { DEFAULT_NODE_TOKEN, DEFAULT_NODE_URL } from "../common/constants.mjs";

export class MammothClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.MAMMOTH_NODE_URL || DEFAULT_NODE_URL;
    this.token = options.token || process.env.MAMMOTH_NODE_TOKEN || DEFAULT_NODE_TOKEN;
  }

  async request(method, path, body, options = {}) {
    const headers = {
      "content-type": "application/json"
    };

    if (options.withAuth) {
      headers["x-mammoth-token"] = this.token;
      headers["x-mammoth-role"] = options.role || "agent";
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }

    if (!response.ok) {
      const message = payload?.error || response.statusText;
      throw new Error(`HTTP ${response.status}: ${message}`);
    }

    return payload;
  }

  health() {
    return this.request("GET", "/health");
  }

  nodeInfo() {
    return this.request("GET", "/v1/node/info");
  }

  observerSummary() {
    return this.request("GET", "/v1/observer/summary");
  }

  timeline(limit = 20) {
    return this.request("GET", `/v1/observer/timeline?limit=${encodeURIComponent(limit)}`);
  }

  registerAgent(payload) {
    return this.request("POST", "/v1/agents/register", payload, { withAuth: true, role: "agent" });
  }

  createIntent(payload) {
    return this.request("POST", "/v1/intents", payload, { withAuth: true, role: "agent" });
  }

  runAction(payload) {
    return this.request("POST", "/v1/actions/run", payload, { withAuth: true, role: "agent" });
  }
}
