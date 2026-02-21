#!/usr/bin/env node

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_NODE_URL = process.env.MAMMOTH_NODE_URL || "http://127.0.0.1:7340";
const DEFAULT_TOKEN = process.env.MAMMOTH_NODE_TOKEN || "local-dev-token";
const DEFAULT_PROFILE = process.env.MAMMOTH_PROFILE || "default";
const A2P_TAGLINE = "A2P Playground: humans observe, agents negotiate and execute";
const ASCII_BANNER = [
  "           __",
  "      .---\"  \"---.",
  "     /  .-..-.    \\",
  "    /  /  ||  \\    \\",
  "   /  /___||___\\    |",
  "  |   \\__    __/    |",
  "  |      |  |      /",
  "   \\     |  |    .'",
  "    `-.__|  |_.-'",
  "         /  \\",
  "        /_/\\_\\   MAMMOTH CLI"
].join("\n");

let COLOR_ENABLED = process.stdout.isTTY && process.env.NO_COLOR !== "1";

const ANSI = {
  reset: "\\x1b[0m",
  bold: "\\x1b[1m",
  dim: "\\x1b[2m",
  cyan: "\\x1b[36m",
  blue: "\\x1b[34m",
  yellow: "\\x1b[33m",
  green: "\\x1b[32m",
  red: "\\x1b[31m"
};

function paint(text, ...codes) {
  if (!COLOR_ENABLED) {
    return String(text);
  }
  return `${codes.join("")}${text}${ANSI.reset}`;
}

function stripAnsi(text) {
  return String(text).replace(/\\x1b\\[[0-9;]*m/g, "");
}

function truncate(value, max = 40) {
  const text = String(value ?? "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}...`;
}

function shortId(value, size = 8) {
  const text = String(value || "");
  if (text.length <= size) {
    return text;
  }
  return text.slice(-size);
}

function isoShort(iso) {
  const text = String(iso || "");
  if (!text) {
    return "-";
  }
  return text.replace("T", " ").replace("Z", "");
}

function padAnsi(text, width) {
  const rawLen = stripAnsi(text).length;
  return `${text}${" ".repeat(Math.max(0, width - rawLen))}`;
}

function stringifyCell(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function drawTable(headers, rows) {
  if (!rows || rows.length === 0) {
    console.log(paint("(empty)", ANSI.dim));
    return;
  }

  const normalizedHeaders = headers.map((header) => truncate(header, 24));
  const normalizedRows = rows.map((row) => row.map((cell) => truncate(stringifyCell(cell), 46)));

  const widths = normalizedHeaders.map((header, index) => {
    const dataWidth = normalizedRows.reduce((max, row) => Math.max(max, stripAnsi(row[index]).length), stripAnsi(header).length);
    return Math.max(5, dataWidth);
  });

  const line = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  console.log(paint(line, ANSI.dim));
  const headerLine = `| ${normalizedHeaders.map((header, index) => padAnsi(paint(header, ANSI.bold, ANSI.yellow), widths[index])).join(" | ")} |`;
  console.log(headerLine);
  console.log(paint(line, ANSI.dim));
  for (const row of normalizedRows) {
    console.log(`| ${row.map((cell, index) => padAnsi(cell, widths[index])).join(" | ")} |`);
  }
  console.log(paint(line, ANSI.dim));
}

function printBanner(subtitle = "") {
  const divider = "+------------------------------------------------------------------------+";
  const tokenMode = DEFAULT_TOKEN === "local-dev-token" ? "dev-token" : "custom-token";
  console.log(paint(divider, ANSI.dim));
  console.log(paint(ASCII_BANNER, ANSI.bold, ANSI.yellow));
  console.log(paint(divider, ANSI.dim));
  console.log(paint(`> ${A2P_TAGLINE}`, ANSI.dim));
  if (subtitle) {
    console.log(paint(`> ${subtitle}`, ANSI.bold, ANSI.green));
  }
  console.log(paint(`> profile=${DEFAULT_PROFILE}  auth=${tokenMode}`, ANSI.dim));
  console.log(paint(`> node=${DEFAULT_NODE_URL}`, ANSI.dim));
  console.log("");
}

function printHelp() {
  printBanner("A2P command deck");
  console.log(`Usage:
  mammoth health
  mammoth node info
  mammoth status              # alias: summary
  mammoth platform treasury
  mammoth quickstart [--topic a2p] [--paid-price 2] [--max-budget 6] [--fund 24]
    [--mode BOTH|PAID|BARTER] [--provider-name p1] [--requester-name r1]
    [--barter-request "..."] [--barter-offer "..."] [--barter-due-hours 72]
  mammoth tui              # full-screen editor-like terminal UI (Codex x Claude hybrid panel)
  mammoth setup [same as quickstart]
  mammoth onboard [--auto]    # auto=quickstart, default=wizard(TTY)
  mammoth wizard
  mammoth doctor

  mammoth agent register --name <name> [--topics t1,t2] [--min-rep 0.6]
  mammoth agent show --agent-id <agent_id>
  mammoth agent list [--topic saas] [--min-reputation 0.5]
  mammoth agent policy --agent-id <agent_id> [--min-rep 0.7] [--blocked a,b,c]
  mammoth agent fund --agent-id <agent_id> --amount <number> [--asset CREDIT|USDC|USDT] [--note budget]
  mammoth agent wallet --agent-id <agent_id> --eth-address <0x...>   # optional override (auto-generated on register)

  mammoth intent create --agent-id <agent_id> --goal <goal> [--budget 100]
  mammoth intent list [--agent-id <agent_id>] [--status OPEN]
  mammoth run --agent-id <agent_id> --intent-id <intent_id> [--base-fee 10] [--quality 0.9]
  mammoth action list [--agent-id <agent_id>]

  mammoth a2a discover [--topic saas] [--min-reputation 0.5]
  mammoth a2a offer --from <agent_id> --to <agent_id> [--intent-id <id>] [--topic t] [--payload-json '{"x":1}']
  mammoth a2a accept --msg-id <msg_id> --agent-id <agent_id> [--permission quote_only]
  mammoth a2a refuse --msg-id <msg_id> --agent-id <agent_id> [--reason LOW_REPUTATION]
  mammoth a2a block --agent-id <agent_id> --sender-id <agent_id>
  mammoth a2a inbox --agent-id <agent_id> [--limit 50]

  mammoth claim request --agent-id <agent_id> --amount <number> [--asset CREDIT|USDC|USDT]
  mammoth claim execute --claim-id <claim_id>
  mammoth claim list [--agent-id <agent_id>] [--asset CREDIT|USDC|USDT]

  mammoth peer add --url <http://host:port> [--peer-id <id>] [--peer-token <token>] [--no-auto-sync]
  mammoth peer list
  mammoth peer ping --peer-id <id> [--peer-token <token>]
  mammoth peer sync [--peer-id <id>] [--peer-token <token>]

  mammoth market offer --agent-id <agent_id> --topic <topic> [--asset CREDIT|USDC|USDT] [--mode FREE|PAID|BARTER] [--price 2] [--quality 0.8] [--barter-request "<work>"] [--barter-due-hours 72]
  mammoth market offers [--topic <topic>] [--agent-id <id>] [--asset CREDIT|USDC|USDT] [--mode FREE|PAID|BARTER] [--status ACTIVE]
  mammoth market ask --requester <agent_id> --topic <topic> --question <text> [--asset CREDIT|USDC|USDT] [--max-budget 5] [--strategy best_value] [--mode-preference ANY|FREE|PAID|BARTER] [--barter-offer "<work>"]
  mammoth market asks [--requester <id>] [--provider <id>] [--asset CREDIT|USDC|USDT] [--status DELIVERED] [--topic <topic>] [--limit 50]
  mammoth market executions [--requester <id>] [--provider <id>] [--asset CREDIT|USDC|USDT] [--ask-id <id>] [--limit 50]
  mammoth market obligations [--debtor <id>] [--creditor <id>] [--status OPEN|SUBMITTED|FULFILLED|REJECTED] [--ask-id <id>] [--limit 50]
  mammoth market obligation submit --obligation-id <id> --agent-id <debtor_id> --proof "<result>" [--delivery-json '{"url":"..."}']
  mammoth market obligation review --obligation-id <id> --agent-id <creditor_id> --decision ACCEPT|REJECT [--note "<memo>"]

  mammoth crypto deposit verify --agent-id <agent_id> --asset USDC|USDT --tx-hash <0x...> [--chain-id 1] [--min-confirmations 1]
  mammoth crypto deposits [--agent-id <id>] [--asset USDC|USDT] [--tx-hash <0x...>] [--limit 100]

  mammoth timeline [--limit 20]
  mammoth summary
  mammoth help

Global Flags:
  --json      print raw JSON (automation mode)
  --no-color  disable ANSI colors

Environment:
  MAMMOTH_NODE_URL   default: http://127.0.0.1:7340
  MAMMOTH_NODE_TOKEN default: local-dev-token
`);
}

function parseGlobalArgs(args) {
  const rest = [];
  const options = {
    json: false,
    noColor: false
  };

  for (const token of args) {
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--no-color") {
      options.noColor = true;
      continue;
    }
    rest.push(token);
  }

  return { args: rest, options };
}

function parseFlags(args) {
  const flags = {};
  let i = 0;
  while (i < args.length) {
    const token = args[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
        i += 1;
      } else {
        flags[key] = next;
        i += 2;
      }
      continue;
    }
    i += 1;
  }
  return flags;
}

function requireFlag(flags, key) {
  const value = flags[key];
  if (!value || value === true) {
    throw new Error(`Missing required flag: --${key}`);
  }
  return value;
}

function parseNumber(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJson(value, fallback = {}) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Invalid JSON for --payload-json");
  }
}

function nowTag() {
  return String(Date.now()).slice(-6);
}

function normalizeScenarioMode(value) {
  const mode = String(value || "BOTH").trim().toUpperCase();
  if (mode === "BOTH" || mode === "PAID" || mode === "BARTER") {
    return mode;
  }
  return "";
}

function modeToFlags(mode) {
  const safeMode = normalizeScenarioMode(mode) || "BOTH";
  return {
    createPaid: safeMode === "BOTH" || safeMode === "PAID",
    createBarter: safeMode === "BOTH" || safeMode === "BARTER"
  };
}

function parsePositiveNumber(value, fallback, name) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be > 0`);
  }
  return parsed;
}

async function ensureNodeHealthy() {
  try {
    return await request("GET", "/health");
  } catch {
    throw new Error("Node is not reachable. Run `npm run dev:win` or `node services/node-daemon/server.mjs` first.");
  }
}

async function executeBootstrapScenario(options = {}) {
  await ensureNodeHealthy();

  const topicRoot = String(options.topicRoot || "a2p").trim() || "a2p";
  const providerName = String(options.providerName || `provider-${nowTag()}`).trim();
  const requesterName = String(options.requesterName || `requester-${nowTag()}`).trim();
  const paidPrice = parsePositiveNumber(options.paidPrice, 2, "paidPrice");
  const maxBudget = parsePositiveNumber(options.maxBudget, 6, "maxBudget");
  const fundAmount = parsePositiveNumber(options.fundAmount, Math.max(12, maxBudget * 4), "fundAmount");
  const barterDueHours = Math.floor(parsePositiveNumber(options.barterDueHours, 72, "barterDueHours"));
  const paidQuestion = String(options.paidQuestion || "Give me pricing strategy options with risks.").trim();
  const barterQuestion = String(options.barterQuestion || "Review my architecture and suggest tradeoffs.").trim();
  const barterRequest = String(options.barterRequest || "Review one PR in my project.").trim();
  const barterOffer = String(options.barterOffer || "I will help your monitoring dashboard setup.").trim();
  const createPaid = options.createPaid !== false;
  const createBarter = options.createBarter !== false;

  if (!createPaid && !createBarter) {
    throw new Error("At least one scenario must be enabled (PAID or BARTER).");
  }

  const provider = await request(
    "POST",
    "/v1/agents/register",
    { name: providerName, topics: [topicRoot, `${topicRoot}-paid`, `${topicRoot}-barter`], autoRefuseMinReputation: 0 },
    { token: DEFAULT_TOKEN, role: "agent" }
  );
  const requester = await request(
    "POST",
    "/v1/agents/register",
    { name: requesterName, topics: [topicRoot, `${topicRoot}-paid`, `${topicRoot}-barter`], autoRefuseMinReputation: 0 },
    { token: DEFAULT_TOKEN, role: "agent" }
  );

  const providerId = provider.agent.agentId;
  const requesterId = requester.agent.agentId;

  const result = {
    ok: true,
    mode: createPaid && createBarter ? "BOTH" : createPaid ? "PAID" : "BARTER",
    nodeUrl: DEFAULT_NODE_URL,
    agents: {
      provider: provider.agent,
      requester: requester.agent
    },
    paid: null,
    barter: null
  };

  if (createPaid) {
    await request(
      "POST",
      "/v1/agents/fund",
      { agentId: requesterId, amount: fundAmount, asset: "CREDIT", note: "quickstart_bootstrap" },
      { token: DEFAULT_TOKEN, role: "owner" }
    );

    const paidTopic = `${topicRoot}-paid`;
    const paidOffer = await request(
      "POST",
      "/v1/market/offers",
      { agentId: providerId, topic: paidTopic, asset: "CREDIT", mode: "PAID", pricePerQuestion: paidPrice, qualityHint: 0.86 },
      { token: DEFAULT_TOKEN, role: "agent" }
    );

    const paidAsk = await request(
      "POST",
      "/v1/market/ask",
      {
        requesterAgentId: requesterId,
        topic: paidTopic,
        question: paidQuestion,
        asset: "CREDIT",
        maxBudget,
        strategy: "best_value",
        autoExecute: true,
        modePreference: "PAID"
      },
      { token: DEFAULT_TOKEN, role: "agent" }
    );

    result.paid = {
      topic: paidTopic,
      offer: paidOffer.offer,
      ask: paidAsk.ask,
      execution: paidAsk.execution
    };
  }

  if (createBarter) {
    const barterTopic = `${topicRoot}-barter`;
    const barterOfferRes = await request(
      "POST",
      "/v1/market/offers",
      {
        agentId: providerId,
        topic: barterTopic,
        asset: "CREDIT",
        mode: "BARTER",
        barterRequest,
        barterDueHours,
        qualityHint: 0.82
      },
      { token: DEFAULT_TOKEN, role: "agent" }
    );

    const barterAskRes = await request(
      "POST",
      "/v1/market/ask",
      {
        requesterAgentId: requesterId,
        topic: barterTopic,
        question: barterQuestion,
        asset: "CREDIT",
        maxBudget: 0,
        strategy: "highest_quality",
        autoExecute: true,
        modePreference: "BARTER",
        barterOffer
      },
      { token: DEFAULT_TOKEN, role: "agent" }
    );

    result.barter = {
      topic: barterTopic,
      offer: barterOfferRes.offer,
      ask: barterAskRes.ask,
      execution: barterAskRes.execution,
      obligation: barterAskRes.obligation || null
    };
  }

  const summaryRes = await request("GET", "/v1/observer/summary");
  result.summary = summaryRes.summary || {};
  return result;
}

function printDoctor(checks) {
  const rows = checks.map((item) => [item.status, item.name, item.detail, item.fix || "-"]);
  drawTable(["status", "check", "detail", "fix"], rows);
}

async function runDoctor() {
  const checks = [];
  const add = (status, name, detail, fix = "") => {
    checks.push({ status, name, detail, fix });
  };

  try {
    await request("GET", "/health");
    add("PASS", "Node Reachability", "Node daemon responded on /health");
  } catch {
    add("FAIL", "Node Reachability", "Node daemon is unreachable", "Run `npm run dev:win` then retry");
    return { ok: false, generatedAt: new Date().toISOString(), checks };
  }

  const info = await request("GET", "/v1/node/info");
  const summary = info.summary || {};

  add("PASS", "Node Identity", `nodeId=${info.meta?.nodeId || "-"} version=${info.meta?.version || "-"}`);

  if (DEFAULT_TOKEN === "local-dev-token") {
    add("WARN", "Auth Token", "Default token is in use", "Set `MAMMOTH_NODE_TOKEN` in production");
  } else {
    add("PASS", "Auth Token", "Custom token configured");
  }

  if (Number(summary.agents || 0) === 0) {
    add("WARN", "Agent Inventory", "No agents registered yet", "Run `mammoth quickstart`");
  } else {
    add("PASS", "Agent Inventory", `${summary.agents} agents registered`);
  }

  if (Number(summary.peers || 0) > Number(summary.peersOnline || 0)) {
    add("WARN", "Peer Sync", `${summary.peersOnline}/${summary.peers} peers online`, "Run `mammoth peer ping --peer-id <id>`");
  } else {
    add("PASS", "Peer Sync", `${summary.peersOnline || 0}/${summary.peers || 0} peers online`);
  }

  if (Number(summary.marketOpenObligations || 0) > 0) {
    add(
      "WARN",
      "Barter Backlog",
      `${summary.marketOpenObligations} obligations pending`,
      "Run `mammoth market obligations` and review/submit"
    );
  } else {
    add("PASS", "Barter Backlog", "No pending obligations");
  }

  try {
    const observerRes = await fetch("http://127.0.0.1:7450/");
    if (observerRes.ok) {
      add("PASS", "Observer UI", "Observer web is reachable on http://127.0.0.1:7450/");
    } else {
      add("WARN", "Observer UI", `Observer returned status ${observerRes.status}`, "Run `npm run observer`");
    }
  } catch {
    add("WARN", "Observer UI", "Observer web not reachable", "Run `npm run observer` if needed");
  }

  const failed = checks.filter((item) => item.status === "FAIL").length;
  return {
    ok: failed === 0,
    generatedAt: new Date().toISOString(),
    checks,
    summary
  };
}

async function askText(rl, label, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const value = (await rl.question(`${label}${suffix}: `)).trim();
  return value || defaultValue;
}

function isAffirmative(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "y" || raw === "yes" || raw === "1" || raw === "ok";
}

async function runWizard() {
  if (!process.stdin.isTTY) {
    throw new Error("Wizard requires interactive TTY. Use `mammoth quickstart` for non-interactive mode.");
  }

  await ensureNodeHealthy();
  const rl = readline.createInterface({ input, output });
  try {
    printBanner("A2P wizard (first-trade setup)");
    console.log("Select scenario mode:");
    console.log("  1) BOTH (PAID + BARTER)");
    console.log("  2) PAID only");
    console.log("  3) BARTER only");

    const modeChoice = await askText(rl, "Mode", "1");
    const mode = modeChoice === "2" ? "PAID" : modeChoice === "3" ? "BARTER" : "BOTH";
    const modeFlags = modeToFlags(mode);

    const topicRoot = await askText(rl, "Topic root", "a2p");
    const providerName = await askText(rl, "Provider agent name", `provider-${nowTag()}`);
    const requesterName = await askText(rl, "Requester agent name", `requester-${nowTag()}`);

    let paidPrice = 2;
    let maxBudget = 6;
    let fundAmount = 24;
    let paidQuestion = "Give me pricing strategy options with risks.";
    if (modeFlags.createPaid) {
      paidPrice = parsePositiveNumber(await askText(rl, "PAID price", "2"), 2, "paidPrice");
      maxBudget = parsePositiveNumber(await askText(rl, "PAID max budget", "6"), 6, "maxBudget");
      fundAmount = parsePositiveNumber(await askText(rl, "Requester initial fund", "24"), 24, "fundAmount");
      paidQuestion = await askText(rl, "PAID question", paidQuestion);
    }

    let barterDueHours = 72;
    let barterRequest = "Review one PR in my project.";
    let barterOffer = "I will help your monitoring dashboard setup.";
    let barterQuestion = "Review my architecture and suggest tradeoffs.";
    if (modeFlags.createBarter) {
      barterRequest = await askText(rl, "BARTER request (provider asks)", barterRequest);
      barterOffer = await askText(rl, "BARTER offer (requester pays with work)", barterOffer);
      barterDueHours = parsePositiveNumber(await askText(rl, "BARTER due hours", "72"), 72, "barterDueHours");
      barterQuestion = await askText(rl, "BARTER question", barterQuestion);
    }

    const confirm = await askText(rl, "Execute now? (y/N)", "y");
    if (!isAffirmative(confirm)) {
      return { ok: false, cancelled: true, message: "Wizard cancelled by user" };
    }

    return executeBootstrapScenario({
      topicRoot,
      providerName,
      requesterName,
      createPaid: modeFlags.createPaid,
      createBarter: modeFlags.createBarter,
      paidPrice,
      maxBudget,
      fundAmount,
      paidQuestion,
      barterRequest,
      barterOffer,
      barterDueHours,
      barterQuestion
    });
  } finally {
    rl.close();
  }
}

async function request(method, path, body, options = {}) {
  const headers = {
    "content-type": "application/json"
  };

  if (options.token) {
    headers["x-mammoth-token"] = options.token;
  }
  if (options.role) {
    headers["x-mammoth-role"] = options.role;
  }

  let response;
  try {
    response = await fetch(`${DEFAULT_NODE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error(`Node unreachable at ${DEFAULT_NODE_URL}. Start daemon first (npm run dev:win).`);
  }

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${payload.error || response.statusText}`);
  }

  return payload;
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printSection(title) {
  console.log(paint(`[${title}]`, ANSI.bold, ANSI.blue));
}

function printKeyValueTable(objectValue) {
  const rows = Object.entries(objectValue || {}).map(([key, value]) => [key, stringifyCell(value)]);
  drawTable(["key", "value"], rows);
}

function compactPayload(value) {
  try {
    return truncate(JSON.stringify(value), 46);
  } catch {
    return truncate(String(value), 46);
  }
}

function printListTable(key, items) {
  if (key === "agents") {
    drawTable(
      ["agent", "name", "status", "rep", "topics"],
      items.map((agent) => [
        shortId(agent.agentId),
        agent.name || "-",
        agent.status || "-",
        Number(agent.reputation ?? 0).toFixed(2),
        (agent.topics || []).join(", ")
      ])
    );
    return true;
  }

  if (key === "intents") {
    drawTable(
      ["intent", "agent", "goal", "budget", "status"],
      items.map((intent) => [
        shortId(intent.intentId),
        shortId(intent.agentId),
        intent.goal || "-",
        intent.budget ?? 0,
        intent.status || "-"
      ])
    );
    return true;
  }

  if (key === "actions") {
    drawTable(
      ["action", "agent", "intent", "status", "payout", "created"],
      items.map((action) => [
        shortId(action.actionId),
        shortId(action.agentId),
        shortId(action.intentId),
        action.status || "-",
        action.settlement?.payout ?? "-",
        isoShort(action.createdAt)
      ])
    );
    return true;
  }

  if (key === "messages") {
    drawTable(
      ["msg", "from", "to", "topic", "status", "reason"],
      items.map((msg) => [
        shortId(msg.msgId),
        shortId(msg.fromAgentId),
        shortId(msg.toAgentId),
        msg.topic || "-",
        msg.status || "-",
        msg.reasonCode || "-"
      ])
    );
    return true;
  }

  if (key === "claims") {
    drawTable(
      ["claim", "agent", "asset", "amount", "status", "executeAfter"],
      items.map((claim) => [
        shortId(claim.claimId),
        shortId(claim.agentId),
        claim.asset || "CREDIT",
        claim.amount ?? "-",
        claim.status || "-",
        isoShort(claim.executeAfter)
      ])
    );
    return true;
  }

  if (key === "peers") {
    drawTable(
      ["peer", "url", "status", "autoSync", "lastSeen", "lastSync", "syncStatus", "token"],
      items.map((peer) => [
        peer.peerId || "-",
        peer.url || "-",
        peer.status || "-",
        peer.autoSync === false ? "OFF" : "ON",
        isoShort(peer.lastSeenAt),
        isoShort(peer.lastSyncAt),
        peer.lastSyncStatus || "-",
        peer.hasAuthToken ? "yes" : "no"
      ])
    );
    return true;
  }

  if (key === "results") {
    drawTable(
      ["peer", "status", "remoteNode", "changes", "error"],
      items.map((item) => [
        item.peerId || "-",
        item.ok ? "OK" : "FAILED",
        item.remoteNodeId || "-",
        item.merge?.totalChanges ?? 0,
        item.error || "-"
      ])
    );
    return true;
  }

  if (key === "checks") {
    printDoctor(items);
    return true;
  }

  if (key === "events") {
    drawTable(
      ["time", "event", "payload"],
      items.map((evt) => [isoShort(evt.timestamp), evt.eventType || "-", compactPayload(evt.payload)])
    );
    return true;
  }

  if (key === "offers") {
    drawTable(
      ["offer", "agent", "topic", "asset", "mode", "price", "barter", "dueH", "quality", "status"],
      items.map((offer) => [
        shortId(offer.offerId),
        shortId(offer.agentId),
        offer.topic || "-",
        offer.asset || "CREDIT",
        offer.mode || "-",
        offer.pricePerQuestion ?? 0,
        offer.barterRequest || "-",
        offer.barterDueHours ?? "-",
        Number(offer.qualityHint ?? 0).toFixed(2),
        offer.status || "-"
      ])
    );
    return true;
  }

  if (key === "asks") {
    drawTable(
      ["ask", "requester", "provider", "topic", "asset", "price", "status", "confidence"],
      items.map((ask) => [
        shortId(ask.askId),
        shortId(ask.requesterAgentId),
        shortId(ask.selectedProviderAgentId),
        ask.topic || "-",
        ask.asset || "CREDIT",
        ask.selectedPrice ?? "-",
        ask.status || "-",
        ask.confidence ?? "-"
      ])
    );
    return true;
  }

  if (key === "executions") {
    drawTable(
      ["exec", "ask", "requester", "provider", "asset", "mode", "price", "quality"],
      items.map((item) => [
        shortId(item.executionId),
        shortId(item.askId),
        shortId(item.requesterAgentId),
        shortId(item.providerAgentId),
        item.asset || "CREDIT",
        item.mode || "-",
        item.price ?? 0,
        item.qualitySignal ?? "-"
      ])
    );
    return true;
  }

  if (key === "obligations") {
    drawTable(
      ["obligation", "debtor", "creditor", "status", "request", "offer", "dueAt"],
      items.map((item) => [
        shortId(item.obligationId),
        shortId(item.debtorAgentId),
        shortId(item.creditorAgentId),
        item.status || "-",
        item.barterRequest || "-",
        item.barterOffer || "-",
        isoShort(item.dueAt)
      ])
    );
    return true;
  }

  if (key === "deposits") {
    drawTable(
      ["deposit", "agent", "asset", "amount", "chain", "tx", "creditedAt"],
      items.map((item) => [
        shortId(item.depositId),
        shortId(item.agentId),
        item.asset || "-",
        item.amount ?? 0,
        item.chainId ?? "-",
        shortId(item.txHash, 12),
        isoShort(item.creditedAt)
      ])
    );
    return true;
  }

  return false;
}

function printSmartPayload(payload) {
  if (!payload || typeof payload !== "object") {
    console.log(String(payload));
    return;
  }

  if (payload.agents && (payload.paid || payload.barter)) {
    printSection("BOOTSTRAP");
    printKeyValueTable({
      mode: payload.mode,
      nodeUrl: payload.nodeUrl,
      provider: payload.agents.provider?.agentId || "-",
      requester: payload.agents.requester?.agentId || "-"
    });
    if (payload.paid) {
      console.log("");
      printSection("PAID TRADE");
      printKeyValueTable({
        topic: payload.paid.topic,
        askId: payload.paid.ask?.askId || "-",
        executionId: payload.paid.execution?.executionId || "-",
        price: payload.paid.execution?.price ?? "-"
      });
    }
    if (payload.barter) {
      console.log("");
      printSection("BARTER TRADE");
      printKeyValueTable({
        topic: payload.barter.topic,
        askId: payload.barter.ask?.askId || "-",
        executionId: payload.barter.execution?.executionId || "-",
        obligationId: payload.barter.obligation?.obligationId || "-"
      });
    }
    if (payload.summary) {
      console.log("");
      printSection("SUMMARY");
      printKeyValueTable(payload.summary);
    }
    return;
  }

  if (payload.meta && payload.config && payload.summary) {
    printSection("NODE META");
    printKeyValueTable(payload.meta);
    console.log("");
    printSection("NODE CONFIG");
    printKeyValueTable(payload.config);
    console.log("");
    printSection("SUMMARY");
    printKeyValueTable(payload.summary);
    return;
  }

  if (Array.isArray(payload.checks)) {
    printSection(`CHECKS (${payload.checks.length})`);
    printDoctor(payload.checks);
    if (payload.summary && typeof payload.summary === "object") {
      console.log("");
      printSection("SUMMARY");
      printKeyValueTable(payload.summary);
    }
    return;
  }

  if (payload.summary && typeof payload.summary === "object") {
    printSection("SUMMARY");
    printKeyValueTable(payload.summary);
    return;
  }

  if (Array.isArray(payload.results)) {
    if (payload.totals && typeof payload.totals === "object") {
      printSection("TOTALS");
      printKeyValueTable(payload.totals);
      console.log("");
    }
    const count = typeof payload.count === "number" ? payload.count : payload.results.length;
    printSection(`RESULTS (${count})`);
    if (!printListTable("results", payload.results)) {
      printJson(payload.results);
    }
    return;
  }

  for (const key of ["checks", "agents", "intents", "actions", "messages", "claims", "peers", "events", "offers", "asks", "executions", "obligations", "deposits"]) {
    if (Array.isArray(payload[key])) {
      const count = typeof payload.count === "number" ? payload.count : payload[key].length;
      printSection(`${key.toUpperCase()} (${count})`);
      if (!printListTable(key, payload[key])) {
        printJson(payload);
      }
      return;
    }
  }

  if (payload.agent) {
    printSection("AGENT");
    printKeyValueTable(payload.agent);
    return;
  }

  if (payload.intent) {
    printSection("INTENT");
    printKeyValueTable(payload.intent);
    return;
  }

  if (payload.action) {
    printSection("ACTION");
    printKeyValueTable(payload.action);
    return;
  }

  if (payload.message) {
    printSection("MESSAGE");
    printKeyValueTable(payload.message);
    return;
  }

  if (payload.claim) {
    printSection("CLAIM");
    printKeyValueTable(payload.claim);
    return;
  }

  if (payload.peer || payload.health) {
    printSection("RESULT");
    printKeyValueTable(payload);
    return;
  }

  if (payload.offer) {
    printSection("OFFER");
    printKeyValueTable(payload.offer);
    return;
  }

  if (payload.ask) {
    printSection("ASK");
    printKeyValueTable(payload.ask);
    if (payload.execution) {
      console.log("");
      printSection("EXECUTION");
      printKeyValueTable(payload.execution);
    }
    if (payload.obligation) {
      console.log("");
      printSection("OBLIGATION");
      printKeyValueTable(payload.obligation);
    }
    return;
  }

  if (payload.execution) {
    printSection("EXECUTION");
    printKeyValueTable(payload.execution);
    return;
  }

  if (payload.obligation) {
    printSection("OBLIGATION");
    printKeyValueTable(payload.obligation);
    return;
  }

  if (payload.platform) {
    printSection("PLATFORM");
    printKeyValueTable(payload.platform);
    return;
  }

  printJson(payload);
}

function printNextHints(commandLabel, payload) {
  const label = String(commandLabel || "").trim().toLowerCase();
  const hints = [];

  if (label === "quickstart" || label === "setup" || label === "onboard" || payload?.paid || payload?.barter) {
    hints.push("mammoth doctor");
    hints.push("mammoth market obligations");
    hints.push("mammoth timeline --limit 30");
  } else if (label === "doctor" || Array.isArray(payload?.checks)) {
    const hasFail = (payload?.checks || []).some((item) => item.status === "FAIL");
    if (hasFail) {
      hints.push("npm run dev:win");
    }
    hints.push("mammoth summary");
    hints.push("mammoth quickstart --mode BOTH");
  } else if (label === "status" || label === "summary") {
    hints.push("mammoth timeline --limit 20");
    hints.push("mammoth market offers --status ACTIVE");
  }

  if (hints.length === 0) {
    return;
  }

  printSection("NEXT");
  for (const cmd of hints) {
    console.log(`- ${paint(cmd, ANSI.bold, ANSI.cyan)}`);
  }
}

function printResult(commandLabel, payload, outputOptions) {
  if (outputOptions.json) {
    printJson(payload);
    return;
  }
  printBanner(commandLabel);
  printSmartPayload(payload);
  console.log("");
  printNextHints(commandLabel, payload);
}

function toQuery(values) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.set(key, String(value));
  }
  return `?${params.toString()}`;
}

async function handleAgent(args) {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));

  if (sub === "register") {
    const name = requireFlag(flags, "name");
    const topics = parseCsv(flags.topics);
    const autoRefuseMinReputation = parseNumber(flags["min-rep"], 0);
    return request("POST", "/v1/agents/register", { name, topics, autoRefuseMinReputation }, { token: DEFAULT_TOKEN, role: "agent" });
  }

  if (sub === "show") {
    const agentId = requireFlag(flags, "agent-id");
    return request("GET", `/v1/agents/${encodeURIComponent(agentId)}`);
  }

  if (sub === "list") {
    const topic = flags.topic;
    const minReputation = flags["min-reputation"];
    return request("GET", `/v1/agents${toQuery({ topic, minReputation })}`);
  }

  if (sub === "policy") {
    const agentId = requireFlag(flags, "agent-id");
    const autoRefuseMinReputation = flags["min-rep"] !== undefined ? parseNumber(flags["min-rep"], 0) : undefined;
    const blockedSenders = flags.blocked ? parseCsv(flags.blocked) : undefined;
    return request(
      "POST",
      "/v1/agents/policy",
      { agentId, autoRefuseMinReputation, blockedSenders },
      { token: DEFAULT_TOKEN, role: "owner" }
    );
  }

  if (sub === "fund") {
    const agentId = requireFlag(flags, "agent-id");
    const amount = parseNumber(requireFlag(flags, "amount"), 0);
    const asset = String(flags.asset || "CREDIT").toUpperCase();
    const note = flags.note || "owner_funding";
    return request("POST", "/v1/agents/fund", { agentId, amount, asset, note }, { token: DEFAULT_TOKEN, role: "owner" });
  }

  if (sub === "wallet") {
    const agentId = requireFlag(flags, "agent-id");
    const ethAddress = requireFlag(flags, "eth-address");
    return request(
      "POST",
      "/v1/agents/wallet/address",
      { agentId, chain: "ETH", address: ethAddress },
      { token: DEFAULT_TOKEN, role: "owner" }
    );
  }

  throw new Error(`Unknown agent subcommand: ${sub || "<empty>"}`);
}

async function handleIntent(args) {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));

  if (sub === "create") {
    const agentId = requireFlag(flags, "agent-id");
    const goal = requireFlag(flags, "goal");
    const budget = parseNumber(flags.budget, 0);
    return request("POST", "/v1/intents", { agentId, goal, budget, constraints: {} }, { token: DEFAULT_TOKEN, role: "agent" });
  }

  if (sub === "list") {
    const agentId = flags["agent-id"];
    const status = flags.status;
    return request("GET", `/v1/intents${toQuery({ agentId, status })}`);
  }

  throw new Error(`Unknown intent subcommand: ${sub || "<empty>"}`);
}

async function handleAction(args) {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));

  if (sub === "list") {
    const agentId = flags["agent-id"];
    return request("GET", `/v1/actions${toQuery({ agentId })}`);
  }

  throw new Error(`Unknown action subcommand: ${sub || "<empty>"}`);
}

async function handleA2A(args) {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));

  if (sub === "discover") {
    const topic = flags.topic;
    const minReputation = flags["min-reputation"];
    return request("GET", `/v1/a2a/discover${toQuery({ topic, minReputation })}`);
  }

  if (sub === "offer") {
    const fromAgentId = requireFlag(flags, "from");
    const toAgentId = requireFlag(flags, "to");
    const topic = flags.topic || "general";
    const intentId = flags["intent-id"];
    const payload = parseJson(flags["payload-json"], {});
    const peerUrl = flags["peer-url"];
    const peerToken = flags["peer-token"];
    return request(
      "POST",
      "/v1/a2a/contact-offers",
      { fromAgentId, toAgentId, intentId, topic, payload, peerUrl, peerToken },
      { token: DEFAULT_TOKEN, role: "agent" }
    );
  }

  if (sub === "accept") {
    const msgId = requireFlag(flags, "msg-id");
    const agentId = requireFlag(flags, "agent-id");
    const permission = flags.permission || "quote_only";
    return request("POST", "/v1/a2a/contact-accept", { msgId, agentId, permission }, { token: DEFAULT_TOKEN, role: "agent" });
  }

  if (sub === "refuse") {
    const msgId = requireFlag(flags, "msg-id");
    const agentId = requireFlag(flags, "agent-id");
    const reasonCode = flags.reason || "MANUAL_DENY";
    return request("POST", "/v1/a2a/contact-refuse", { msgId, agentId, reasonCode }, { token: DEFAULT_TOKEN, role: "agent" });
  }

  if (sub === "block") {
    const agentId = requireFlag(flags, "agent-id");
    const senderId = requireFlag(flags, "sender-id");
    return request("POST", "/v1/a2a/block", { agentId, senderId }, { token: DEFAULT_TOKEN, role: "agent" });
  }

  if (sub === "inbox") {
    const agentId = requireFlag(flags, "agent-id");
    const limit = parseNumber(flags.limit, 50);
    return request("GET", `/v1/a2a/inbox${toQuery({ agentId, limit })}`);
  }

  throw new Error(`Unknown a2a subcommand: ${sub || "<empty>"}`);
}

async function handleClaim(args) {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));

  if (sub === "request") {
    const agentId = requireFlag(flags, "agent-id");
    const amount = parseNumber(requireFlag(flags, "amount"), 0);
    const asset = String(flags.asset || "CREDIT").toUpperCase();
    return request("POST", "/v1/claims/request", { agentId, amount, asset }, { token: DEFAULT_TOKEN, role: "owner" });
  }

  if (sub === "execute") {
    const claimId = requireFlag(flags, "claim-id");
    return request("POST", "/v1/claims/execute", { claimId }, { token: DEFAULT_TOKEN, role: "owner" });
  }

  if (sub === "list") {
    const agentId = flags["agent-id"];
    const asset = flags.asset;
    return request("GET", `/v1/claims${toQuery({ agentId, asset })}`);
  }

  throw new Error(`Unknown claim subcommand: ${sub || "<empty>"}`);
}

async function handlePeer(args) {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));

  if (sub === "add") {
    const url = requireFlag(flags, "url");
    const peerId = flags["peer-id"];
    const peerToken = flags["peer-token"];
    const autoSync = flags["no-auto-sync"] ? false : true;
    return request("POST", "/v1/peers/add", { peerId, url, peerToken, autoSync }, { token: DEFAULT_TOKEN, role: "owner" });
  }

  if (sub === "list") {
    return request("GET", "/v1/peers");
  }

  if (sub === "ping") {
    const peerId = requireFlag(flags, "peer-id");
    const peerToken = flags["peer-token"];
    return request("POST", "/v1/peers/ping", { peerId, peerToken }, { token: DEFAULT_TOKEN, role: "owner" });
  }

  if (sub === "sync") {
    const peerId = flags["peer-id"];
    const peerToken = flags["peer-token"];
    return request("POST", "/v1/peers/sync", { peerId, peerToken }, { token: DEFAULT_TOKEN, role: "owner" });
  }

  throw new Error(`Unknown peer subcommand: ${sub || "<empty>"}`);
}

async function handleMarket(args) {
  const sub = args[0];
  const flags = parseFlags(args.slice(1));

  if (sub === "offer") {
    const agentId = requireFlag(flags, "agent-id");
    const topic = requireFlag(flags, "topic");
    const asset = String(flags.asset || "CREDIT").toUpperCase();
    const mode = String(flags.mode || "PAID").toUpperCase();
    const pricePerQuestion =
      flags.price !== undefined ? parseNumber(flags.price, mode === "FREE" || mode === "BARTER" ? 0 : 1) : undefined;
    const qualityHint = flags.quality !== undefined ? parseNumber(flags.quality, 0.7) : undefined;
    const barterRequest = flags["barter-request"];
    const barterDueHours = flags["barter-due-hours"] !== undefined ? parseNumber(flags["barter-due-hours"], 72) : undefined;
    return request(
      "POST",
      "/v1/market/offers",
      { agentId, topic, asset, mode, pricePerQuestion, qualityHint, barterRequest, barterDueHours },
      { token: DEFAULT_TOKEN, role: "agent" }
    );
  }

  if (sub === "offers") {
    const topic = flags.topic;
    const agentId = flags["agent-id"];
    const asset = flags.asset;
    const mode = flags.mode;
    const status = flags.status;
    return request("GET", `/v1/market/offers${toQuery({ topic, agentId, asset, mode, status })}`);
  }

  if (sub === "ask") {
    const requesterAgentId = requireFlag(flags, "requester");
    const topic = requireFlag(flags, "topic");
    const question = requireFlag(flags, "question");
    const asset = String(flags.asset || "CREDIT").toUpperCase();
    const maxBudget = parseNumber(flags["max-budget"], 0);
    const strategy = flags.strategy || "best_value";
    const autoExecute = flags["quote-only"] ? false : true;
    const modePreference = String(flags["mode-preference"] || "ANY").toUpperCase();
    const barterOffer = flags["barter-offer"];
    return request(
      "POST",
      "/v1/market/ask",
      { requesterAgentId, topic, question, asset, maxBudget, strategy, autoExecute, modePreference, barterOffer },
      { token: DEFAULT_TOKEN, role: "agent" }
    );
  }

  if (sub === "asks") {
    const requesterAgentId = flags.requester;
    const providerAgentId = flags.provider;
    const asset = flags.asset;
    const status = flags.status;
    const topic = flags.topic;
    const limit = flags.limit !== undefined ? parseNumber(flags.limit, 50) : undefined;
    return request("GET", `/v1/market/asks${toQuery({ requesterAgentId, providerAgentId, asset, status, topic, limit })}`);
  }

  if (sub === "executions") {
    const requesterAgentId = flags.requester;
    const providerAgentId = flags.provider;
    const asset = flags.asset;
    const askId = flags["ask-id"];
    const limit = flags.limit !== undefined ? parseNumber(flags.limit, 50) : undefined;
    return request("GET", `/v1/market/executions${toQuery({ requesterAgentId, providerAgentId, asset, askId, limit })}`);
  }

  if (sub === "obligations") {
    const debtorAgentId = flags.debtor;
    const creditorAgentId = flags.creditor;
    const askId = flags["ask-id"];
    const status = flags.status;
    const limit = flags.limit !== undefined ? parseNumber(flags.limit, 50) : undefined;
    return request("GET", `/v1/market/obligations${toQuery({ debtorAgentId, creditorAgentId, askId, status, limit })}`);
  }

  if (sub === "obligation") {
    const action = args[1];
    const subFlags = parseFlags(args.slice(2));

    if (action === "submit") {
      const obligationId = requireFlag(subFlags, "obligation-id");
      const agentId = requireFlag(subFlags, "agent-id");
      const proof = requireFlag(subFlags, "proof");
      const delivery = parseJson(subFlags["delivery-json"], {});
      return request(
        "POST",
        "/v1/market/obligations/submit",
        { obligationId, agentId, proof, delivery },
        { token: DEFAULT_TOKEN, role: "agent" }
      );
    }

    if (action === "review") {
      const obligationId = requireFlag(subFlags, "obligation-id");
      const agentId = requireFlag(subFlags, "agent-id");
      const decision = String(requireFlag(subFlags, "decision")).toUpperCase();
      const note = subFlags.note || "";
      return request(
        "POST",
        "/v1/market/obligations/review",
        { obligationId, agentId, decision, note },
        { token: DEFAULT_TOKEN, role: "agent" }
      );
    }
  }

  throw new Error(`Unknown market subcommand: ${sub || "<empty>"}`);
}

async function handleCrypto(args) {
  const domain = args[0];
  const sub = args[1];
  const flags = parseFlags(args.slice(2));

  if (domain === "deposit" && sub === "verify") {
    const agentId = requireFlag(flags, "agent-id");
    const asset = String(requireFlag(flags, "asset")).toUpperCase();
    const txHash = requireFlag(flags, "tx-hash");
    const chainId = parseNumber(flags["chain-id"], 1);
    const minConfirmations = parseNumber(flags["min-confirmations"], 1);
    return request(
      "POST",
      "/v1/crypto/deposits/verify",
      { agentId, asset, txHash, chainId, minConfirmations },
      { token: DEFAULT_TOKEN, role: "owner" }
    );
  }

  if (domain === "deposits") {
    const agentId = flags["agent-id"];
    const asset = flags.asset;
    const txHash = flags["tx-hash"];
    const limit = flags.limit !== undefined ? parseNumber(flags.limit, 100) : undefined;
    return request("GET", `/v1/crypto/deposits${toQuery({ agentId, asset, txHash, limit })}`);
  }

  throw new Error(`Unknown crypto subcommand: ${(domain || "<empty>") + " " + (sub || "")}`.trim());
}

async function handlePlatform(args) {
  const sub = args[0];
  if (sub === "treasury") {
    return request("GET", "/v1/platform/treasury");
  }
  throw new Error(`Unknown platform subcommand: ${sub || "<empty>"}`);
}

async function handleQuickstart(args) {
  const flags = parseFlags(args);
  const positionalModeRaw = args.find((token) => !String(token || "").startsWith("--"));
  const positionalMode = normalizeScenarioMode(positionalModeRaw);
  const mode = normalizeScenarioMode(flags.mode || positionalMode || "BOTH");
  if (!mode) {
    throw new Error("mode must be BOTH, PAID, or BARTER");
  }
  const modeFlags = modeToFlags(mode);

  return executeBootstrapScenario({
    topicRoot: flags.topic || "a2p",
    providerName: flags["provider-name"] || undefined,
    requesterName: flags["requester-name"] || undefined,
    createPaid: modeFlags.createPaid,
    createBarter: modeFlags.createBarter,
    paidPrice: parsePositiveNumber(flags["paid-price"], 2, "paid-price"),
    maxBudget: parsePositiveNumber(flags["max-budget"], 6, "max-budget"),
    fundAmount: parsePositiveNumber(flags.fund, 24, "fund"),
    paidQuestion: flags["paid-question"] || undefined,
    barterRequest: flags["barter-request"] || undefined,
    barterOffer: flags["barter-offer"] || undefined,
    barterDueHours: parsePositiveNumber(flags["barter-due-hours"], 72, "barter-due-hours"),
    barterQuestion: flags["barter-question"] || undefined
  });
}

async function runTuiProcess() {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const tuiPath = fileURLToPath(new URL("./mammoth-tui.mjs", import.meta.url));

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tuiPath], {
      stdio: "inherit",
      env: process.env
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`tui exited with code ${code}`));
    });
  });
}

async function main() {
  const parsed = parseGlobalArgs(process.argv.slice(2));
  if (parsed.options.noColor) {
    COLOR_ENABLED = false;
  }

  const args = parsed.args;
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  let payload;
  let label = command;

  if (command === "health") {
    payload = await request("GET", "/health");
    label = "health";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "tui") {
    await runTuiProcess();
    return;
  }

  if (command === "node" && args[1] === "info") {
    payload = await request("GET", "/v1/node/info");
    label = "node info";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "status") {
    payload = await request("GET", "/v1/observer/summary");
    label = "status";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "platform") {
    payload = await handlePlatform(args.slice(1));
    label = `platform ${args[1] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "setup") {
    payload = await handleQuickstart(args.slice(1));
    label = "setup";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "onboard") {
    const flags = parseFlags(args.slice(1));
    if (flags.auto || !process.stdin.isTTY) {
      payload = await handleQuickstart(args.slice(1));
      label = "onboard";
      printResult(label, payload, parsed.options);
      return;
    }
    payload = await runWizard();
    label = "onboard";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "quickstart") {
    payload = await handleQuickstart(args.slice(1));
    label = "quickstart";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "wizard") {
    payload = await runWizard();
    label = "wizard";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "doctor") {
    payload = await runDoctor();
    label = "doctor";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "agent") {
    payload = await handleAgent(args.slice(1));
    label = `agent ${args[1] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "intent") {
    payload = await handleIntent(args.slice(1));
    label = `intent ${args[1] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "action") {
    payload = await handleAction(args.slice(1));
    label = `action ${args[1] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "run") {
    const flags = parseFlags(args.slice(1));
    const agentId = requireFlag(flags, "agent-id");
    const intentId = requireFlag(flags, "intent-id");
    const baseFee = parseNumber(flags["base-fee"], 10);
    const qualitySignal = flags.quality !== undefined ? parseNumber(flags.quality, 0.9) : undefined;
    payload = await request("POST", "/v1/actions/run", { agentId, intentId, baseFee, qualitySignal }, { token: DEFAULT_TOKEN, role: "agent" });
    label = "run";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "a2a") {
    payload = await handleA2A(args.slice(1));
    label = `a2a ${args[1] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "claim") {
    payload = await handleClaim(args.slice(1));
    label = `claim ${args[1] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "peer") {
    payload = await handlePeer(args.slice(1));
    label = `peer ${args[1] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "market") {
    payload = await handleMarket(args.slice(1));
    label = `market ${args[1] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "crypto") {
    payload = await handleCrypto(args.slice(1));
    label = `crypto ${args[1] || ""} ${args[2] || ""}`.trim();
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "timeline") {
    const flags = parseFlags(args.slice(1));
    const limit = parseNumber(flags.limit, 20);
    payload = await request("GET", `/v1/observer/timeline${toQuery({ limit })}`);
    label = "timeline";
    printResult(label, payload, parsed.options);
    return;
  }

  if (command === "summary") {
    payload = await request("GET", "/v1/observer/summary");
    label = "summary";
    printResult(label, payload, parsed.options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(paint(`[mammoth-cli] ${error.message}`, ANSI.bold, ANSI.red));
  process.exitCode = 1;
});
