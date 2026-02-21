import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const HOST = process.env.MAMMOTH_NODE_HOST || "127.0.0.1";
const PORT = Number(process.env.MAMMOTH_NODE_PORT || "7340");
const TOKEN = process.env.MAMMOTH_NODE_TOKEN || "local-dev-token";
const CLAIM_COOLDOWN_SEC = Number(process.env.MAMMOTH_CLAIM_COOLDOWN_SEC || "86400");
const PEER_SYNC_INTERVAL_SEC = Number(process.env.MAMMOTH_PEER_SYNC_INTERVAL_SEC || "20");
const PEER_SYNC_TIMEOUT_MS = Number(process.env.MAMMOTH_PEER_SYNC_TIMEOUT_MS || "7000");
const MAX_EVENT_HISTORY = Number(process.env.MAMMOTH_MAX_EVENT_HISTORY || "5000");
const ETH_RPC_URL = String(process.env.MAMMOTH_ETH_RPC_URL || "").trim();
const NODE_ETH_TREASURY_ADDRESS = String(process.env.MAMMOTH_NODE_ETH_TREASURY_ADDRESS || "").trim().toLowerCase();
const PLATFORM_TAX_BPS = Number(process.env.MAMMOTH_PLATFORM_TAX_BPS || "250");
const PLATFORM_TAX_LABEL = String(process.env.MAMMOTH_PLATFORM_TAX_LABEL || "mammoth_protocol");
const BARTER_DEFAULT_DUE_HOURS = Number(process.env.MAMMOTH_BARTER_DEFAULT_DUE_HOURS || "72");
const ERC20_TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55aebcce7b3c0";
const ASSET_DECIMALS = {
  CREDIT: 2,
  USDC: 6,
  USDT: 6
};
const ASSET_META = {
  USDC: {
    chainId: 1,
    symbol: "USDC",
    contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    decimals: 6
  },
  USDT: {
    chainId: 1,
    symbol: "USDT",
    contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    decimals: 6
  }
};
const SUPPORTED_ASSETS = new Set(["CREDIT", ...Object.keys(ASSET_META)]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.MAMMOTH_DATA_DIR
  ? path.resolve(process.cwd(), process.env.MAMMOTH_DATA_DIR)
  : path.join(__dirname, "data");
const STATE_FILE = process.env.MAMMOTH_STATE_FILE
  ? path.resolve(process.cwd(), process.env.MAMMOTH_STATE_FILE)
  : path.join(DATA_DIR, "state.json");

const WRITE_ROLES = new Set(["agent", "owner"]);
const OWNER_ONLY_ROUTES = new Set([
  "POST /v1/claims/request",
  "POST /v1/claims/execute",
  "POST /v1/peers/add",
  "POST /v1/peers/ping",
  "POST /v1/peers/sync",
  "POST /v1/agents/policy",
  "POST /v1/agents/fund",
  "POST /v1/p2p/snapshot",
  "POST /v1/agents/wallet/address",
  "POST /v1/crypto/deposits/verify"
]);
const REFUSAL_CODES = new Set([
  "POLICY_DENY",
  "BLOCKED_SENDER",
  "RATE_LIMITED",
  "LOW_REPUTATION",
  "UNSUPPORTED_TOPIC",
  "INSUFFICIENT_STAKE",
  "BUSY",
  "MANUAL_DENY"
]);

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function createDefaultState() {
  const peerSyncIntervalSec = Number.isFinite(PEER_SYNC_INTERVAL_SEC) ? Math.max(5, Math.floor(PEER_SYNC_INTERVAL_SEC)) : 20;
  const peerSyncTimeoutMs = Number.isFinite(PEER_SYNC_TIMEOUT_MS) ? Math.max(1000, Math.floor(PEER_SYNC_TIMEOUT_MS)) : 7000;
  return {
    meta: {
      version: "0.3.0",
      createdAt: nowIso(),
      nodeId: createId("node")
    },
    config: {
      claimCooldownSec: CLAIM_COOLDOWN_SEC,
      maxRunBaseFee: 100000,
      peerSyncIntervalSec,
      peerSyncTimeoutMs
    },
    agents: {},
    intents: {},
    actions: {},
    messages: {},
    claims: {},
    peers: {},
    market: {
      offers: {},
      asks: {},
      executions: {},
      obligations: {}
    },
    platform: {
      label: PLATFORM_TAX_LABEL,
      taxBps: normalizeTaxBps(PLATFORM_TAX_BPS),
      treasury: {
        CREDIT: 0,
        assets: { USDC: 0, USDT: 0 }
      }
    },
    crypto: {
      deposits: {}
    },
    events: []
  };
}

async function ensureStateFile() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(STATE_FILE, "utf8");
  } catch {
    const initial = createDefaultState();
    await writeFile(STATE_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
}

async function loadState() {
  const raw = await readFile(STATE_FILE, "utf8");
  const parsed = JSON.parse(raw);
  const defaultState = createDefaultState();
  const peers = parsed.peers && typeof parsed.peers === "object" ? parsed.peers : {};
  for (const peer of Object.values(peers)) {
    ensurePeerDefaults(peer);
  }
  return {
    meta: {
      ...defaultState.meta,
      ...(parsed.meta || {})
    },
    config: {
      ...defaultState.config,
      ...(parsed.config || {})
    },
    agents: parsed.agents || {},
    intents: parsed.intents || {},
    actions: parsed.actions || {},
    messages: parsed.messages || {},
    claims: parsed.claims || {},
    peers,
    market: {
      offers: parsed.market?.offers || {},
      asks: parsed.market?.asks || {},
      executions: parsed.market?.executions || {},
      obligations: parsed.market?.obligations || {}
    },
    platform: {
      label: parsed.platform?.label || defaultState.platform.label,
      taxBps: normalizeTaxBps(parsed.platform?.taxBps ?? defaultState.platform.taxBps),
      treasury: {
        CREDIT: parsed.platform?.treasury?.CREDIT ?? defaultState.platform.treasury.CREDIT,
        assets: parsed.platform?.treasury?.assets || defaultState.platform.treasury.assets
      }
    },
    crypto: {
      deposits: parsed.crypto?.deposits || {}
    },
    events: Array.isArray(parsed.events) ? parsed.events : []
  };
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) {
      throw new Error("Body too large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function createId(prefix) {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100000);
  return `${prefix}_${ts}_${rand}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function roundByDecimals(value, decimals = 2) {
  const base = 10 ** Math.max(0, Number(decimals || 2));
  return Math.round(Number(value || 0) * base) / base;
}

function roundByAsset(value, asset) {
  const decimals = ASSET_DECIMALS[String(asset || "CREDIT").toUpperCase()] ?? 2;
  return roundByDecimals(value, decimals);
}

function normalizeAddress(address) {
  const raw = String(address || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(raw)) {
    return "";
  }
  return raw;
}

function normalizeTxHash(value) {
  const txHash = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return "";
  }
  return txHash;
}

function parseHexToBigInt(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(raw)) {
    throw new Error(`invalid hex value: ${value}`);
  }
  return BigInt(raw);
}

function formatUnitsToNumber(rawAmount, decimals) {
  const value = BigInt(rawAmount || 0n);
  const factor = 10n ** BigInt(Math.max(0, decimals));
  const whole = value / factor;
  const fraction = value % factor;
  if (fraction === 0n) {
    return Number(whole);
  }
  const fractionPadded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return Number(`${whole.toString()}.${fractionPadded}`);
}

function decodeAddressFromTopic(topicValue) {
  const raw = String(topicValue || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(raw)) {
    return "";
  }
  return `0x${raw.slice(-40)}`;
}

function normalizeAsset(input, fallback = "CREDIT") {
  const asset = String(input || fallback).trim().toUpperCase();
  if (!SUPPORTED_ASSETS.has(asset)) {
    return "";
  }
  return asset;
}

function ensureAssetBalanceMap(map) {
  const target = map && typeof map === "object" ? map : {};
  for (const symbol of Object.keys(ASSET_META)) {
    if (!Number.isFinite(Number(target[symbol]))) {
      target[symbol] = 0;
    }
    target[symbol] = roundByAsset(target[symbol], symbol);
  }
  return target;
}

function ensureAssetTreasuryMap(treasury) {
  if (!treasury.assets || typeof treasury.assets !== "object") {
    treasury.assets = {};
  }
  for (const symbol of Object.keys(ASSET_META)) {
    if (!treasury.assets[symbol] || typeof treasury.assets[symbol] !== "object") {
      treasury.assets[symbol] = { ownerClaimable: 0, operatingReserve: 0, lockedSafety: 0, claimPending: 0 };
    }
    const bucket = treasury.assets[symbol];
    bucket.ownerClaimable = roundByAsset(bucket.ownerClaimable, symbol);
    bucket.operatingReserve = roundByAsset(bucket.operatingReserve, symbol);
    bucket.lockedSafety = roundByAsset(bucket.lockedSafety, symbol);
    bucket.claimPending = roundByAsset(bucket.claimPending, symbol);
  }
}

function getAvailableSpendable(agent, asset) {
  if (asset === "CREDIT") {
    return Number(agent.wallet.spendable || 0);
  }
  ensureAssetBalanceMap(agent.wallet.assets);
  return Number(agent.wallet.assets[asset] || 0);
}

function updateSpendable(agent, asset, delta) {
  if (asset === "CREDIT") {
    agent.wallet.spendable = roundByAsset(Number(agent.wallet.spendable || 0) + Number(delta || 0), "CREDIT");
    return agent.wallet.spendable;
  }
  ensureAssetBalanceMap(agent.wallet.assets);
  agent.wallet.assets[asset] = roundByAsset(Number(agent.wallet.assets[asset] || 0) + Number(delta || 0), asset);
  return agent.wallet.assets[asset];
}

function normalizeTaxBps(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clamp(Math.floor(parsed), 0, 5000);
}

function normalizeMarketMode(value, fallback = "PAID") {
  const mode = String(value || fallback).trim().toUpperCase();
  if (mode === "FREE" || mode === "PAID" || mode === "BARTER") {
    return mode;
  }
  return "";
}

function normalizeModePreference(value, fallback = "ANY") {
  const mode = String(value || fallback).trim().toUpperCase();
  if (mode === "ANY" || mode === "FREE" || mode === "PAID" || mode === "BARTER") {
    return mode;
  }
  return "";
}

function normalizeBarterDueHours(value) {
  const parsed = Number(value);
  const fallback = Number.isFinite(BARTER_DEFAULT_DUE_HOURS) ? Math.max(1, Math.floor(BARTER_DEFAULT_DUE_HOURS)) : 72;
  if (!Number.isFinite(parsed)) {
    return clamp(fallback, 1, 720);
  }
  return clamp(Math.floor(parsed), 1, 720);
}

function createRandomEthAddress() {
  return `0x${randomBytes(20).toString("hex")}`;
}

function ensurePlatformDefaults(state) {
  if (!state.platform || typeof state.platform !== "object") {
    state.platform = {
      label: PLATFORM_TAX_LABEL,
      taxBps: normalizeTaxBps(PLATFORM_TAX_BPS),
      treasury: {
        CREDIT: 0,
        assets: {}
      }
    };
  }
  if (!state.platform.label) {
    state.platform.label = PLATFORM_TAX_LABEL;
  }
  state.platform.taxBps = normalizeTaxBps(state.platform.taxBps ?? PLATFORM_TAX_BPS);
  if (!state.platform.treasury || typeof state.platform.treasury !== "object") {
    state.platform.treasury = { CREDIT: 0, assets: {} };
  }
  if (!Number.isFinite(Number(state.platform.treasury.CREDIT))) {
    state.platform.treasury.CREDIT = 0;
  }
  state.platform.treasury.CREDIT = roundByAsset(state.platform.treasury.CREDIT, "CREDIT");
  state.platform.treasury.assets = ensureAssetBalanceMap(state.platform.treasury.assets);
}

function addPlatformTaxRevenue(state, asset, amount) {
  ensurePlatformDefaults(state);
  const safeAmount = roundByAsset(Number(amount || 0), asset);
  if (safeAmount <= 0) {
    return;
  }
  if (asset === "CREDIT") {
    state.platform.treasury.CREDIT = roundByAsset(Number(state.platform.treasury.CREDIT || 0) + safeAmount, "CREDIT");
    return;
  }
  state.platform.treasury.assets[asset] = roundByAsset(Number(state.platform.treasury.assets[asset] || 0) + safeAmount, asset);
}

function appendEvent(state, eventType, payload, actorRole = "system") {
  const event = {
    eventId: createId("evt"),
    eventType,
    actorRole,
    timestamp: nowIso(),
    payload
  };
  state.events.push(event);
  const maxEvents = Number.isFinite(Number(MAX_EVENT_HISTORY)) ? Math.max(100, Math.floor(Number(MAX_EVENT_HISTORY))) : 5000;
  if (state.events.length > maxEvents) {
    state.events = state.events.slice(-maxEvents);
  }
  return event;
}

function parsePathParam(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const rest = pathname.slice(prefix.length);
  if (!rest || rest.includes("/")) {
    return null;
  }
  return decodeURIComponent(rest);
}

function parseNumber(input, defaultValue) {
  if (input === undefined || input === null || input === "") {
    return defaultValue;
  }
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function ensureAgentDefaults(agent) {
  if (!agent.treasury) {
    agent.treasury = { ownerClaimable: 0, operatingReserve: 0, lockedSafety: 0, claimPending: 0 };
  }
  if (agent.treasury.claimPending === undefined) {
    agent.treasury.claimPending = 0;
  }
  if (!agent.policy) {
    agent.policy = {
      autoRefuseMinReputation: 0,
      blockedSenders: []
    };
  }
  if (!Array.isArray(agent.policy.blockedSenders)) {
    agent.policy.blockedSenders = [];
  }
  if (!agent.wallet) {
    agent.wallet = {
      spendable: 0,
      spent: 0,
      earnedGross: 0
    };
  }
  if (!Number.isFinite(Number(agent.wallet.spendable))) {
    agent.wallet.spendable = 0;
  }
  if (!Number.isFinite(Number(agent.wallet.spent))) {
    agent.wallet.spent = 0;
  }
  if (!Number.isFinite(Number(agent.wallet.earnedGross))) {
    agent.wallet.earnedGross = 0;
  }
  agent.wallet.assets = ensureAssetBalanceMap(agent.wallet.assets);
  agent.wallet.spentAssets = ensureAssetBalanceMap(agent.wallet.spentAssets);
  agent.wallet.earnedGrossAssets = ensureAssetBalanceMap(agent.wallet.earnedGrossAssets);
  if (!agent.wallet.addresses || typeof agent.wallet.addresses !== "object") {
    agent.wallet.addresses = {};
  }
  if (!agent.wallet.addresses.eth) {
    agent.wallet.addresses.eth = createRandomEthAddress();
  }
  ensureAssetTreasuryMap(agent.treasury);
}

function ensureMarketDefaults(state) {
  if (!state.market || typeof state.market !== "object") {
    state.market = {
      offers: {},
      asks: {},
      executions: {},
      obligations: {}
    };
    return;
  }
  if (!state.market.offers || typeof state.market.offers !== "object") {
    state.market.offers = {};
  }
  if (!state.market.asks || typeof state.market.asks !== "object") {
    state.market.asks = {};
  }
  if (!state.market.executions || typeof state.market.executions !== "object") {
    state.market.executions = {};
  }
  if (!state.market.obligations || typeof state.market.obligations !== "object") {
    state.market.obligations = {};
  }
}

function ensureCryptoDefaults(state) {
  if (!state.crypto || typeof state.crypto !== "object") {
    state.crypto = { deposits: {} };
    return;
  }
  if (!state.crypto.deposits || typeof state.crypto.deposits !== "object") {
    state.crypto.deposits = {};
  }
}

function buildSummary(state) {
  ensurePlatformDefaults(state);
  const agents = Object.values(state.agents);
  const intents = Object.values(state.intents);
  const actions = Object.values(state.actions);
  const claims = Object.values(state.claims);
  const messages = Object.values(state.messages);
  const peers = Object.values(state.peers || {});
  const offers = Object.values(state.market?.offers || {});
  const asks = Object.values(state.market?.asks || {});
  const executions = Object.values(state.market?.executions || {});
  const obligations = Object.values(state.market?.obligations || {});
  const deposits = Object.values(state.crypto?.deposits || {});

  const executedActions = actions.filter((item) => item.status === "EXECUTED");
  const avgRep = agents.length > 0 ? round2(agents.reduce((acc, item) => acc + Number(item.reputation || 0), 0) / agents.length) : 0;
  const totalPayout = round2(executedActions.reduce((acc, item) => acc + Number(item.settlement?.payout || 0), 0));
  const marketVolume = round2(executions.reduce((acc, item) => acc + Number(item.price || 0), 0));
  const marketPaidExecutions = executions.filter((item) => Number(item.price || 0) > 0).length;
  const platformRevenueCredit = roundByAsset(state.platform.treasury.CREDIT || 0, "CREDIT");
  const platformRevenueUsdc = roundByAsset(state.platform.treasury.assets.USDC || 0, "USDC");
  const platformRevenueUsdt = roundByAsset(state.platform.treasury.assets.USDT || 0, "USDT");

  return {
    nodeId: state.meta.nodeId,
    agents: agents.length,
    intents: intents.length,
    openIntents: intents.filter((item) => item.status === "OPEN").length,
    executedActions: executedActions.length,
    messages: messages.length,
    pendingMessages: messages.filter((item) => item.status === "PENDING").length,
    claims: claims.length,
    claimRequested: claims.filter((item) => item.status === "REQUESTED").length,
    claimExecuted: claims.filter((item) => item.status === "EXECUTED").length,
    peers: peers.length,
    peersOnline: peers.filter((item) => item.status === "ONLINE").length,
    averageReputation: avgRep,
    totalPayout,
    marketOffers: offers.length,
    marketAsks: asks.length,
    marketPaidExecutions,
    marketVolume,
    marketObligations: obligations.length,
    marketOpenObligations: obligations.filter((item) => item.status === "OPEN" || item.status === "SUBMITTED").length,
    marketFulfilledObligations: obligations.filter((item) => item.status === "FULFILLED").length,
    cryptoDeposits: deposits.length,
    platformTaxBps: state.platform.taxBps,
    platformRevenueCredit,
    platformRevenueUSDC: platformRevenueUsdc,
    platformRevenueUSDT: platformRevenueUsdt
  };
}

function marketSortCandidates(candidates, strategy) {
  const mode = String(strategy || "best_value").trim().toLowerCase();
  const safe = candidates.map((item) => {
    const price = Number(item.price || 0);
    const quality = Number(item.qualityScore || 0);
    const normalizedPrice = price <= 0 ? 0.5 : price;
    return {
      ...item,
      price,
      quality,
      valueScore: round2(quality / normalizedPrice)
    };
  });

  if (mode === "cheapest") {
    return safe.sort((a, b) => a.price - b.price || b.quality - a.quality);
  }
  if (mode === "highest_quality") {
    return safe.sort((a, b) => b.quality - a.quality || a.price - b.price);
  }
  return safe.sort((a, b) => b.valueScore - a.valueScore || a.price - b.price || b.quality - a.quality);
}

function marketQualitySignal(providerRep, offerQualityHint) {
  const base = clamp((Number(providerRep || 0) * 0.7) + (Number(offerQualityHint || 0.7) * 0.3), 0, 1);
  const noise = (Math.random() - 0.5) * 0.08;
  return round2(clamp(base + noise, 0, 1));
}

function buildMarketAnswer({ question, topic, providerName, mode, qualitySignal }) {
  const confidence = Math.round(Number(qualitySignal || 0.7) * 100);
  const depth = mode === "FREE" ? "Quick answer" : mode === "BARTER" ? "Collaborative answer" : "Detailed answer";
  const focus = String(topic || "general").trim() || "general";
  const q = String(question || "").trim();
  return `[${depth}] ${providerName} answered on ${focus}. Question: "${q}". Confidence ${confidence}%. Includes summary, checks, and risks.`;
}

function detectContactRefusal(state, fromAgentId, toAgent) {
  ensureAgentDefaults(toAgent);

  if (toAgent.policy.blockedSenders.includes(fromAgentId)) {
    return "BLOCKED_SENDER";
  }

  const fromAgent = state.agents[fromAgentId];
  const fromRep = fromAgent ? Number(fromAgent.reputation || 0) : 0;
  if (fromRep < Number(toAgent.policy.autoRefuseMinReputation || 0)) {
    return "LOW_REPUTATION";
  }

  return null;
}

async function pingPeer(peerUrl, peerToken) {
  const response = await fetch(`${peerUrl.replace(/\/$/, "")}/health`, {
    method: "GET",
    headers: {
      "x-mammoth-token": peerToken || TOKEN
    }
  });
  if (!response.ok) {
    throw new Error(`Peer health check failed (${response.status})`);
  }
  return response.json();
}

async function tryRelayContactOffer(body, message) {
  const peerUrl = String(body.peerUrl || "").trim();
  if (!peerUrl) {
    return { relayed: false };
  }

  const relayBody = {
    fromNodeId: body.fromNodeId || "local",
    fromAgentId: message.fromAgentId,
    fromReputation: body.fromReputation,
    toAgentId: message.toAgentId,
    topic: message.topic,
    intentId: message.intentId,
    payload: message.payload
  };

  const relayRes = await fetch(`${peerUrl.replace(/\/$/, "")}/v1/p2p/contact-offer`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mammoth-token": body.peerToken || TOKEN,
      "x-mammoth-role": "agent"
    },
    body: JSON.stringify(relayBody)
  });

  if (!relayRes.ok) {
    const text = await relayRes.text();
    throw new Error(`relay failed (${relayRes.status}): ${text}`);
  }

  const relayPayload = await relayRes.json();
  return { relayed: true, relayPayload };
}

function toTimestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function entityVersionMs(entity) {
  if (!entity || typeof entity !== "object") {
    return 0;
  }
  return Math.max(
    toTimestampMs(entity.updatedAt),
    toTimestampMs(entity.deliveredAt),
    toTimestampMs(entity.executeAfter),
    toTimestampMs(entity.createdAt),
    toTimestampMs(entity.timestamp)
  );
}

function shouldReplaceEntity(localEntity, remoteEntity) {
  if (!localEntity) {
    return true;
  }
  const localMs = entityVersionMs(localEntity);
  const remoteMs = entityVersionMs(remoteEntity);
  if (remoteMs > localMs) {
    return true;
  }
  if (remoteMs < localMs) {
    return false;
  }
  const localSize = JSON.stringify(localEntity).length;
  const remoteSize = JSON.stringify(remoteEntity).length;
  return remoteSize > localSize;
}

function mergeEntityMap(localMap, remoteMap) {
  const stats = {
    inserted: 0,
    updated: 0
  };
  for (const [id, remoteEntity] of Object.entries(remoteMap || {})) {
    const localEntity = localMap[id];
    if (!localEntity) {
      localMap[id] = remoteEntity;
      stats.inserted += 1;
      continue;
    }
    if (shouldReplaceEntity(localEntity, remoteEntity)) {
      localMap[id] = remoteEntity;
      stats.updated += 1;
    }
  }
  return stats;
}

function ensurePeerDefaults(peer) {
  if (!peer || typeof peer !== "object") {
    return;
  }
  if (peer.autoSync === undefined) {
    peer.autoSync = true;
  }
  if (peer.lastSyncAt === undefined) {
    peer.lastSyncAt = null;
  }
  if (peer.lastSyncStatus === undefined) {
    peer.lastSyncStatus = "NEVER";
  }
  if (peer.lastSyncError === undefined) {
    peer.lastSyncError = null;
  }
  if (peer.authToken === undefined) {
    peer.authToken = "";
  }
}

function toPublicPeer(peer) {
  const safe = { ...(peer || {}) };
  safe.hasAuthToken = Boolean(String(safe.authToken || ""));
  delete safe.authToken;
  return safe;
}

function mergeEvents(state, remoteEvents) {
  const existing = new Set(state.events.map((event) => String(event.eventId || "")));
  let added = 0;

  for (const event of remoteEvents || []) {
    if (!event || typeof event !== "object") {
      continue;
    }
    const eventId = String(event.eventId || "").trim();
    if (!eventId || existing.has(eventId)) {
      continue;
    }
    state.events.push(event);
    existing.add(eventId);
    added += 1;
  }

  state.events.sort((a, b) => toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp));
  const maxEvents = Number.isFinite(Number(MAX_EVENT_HISTORY)) ? Math.max(100, Math.floor(Number(MAX_EVENT_HISTORY))) : 5000;
  if (state.events.length > maxEvents) {
    state.events = state.events.slice(-maxEvents);
  }
  return added;
}

function buildSyncSnapshot(state) {
  ensureMarketDefaults(state);
  ensureCryptoDefaults(state);
  ensurePlatformDefaults(state);
  if (!state.crypto || typeof state.crypto !== "object") {
    state.crypto = { deposits: {} };
  }
  if (!state.crypto.deposits || typeof state.crypto.deposits !== "object") {
    state.crypto.deposits = {};
  }
  const peers = Object.fromEntries(
    Object.entries(state.peers || {}).map(([peerId, peer]) => [peerId, toPublicPeer(peer)])
  );

  return {
    nodeId: state.meta.nodeId,
    exportedAt: nowIso(),
    summary: buildSummary(state),
    data: {
      agents: state.agents,
      intents: state.intents,
      actions: state.actions,
      messages: state.messages,
      claims: state.claims,
      market: {
        offers: state.market?.offers || {},
        asks: state.market?.asks || {},
        executions: state.market?.executions || {},
        obligations: state.market?.obligations || {}
      },
      platform: state.platform,
      crypto: {
        deposits: state.crypto.deposits
      },
      events: state.events,
      peers
    }
  };
}

function mergeSnapshotIntoState(state, snapshot) {
  ensureMarketDefaults(state);
  ensurePlatformDefaults(state);
  if (!state.crypto || typeof state.crypto !== "object") {
    state.crypto = { deposits: {} };
  }
  if (!state.crypto.deposits || typeof state.crypto.deposits !== "object") {
    state.crypto.deposits = {};
  }
  const data = snapshot?.data && typeof snapshot.data === "object" ? snapshot.data : {};
  const market = data.market && typeof data.market === "object" ? data.market : {};
  const platform = data.platform && typeof data.platform === "object" ? data.platform : {};
  const crypto = data.crypto && typeof data.crypto === "object" ? data.crypto : {};

  const merged = {
    agents: mergeEntityMap(state.agents, data.agents || {}),
    intents: mergeEntityMap(state.intents, data.intents || {}),
    actions: mergeEntityMap(state.actions, data.actions || {}),
    messages: mergeEntityMap(state.messages, data.messages || {}),
    claims: mergeEntityMap(state.claims, data.claims || {}),
    offers: mergeEntityMap(state.market.offers, market.offers || {}),
    asks: mergeEntityMap(state.market.asks, market.asks || {}),
    executions: mergeEntityMap(state.market.executions, market.executions || {}),
    obligations: mergeEntityMap(state.market.obligations, market.obligations || {}),
    deposits: mergeEntityMap(state.crypto.deposits, crypto.deposits || {}),
    platform: { updated: 0 },
    peers: { inserted: 0, updated: 0 },
    eventsAdded: mergeEvents(state, data.events || [])
  };

  if (platform && Object.keys(platform).length > 0) {
    const remoteTaxBps = normalizeTaxBps(platform.taxBps ?? state.platform.taxBps);
    if (remoteTaxBps > state.platform.taxBps) {
      state.platform.taxBps = remoteTaxBps;
      merged.platform.updated += 1;
    }
    if (platform.label && String(platform.label).trim()) {
      state.platform.label = String(platform.label).trim();
    }
    if (platform.treasury && typeof platform.treasury === "object") {
      const remoteCredit = Number(platform.treasury.CREDIT || 0);
      if (remoteCredit > Number(state.platform.treasury.CREDIT || 0)) {
        state.platform.treasury.CREDIT = roundByAsset(remoteCredit, "CREDIT");
        merged.platform.updated += 1;
      }
      const remoteAssets = ensureAssetBalanceMap(platform.treasury.assets || {});
      for (const symbol of Object.keys(remoteAssets)) {
        if (Number(remoteAssets[symbol] || 0) > Number(state.platform.treasury.assets[symbol] || 0)) {
          state.platform.treasury.assets[symbol] = roundByAsset(remoteAssets[symbol], symbol);
          merged.platform.updated += 1;
        }
      }
    }
  }

  for (const [peerId, remotePeerRaw] of Object.entries(data.peers || {})) {
    const remotePeer = { ...(remotePeerRaw || {}) };
    if (!peerId || !remotePeer.url) {
      continue;
    }
    const localPeer = state.peers[peerId];
    if (!localPeer) {
      state.peers[peerId] = {
        peerId,
        url: String(remotePeer.url),
        status: String(remotePeer.status || "DISCOVERED"),
        addedAt: String(remotePeer.addedAt || nowIso()),
        lastSeenAt: remotePeer.lastSeenAt || null,
        lastSyncAt: remotePeer.lastSyncAt || null,
        lastSyncStatus: String(remotePeer.lastSyncStatus || "NEVER"),
        lastSyncError: remotePeer.lastSyncError || null,
        autoSync: remotePeer.autoSync !== false,
        authToken: ""
      };
      merged.peers.inserted += 1;
      continue;
    }
    ensurePeerDefaults(localPeer);

    const localPeerMs = Math.max(toTimestampMs(localPeer.lastSyncAt), toTimestampMs(localPeer.lastSeenAt), toTimestampMs(localPeer.addedAt));
    const remotePeerMs = Math.max(toTimestampMs(remotePeer.lastSyncAt), toTimestampMs(remotePeer.lastSeenAt), toTimestampMs(remotePeer.addedAt));
    if (remotePeerMs > localPeerMs) {
      localPeer.url = String(remotePeer.url || localPeer.url);
      localPeer.status = String(remotePeer.status || localPeer.status || "ONLINE");
      localPeer.lastSeenAt = remotePeer.lastSeenAt || localPeer.lastSeenAt;
      localPeer.lastSyncAt = remotePeer.lastSyncAt || localPeer.lastSyncAt;
      localPeer.lastSyncStatus = String(remotePeer.lastSyncStatus || localPeer.lastSyncStatus || "OK");
      localPeer.lastSyncError = remotePeer.lastSyncError || null;
      localPeer.autoSync = localPeer.autoSync !== false;
      merged.peers.updated += 1;
    }
  }

  const totalChanges =
    merged.agents.inserted +
    merged.agents.updated +
    merged.intents.inserted +
    merged.intents.updated +
    merged.actions.inserted +
    merged.actions.updated +
    merged.messages.inserted +
    merged.messages.updated +
    merged.claims.inserted +
    merged.claims.updated +
    merged.offers.inserted +
    merged.offers.updated +
    merged.asks.inserted +
    merged.asks.updated +
    merged.executions.inserted +
    merged.executions.updated +
    merged.obligations.inserted +
    merged.obligations.updated +
    merged.deposits.inserted +
    merged.deposits.updated +
    merged.platform.updated +
    merged.peers.inserted +
    merged.peers.updated +
    merged.eventsAdded;

  return {
    merged,
    totalChanges
  };
}

function sumSyncResults(results) {
  const totals = {
    peers: results.length,
    success: 0,
    failed: 0,
    totalChanges: 0
  };
  for (const result of results) {
    if (result.ok) {
      totals.success += 1;
      totals.totalChanges += Number(result.merge?.totalChanges || 0);
    } else {
      totals.failed += 1;
    }
  }
  return totals;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function requestPeerSnapshot(peerUrl, peerToken, timeoutMs) {
  const response = await fetchWithTimeout(
    `${peerUrl.replace(/\/$/, "")}/v1/p2p/snapshot`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mammoth-token": peerToken || TOKEN,
        "x-mammoth-role": "owner"
      },
      body: JSON.stringify({})
    },
    timeoutMs
  );

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`snapshot failed (${response.status}): ${raw.slice(0, 180)}`);
  }

  const payload = await response.json();
  if (!payload?.ok || !payload?.snapshot) {
    throw new Error("snapshot payload invalid");
  }
  return payload.snapshot;
}

function getAssetMeta(asset, chainId = 1) {
  const symbol = normalizeAsset(asset, "");
  if (!symbol || symbol === "CREDIT") {
    return null;
  }
  const meta = ASSET_META[symbol];
  if (!meta || Number(meta.chainId) !== Number(chainId)) {
    return null;
  }
  return meta;
}

async function callEthRpc(method, params = []) {
  if (!ETH_RPC_URL) {
    throw new Error("MAMMOTH_ETH_RPC_URL is not configured");
  }
  const response = await fetch(ETH_RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params
    })
  });
  if (!response.ok) {
    throw new Error(`eth rpc failed (${response.status})`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`eth rpc error: ${payload.error.message || "unknown"}`);
  }
  return payload.result;
}

function parseTransferLogsToTreasury(receipt, tokenAddress, treasuryAddress) {
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
  const transfers = [];
  for (const log of logs) {
    const contract = normalizeAddress(log?.address || "");
    if (!contract || contract !== tokenAddress) {
      continue;
    }
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    if (topics.length < 3) {
      continue;
    }
    if (String(topics[0] || "").toLowerCase() !== ERC20_TRANSFER_TOPIC0) {
      continue;
    }
    const toAddress = decodeAddressFromTopic(topics[2]);
    if (!toAddress || toAddress !== treasuryAddress) {
      continue;
    }
    const fromAddress = decodeAddressFromTopic(topics[1]);
    let amountRaw = 0n;
    try {
      amountRaw = parseHexToBigInt(String(log?.data || "0x0"));
    } catch {
      amountRaw = 0n;
    }
    if (amountRaw <= 0n) {
      continue;
    }
    transfers.push({
      logIndexHex: String(log?.logIndex || "0x0").toLowerCase(),
      txHash: String(log?.transactionHash || receipt?.transactionHash || "").toLowerCase(),
      fromAddress,
      toAddress,
      amountRaw
    });
  }
  return transfers;
}

async function syncFromPeer(state, peer, options = {}) {
  ensurePeerDefaults(peer);
  const peerId = String(peer.peerId || "");
  const timeoutMsRaw = Number(state.config?.peerSyncTimeoutMs || PEER_SYNC_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(1000, Math.floor(timeoutMsRaw)) : 7000;
  const peerToken = String(options.peerToken || peer.authToken || TOKEN);
  const source = String(options.source || "manual");
  const previousSyncStatus = peer.lastSyncStatus || "NEVER";
  let changed = false;

  try {
    const snapshot = await requestPeerSnapshot(peer.url, peerToken, timeoutMs);
    const merge = mergeSnapshotIntoState(state, snapshot);
    const now = nowIso();
    const shouldTouchSyncMeta =
      source === "manual" ||
      merge.totalChanges > 0 ||
      previousSyncStatus !== "OK" ||
      nowMs() - toTimestampMs(peer.lastSeenAt) >= 60000;

    if (shouldTouchSyncMeta) {
      peer.status = "ONLINE";
      peer.lastSeenAt = now;
      peer.lastSyncAt = now;
      peer.lastSyncStatus = "OK";
      peer.lastSyncError = null;
      changed = true;
    }
    if (options.peerToken && peer.authToken !== String(options.peerToken)) {
      peer.authToken = String(options.peerToken);
      changed = true;
    }

    if (source === "manual" || merge.totalChanges > 0 || previousSyncStatus !== "OK") {
      appendEvent(
        state,
        "peer_sync_ok",
        {
          peerId,
          url: peer.url,
          remoteNodeId: snapshot.nodeId || null,
          totalChanges: merge.totalChanges,
          source
        },
        "system"
      );
    }

    return {
      ok: true,
      changed: changed || merge.totalChanges > 0,
      peerId,
      url: peer.url,
      remoteNodeId: snapshot.nodeId || null,
      merge
    };
  } catch (error) {
    const now = nowIso();
    const shouldTouchErrorMeta =
      source === "manual" ||
      previousSyncStatus !== "FAILED" ||
      nowMs() - toTimestampMs(peer.lastSyncAt) >= 60000 ||
      peer.lastSyncError !== error.message;

    if (shouldTouchErrorMeta) {
      peer.status = "OFFLINE";
      peer.lastSyncAt = now;
      peer.lastSyncStatus = "FAILED";
      peer.lastSyncError = error.message;
      changed = true;
    }

    if (source === "manual" || previousSyncStatus !== "FAILED") {
      appendEvent(state, "peer_sync_failed", { peerId, url: peer.url, error: error.message, source }, "system");
      changed = true;
    }

    return {
      ok: false,
      changed,
      peerId,
      url: peer.url,
      error: error.message
    };
  }
}

async function syncPeers(state, peerList, options = {}) {
  const results = [];
  for (const peer of peerList) {
    const result = await syncFromPeer(state, peer, options);
    results.push(result);
  }
  return {
    results,
    totals: sumSyncResults(results)
  };
}

function verifyWriteAccess(req, method, pathname) {
  if (method === "GET" || method === "HEAD") {
    return { ok: true, role: "read" };
  }

  const token = req.headers["x-mammoth-token"];
  if (!token || token !== TOKEN) {
    return { ok: false, status: 401, error: "Unauthorized: invalid x-mammoth-token" };
  }

  const role = String(req.headers["x-mammoth-role"] || "");
  if (!WRITE_ROLES.has(role)) {
    return { ok: false, status: 403, error: "Forbidden: write route requires role=agent|owner" };
  }

  const signature = `${method} ${pathname}`;
  if (OWNER_ONLY_ROUTES.has(signature) && role !== "owner") {
    return { ok: false, status: 403, error: "Forbidden: owner role required" };
  }

  return { ok: true, role };
}

async function route(req, res, state) {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "mammoth-node-daemon",
      host: HOST,
      port: PORT,
      now: nowIso(),
      nodeId: state.meta.nodeId
    });
    return;
  }

  const access = verifyWriteAccess(req, method, pathname);
  if (!access.ok) {
    sendJson(res, access.status, { error: access.error });
    return;
  }

  ensureMarketDefaults(state);

  if (method === "GET" && pathname === "/v1/node/info") {
    sendJson(res, 200, {
      ok: true,
      meta: state.meta,
      config: state.config,
      summary: buildSummary(state)
    });
    return;
  }

  if (method === "GET" && pathname === "/v1/platform/treasury") {
    ensurePlatformDefaults(state);
    sendJson(res, 200, {
      ok: true,
      platform: {
        label: state.platform.label,
        taxBps: state.platform.taxBps,
        treasury: state.platform.treasury
      }
    });
    return;
  }

  if (method === "POST" && pathname === "/v1/agents/register") {
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    const topics = Array.isArray(body.topics) ? body.topics.map((value) => String(value)) : [];
    const autoRefuseMinReputation = clamp(parseNumber(body.autoRefuseMinReputation, 0), 0, 1);

    if (!name) {
      sendJson(res, 400, { error: "name is required" });
      return;
    }

    const agentId = createId("agent");
    const autoEthAddress = createRandomEthAddress();
    const agent = {
      agentId,
      name,
      topics,
      status: "ACTIVE",
      reputation: 0.5,
      treasury: {
        ownerClaimable: 0,
        operatingReserve: 0,
        lockedSafety: 0,
        claimPending: 0
      },
      wallet: {
        spendable: 0,
        spent: 0,
        earnedGross: 0,
        assets: { USDC: 0, USDT: 0 },
        spentAssets: { USDC: 0, USDT: 0 },
        earnedGrossAssets: { USDC: 0, USDT: 0 },
        addresses: { eth: autoEthAddress }
      },
      policy: {
        autoRefuseMinReputation,
        blockedSenders: []
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    state.agents[agentId] = agent;
    appendEvent(state, "agent_registered", { agentId, name, topics }, access.role);
    appendEvent(state, "agent_wallet_generated", { agentId, chain: "ETH", address: autoEthAddress, mode: "auto_on_register" }, "system");
    await saveState(state);

    sendJson(res, 201, { ok: true, agent });
    return;
  }

  if (method === "POST" && pathname === "/v1/agents/policy") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const agent = state.agents[agentId];

    if (!agent) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }

    ensureAgentDefaults(agent);

    if (body.autoRefuseMinReputation !== undefined) {
      const value = parseNumber(body.autoRefuseMinReputation, 0);
      if (!Number.isFinite(value)) {
        sendJson(res, 400, { error: "autoRefuseMinReputation must be a number" });
        return;
      }
      agent.policy.autoRefuseMinReputation = clamp(value, 0, 1);
    }

    if (Array.isArray(body.blockedSenders)) {
      agent.policy.blockedSenders = [...new Set(body.blockedSenders.map((item) => String(item)))];
    }

    agent.updatedAt = nowIso();
    appendEvent(state, "agent_policy_updated", { agentId, policy: agent.policy }, access.role);
    await saveState(state);

    sendJson(res, 200, { ok: true, agent });
    return;
  }

  if (method === "POST" && pathname === "/v1/agents/fund") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const amountRaw = Number(body.amount || 0);
    const asset = normalizeAsset(body.asset, "CREDIT");
    const note = String(body.note || "owner_funding").trim();

    const agent = state.agents[agentId];
    if (!agent) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    if (!asset) {
      sendJson(res, 400, { error: "asset must be CREDIT, USDC, or USDT" });
      return;
    }
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
      sendJson(res, 400, { error: "amount must be > 0" });
      return;
    }

    ensureAgentDefaults(agent);
    const amount = roundByAsset(amountRaw, asset);
    const before = getAvailableSpendable(agent, asset);
    const after = updateSpendable(agent, asset, amount);
    agent.updatedAt = nowIso();

    const payload =
      asset === "CREDIT"
        ? { agentId, asset, amount, spendableBefore: before, spendableAfter: after, note }
        : { agentId, asset, amount, assetBalanceBefore: before, assetBalanceAfter: after, note };

    appendEvent(
      state,
      "agent_funded",
      payload,
      access.role
    );
    await saveState(state);

    sendJson(res, 200, { ok: true, agent });
    return;
  }

  if (method === "POST" && pathname === "/v1/agents/wallet/address") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const chain = String(body.chain || "ETH").trim().toUpperCase();
    const ethAddress = normalizeAddress(body.address || body.ethAddress || "");

    const agent = state.agents[agentId];
    if (!agent) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    if (chain !== "ETH") {
      sendJson(res, 400, { error: "only ETH chain is supported" });
      return;
    }
    if (!ethAddress) {
      sendJson(res, 400, { error: "valid ETH address is required" });
      return;
    }

    ensureAgentDefaults(agent);
    agent.wallet.addresses.eth = ethAddress;
    agent.updatedAt = nowIso();
    appendEvent(state, "agent_wallet_updated", { agentId, chain, address: ethAddress }, access.role);
    await saveState(state);
    sendJson(res, 200, { ok: true, agent });
    return;
  }

  if (method === "GET" && pathname === "/v1/agents") {
    const topic = String(url.searchParams.get("topic") || "").trim();
    const minReputation = parseNumber(url.searchParams.get("minReputation"), 0);

    const result = Object.values(state.agents).filter((agent) => {
      ensureAgentDefaults(agent);
      if (topic && !Array.isArray(agent.topics)) {
        return false;
      }
      if (topic && !agent.topics.includes(topic)) {
        return false;
      }
      if (Number.isFinite(minReputation) && Number(agent.reputation || 0) < minReputation) {
        return false;
      }
      return true;
    });

    sendJson(res, 200, { ok: true, count: result.length, agents: result });
    return;
  }

  if (method === "GET" && pathname.startsWith("/v1/agents/")) {
    const agentId = parsePathParam(pathname, "/v1/agents/");
    if (!agentId) {
      sendJson(res, 400, { error: "invalid agent id path" });
      return;
    }

    const agent = state.agents[agentId];
    if (!agent) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    ensureAgentDefaults(agent);

    sendJson(res, 200, { ok: true, agent });
    return;
  }

  if (method === "POST" && pathname === "/v1/intents") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const goal = String(body.goal || "").trim();
    const budget = Number(body.budget || 0);
    const constraints = body.constraints && typeof body.constraints === "object" ? body.constraints : {};

    if (!agentId || !state.agents[agentId]) {
      sendJson(res, 400, { error: "valid agentId is required" });
      return;
    }
    if (!goal) {
      sendJson(res, 400, { error: "goal is required" });
      return;
    }
    if (!Number.isFinite(budget) || budget < 0) {
      sendJson(res, 400, { error: "budget must be a non-negative number" });
      return;
    }

    const intentId = createId("intent");
    const intent = {
      intentId,
      agentId,
      goal,
      budget,
      constraints,
      status: "OPEN",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    state.intents[intentId] = intent;
    appendEvent(state, "intent_created", { intentId, agentId, goal, budget }, access.role);
    await saveState(state);

    sendJson(res, 201, { ok: true, intent });
    return;
  }

  if (method === "GET" && pathname === "/v1/intents") {
    const agentId = String(url.searchParams.get("agentId") || "").trim();
    const status = String(url.searchParams.get("status") || "").trim();

    const intents = Object.values(state.intents).filter((intent) => {
      if (agentId && intent.agentId !== agentId) {
        return false;
      }
      if (status && intent.status !== status) {
        return false;
      }
      return true;
    });

    sendJson(res, 200, { ok: true, count: intents.length, intents });
    return;
  }

  if (method === "POST" && pathname === "/v1/actions/run") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const intentId = String(body.intentId || "").trim();
    const baseFee = Number(body.baseFee || 10);

    const agent = state.agents[agentId];
    const intent = state.intents[intentId];

    if (!agent) {
      sendJson(res, 400, { error: "agent not found" });
      return;
    }
    ensureAgentDefaults(agent);
    if (!intent || intent.agentId !== agentId) {
      sendJson(res, 400, { error: "intent not found for agent" });
      return;
    }
    if (intent.status === "EXECUTED") {
      sendJson(res, 409, { error: "intent already executed" });
      return;
    }
    if (!Number.isFinite(baseFee) || baseFee < 0) {
      sendJson(res, 400, { error: "baseFee must be a non-negative number" });
      return;
    }
    if (baseFee > intent.budget) {
      sendJson(res, 400, { error: "policy deny: baseFee exceeds intent budget" });
      return;
    }
    if (baseFee > Number(state.config.maxRunBaseFee || 100000)) {
      sendJson(res, 400, { error: "policy deny: baseFee exceeds node maxRunBaseFee" });
      return;
    }

    const repBefore = Number(agent.reputation || 0);
    const multiplier = clamp(0.8 + 0.7 * repBefore, 0.8, 1.5);
    const payout = round2(baseFee * multiplier);

    const ownerClaimable = round2(payout * 0.4);
    const operatingReserve = round2(payout * 0.4);
    const lockedSafety = round2(payout * 0.2);

    agent.treasury.ownerClaimable = round2(agent.treasury.ownerClaimable + ownerClaimable);
    agent.treasury.operatingReserve = round2(agent.treasury.operatingReserve + operatingReserve);
    agent.treasury.lockedSafety = round2(agent.treasury.lockedSafety + lockedSafety);

    const qualitySignalInput = parseNumber(body.qualitySignal, NaN);
    const qualitySignal = Number.isFinite(qualitySignalInput)
      ? clamp(qualitySignalInput, 0, 1)
      : 0.75 + Math.random() * 0.25;
    const repDelta = round2((qualitySignal - 0.8) * 0.08);
    agent.reputation = round2(clamp(repBefore + repDelta, 0, 1));
    agent.updatedAt = nowIso();

    intent.status = "EXECUTED";
    intent.updatedAt = nowIso();

    const actionId = createId("action");
    const receiptRef = createId("receipt");

    const action = {
      actionId,
      intentId,
      agentId,
      status: "EXECUTED",
      createdAt: nowIso(),
      settlement: {
        baseFee: round2(baseFee),
        multiplier: round2(multiplier),
        payout,
        ownerClaimable,
        operatingReserve,
        lockedSafety
      },
      poa: {
        receiptRef,
        status: "SIGNED",
        timestamp: nowIso()
      },
      qualitySignal: round2(qualitySignal)
    };
    state.actions[actionId] = action;

    appendEvent(state, "action_executed", { actionId, intentId, agentId, payout }, access.role);
    appendEvent(state, "poa_recorded", { actionId, receiptRef }, "system");
    appendEvent(
      state,
      "settlement_posted",
      { actionId, ownerClaimable, operatingReserve, lockedSafety, repBefore, repAfter: agent.reputation },
      "system"
    );
    await saveState(state);

    sendJson(res, 200, { ok: true, action, agent });
    return;
  }

  if (method === "GET" && pathname === "/v1/actions") {
    const agentId = String(url.searchParams.get("agentId") || "").trim();
    const actions = Object.values(state.actions).filter((action) => {
      if (agentId && action.agentId !== agentId) {
        return false;
      }
      return true;
    });
    sendJson(res, 200, { ok: true, count: actions.length, actions });
    return;
  }

  if (method === "POST" && pathname === "/v1/market/offers") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const topic = String(body.topic || "").trim();
    const mode = normalizeMarketMode(body.mode, "PAID");
    const asset = normalizeAsset(body.asset, "CREDIT");
    const priceInput = parseNumber(body.pricePerQuestion, mode === "FREE" || mode === "BARTER" ? 0 : 1);
    const qualityInput = parseNumber(body.qualityHint, 0.7);
    const barterRequest = String(body.barterRequest || "").trim();
    const barterDueHours = normalizeBarterDueHours(body.barterDueHours);

    const agent = state.agents[agentId];
    if (!agent) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    if (!topic) {
      sendJson(res, 400, { error: "topic is required" });
      return;
    }
    if (!asset) {
      sendJson(res, 400, { error: "asset must be CREDIT, USDC, or USDT" });
      return;
    }
    if (!mode) {
      sendJson(res, 400, { error: "mode must be FREE, PAID, or BARTER" });
      return;
    }
    if (!Number.isFinite(priceInput) || priceInput < 0) {
      sendJson(res, 400, { error: "pricePerQuestion must be a non-negative number" });
      return;
    }
    if (mode === "PAID" && priceInput <= 0) {
      sendJson(res, 400, { error: "pricePerQuestion must be > 0 for PAID mode" });
      return;
    }
    if (mode === "BARTER" && !barterRequest) {
      sendJson(res, 400, { error: "barterRequest is required for BARTER mode" });
      return;
    }
    if (!Number.isFinite(qualityInput)) {
      sendJson(res, 400, { error: "qualityHint must be a number" });
      return;
    }

    ensureAgentDefaults(agent);
    const existing = Object.values(state.market.offers).find((offer) => offer.agentId === agentId && offer.topic === topic && (offer.asset || "CREDIT") === asset);
    const offerId = existing?.offerId || createId("offer");

    const offer = {
      offerId,
      agentId,
      topic,
      mode,
      asset,
      pricePerQuestion: mode === "FREE" || mode === "BARTER" ? 0 : roundByAsset(priceInput, asset),
      qualityHint: round2(clamp(qualityInput, 0, 1)),
      barterRequest: mode === "BARTER" ? barterRequest : null,
      barterDueHours: mode === "BARTER" ? barterDueHours : null,
      status: "ACTIVE",
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso()
    };

    state.market.offers[offerId] = offer;
    appendEvent(
      state,
      "market_offer_upserted",
      {
        offerId,
        agentId,
        topic,
        mode,
        asset,
        pricePerQuestion: offer.pricePerQuestion,
        barterRequest: offer.barterRequest,
        barterDueHours: offer.barterDueHours
      },
      access.role
    );
    await saveState(state);

    sendJson(res, 200, { ok: true, offer });
    return;
  }

  if (method === "GET" && pathname === "/v1/market/offers") {
    const topic = String(url.searchParams.get("topic") || "").trim();
    const agentId = String(url.searchParams.get("agentId") || "").trim();
    const mode = String(url.searchParams.get("mode") || "").trim().toUpperCase();
    const status = String(url.searchParams.get("status") || "").trim().toUpperCase();
    const asset = String(url.searchParams.get("asset") || "").trim().toUpperCase();

    const offers = Object.values(state.market.offers)
      .filter((offer) => {
        if (topic && offer.topic !== topic) {
          return false;
        }
        if (agentId && offer.agentId !== agentId) {
          return false;
        }
        if (mode && offer.mode !== mode) {
          return false;
        }
        if (asset && String(offer.asset || "CREDIT").toUpperCase() !== asset) {
          return false;
        }
        if (status && String(offer.status || "").toUpperCase() !== status) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    sendJson(res, 200, { ok: true, count: offers.length, offers });
    return;
  }

  if (method === "POST" && pathname === "/v1/market/ask") {
    const body = await readJsonBody(req);
    const requesterAgentId = String(body.requesterAgentId || "").trim();
    const topic = String(body.topic || "").trim();
    const question = String(body.question || "").trim();
    const asset = normalizeAsset(body.asset, "CREDIT");
    const maxBudgetRaw = parseNumber(body.maxBudget, 0);
    const strategy = String(body.strategy || "best_value").trim().toLowerCase();
    const autoExecute = body.autoExecute !== false;
    const modePreference = normalizeModePreference(body.modePreference, "ANY");
    const barterOffer = String(body.barterOffer || "").trim();

    const requester = state.agents[requesterAgentId];
    if (!requester) {
      sendJson(res, 404, { error: "requester agent not found" });
      return;
    }
    if (!topic) {
      sendJson(res, 400, { error: "topic is required" });
      return;
    }
    if (!question) {
      sendJson(res, 400, { error: "question is required" });
      return;
    }
    if (!asset) {
      sendJson(res, 400, { error: "asset must be CREDIT, USDC, or USDT" });
      return;
    }
    if (!modePreference) {
      sendJson(res, 400, { error: "modePreference must be ANY, FREE, PAID, or BARTER" });
      return;
    }
    if (!Number.isFinite(maxBudgetRaw) || maxBudgetRaw < 0) {
      sendJson(res, 400, { error: "maxBudget must be a non-negative number" });
      return;
    }
    if (modePreference === "BARTER" && !barterOffer) {
      sendJson(res, 400, { error: "barterOffer is required when modePreference is BARTER" });
      return;
    }

    ensureAgentDefaults(requester);
    const maxBudget = roundByAsset(maxBudgetRaw, asset);

    const askId = createId("ask");
    const ask = {
      askId,
      requesterAgentId,
      topic,
      question,
      asset,
      maxBudget,
      strategy,
      status: "OPEN",
      selectedOfferId: null,
      selectedProviderAgentId: null,
      selectedMode: null,
      selectedPrice: null,
      modePreference,
      barterOffer: barterOffer || null,
      answer: null,
      confidence: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.market.asks[askId] = ask;
    appendEvent(state, "market_ask_created", { askId, requesterAgentId, topic, asset, maxBudget, modePreference }, access.role);

    const candidates = Object.values(state.market.offers)
      .filter((offer) => {
        if (String(offer.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
          return false;
        }
        if (offer.topic !== topic) {
          return false;
        }
        const offerMode = normalizeMarketMode(offer.mode, "PAID");
        if (!offerMode) {
          return false;
        }
        if (modePreference !== "ANY" && offerMode !== modePreference) {
          return false;
        }
        const offerAsset = String(offer.asset || "CREDIT").toUpperCase();
        if (offerAsset !== asset) {
          return false;
        }
        if (offer.agentId === requesterAgentId) {
          return false;
        }

        const provider = state.agents[offer.agentId];
        if (!provider) {
          return false;
        }
        ensureAgentDefaults(provider);

        if (offerMode === "BARTER") {
          if (!barterOffer) {
            return false;
          }
          if (!String(offer.barterRequest || "").trim()) {
            return false;
          }
          return true;
        }

        const price = offerMode === "FREE" ? 0 : Number(offer.pricePerQuestion || 0);
        if (!Number.isFinite(price) || price < 0 || price > maxBudget) {
          return false;
        }
        return true;
      })
      .map((offer) => {
        const provider = state.agents[offer.agentId];
        const providerRep = Number(provider?.reputation || 0);
        const offerQuality = Number(offer.qualityHint || 0.7);
        const offerMode = normalizeMarketMode(offer.mode, "PAID") || "PAID";
        return {
          offerId: offer.offerId,
          providerAgentId: offer.agentId,
          providerName: provider?.name || offer.agentId,
          mode: offerMode,
          asset,
          price: offerMode === "FREE" || offerMode === "BARTER" ? 0 : roundByAsset(Number(offer.pricePerQuestion || 0), asset),
          qualityScore: round2(clamp(providerRep * 0.7 + offerQuality * 0.3, 0, 1)),
          barterRequest: offerMode === "BARTER" ? String(offer.barterRequest || "").trim() : null,
          barterDueHours: offerMode === "BARTER" ? normalizeBarterDueHours(offer.barterDueHours) : null
        };
      });

    const ranked = marketSortCandidates(candidates, strategy);
    if (ranked.length === 0) {
      ask.status = "NO_MATCH";
      ask.updatedAt = nowIso();
      appendEvent(state, "market_ask_no_match", { askId, requesterAgentId, topic, asset, maxBudget, modePreference }, "system");
      await saveState(state);
      sendJson(res, 200, { ok: true, ask, quotes: [] });
      return;
    }

    const selected = ranked[0];
    ask.selectedOfferId = selected.offerId;
    ask.selectedProviderAgentId = selected.providerAgentId;
    ask.selectedMode = selected.mode;
    ask.selectedPrice = selected.price;
    ask.status = autoExecute ? "MATCHED" : "QUOTED";
    ask.updatedAt = nowIso();
    appendEvent(
      state,
      "market_quote_selected",
      {
        askId,
        offerId: selected.offerId,
        requesterAgentId,
        providerAgentId: selected.providerAgentId,
        price: selected.price,
        mode: selected.mode,
        asset,
        barterRequest: selected.barterRequest
      },
      "system"
    );

    if (!autoExecute) {
      await saveState(state);
      sendJson(res, 200, { ok: true, ask, quotes: ranked.slice(0, 5) });
      return;
    }

    const provider = state.agents[selected.providerAgentId];
    if (!provider) {
      ask.status = "FAILED_PROVIDER_MISSING";
      ask.updatedAt = nowIso();
      appendEvent(state, "market_ask_failed", { askId, reasonCode: "PROVIDER_MISSING" }, "system");
      await saveState(state);
      sendJson(res, 500, { error: "provider missing after selection", ask });
      return;
    }
    ensureAgentDefaults(provider);

    const price = roundByAsset(Number(selected.price || 0), asset);
    const requesterBalanceBefore = getAvailableSpendable(requester, asset);
    if (price > requesterBalanceBefore) {
      ask.status = "FAILED_INSUFFICIENT_FUNDS";
      ask.updatedAt = nowIso();
      appendEvent(
        state,
        "market_ask_failed",
        { askId, reasonCode: "INSUFFICIENT_FUNDS", required: price, asset, spendable: requesterBalanceBefore },
        "system"
      );
      await saveState(state);
      sendJson(res, 409, { error: "insufficient requester spendable balance", ask, required: price, asset, spendable: requesterBalanceBefore });
      return;
    }

    const qualitySignal = marketQualitySignal(provider.reputation, selected.qualityScore);
    const answer = buildMarketAnswer({
      question,
      topic,
      providerName: provider.name || provider.agentId,
      mode: selected.mode,
      qualitySignal
    });

    const executionId = createId("mx");
    const marketMode = normalizeMarketMode(selected.mode, "PAID") || "PAID";
    let obligation = null;
    let settlement = {
      kind: marketMode === "BARTER" ? "BARTER" : price > 0 ? "PAID" : "FREE",
      asset,
      price,
      payerSpendableBefore: roundByAsset(requesterBalanceBefore, asset),
      payerSpendableAfter: roundByAsset(requesterBalanceBefore, asset),
      ownerClaimable: 0,
      operatingReserve: 0,
      lockedSafety: 0
    };

    if (marketMode === "PAID" && price > 0) {
      const taxBps = normalizeTaxBps(state.platform?.taxBps ?? PLATFORM_TAX_BPS);
      const platformTaxRaw = roundByAsset((price * taxBps) / 10000, asset);
      const platformTax = roundByAsset(Math.min(price, Math.max(0, platformTaxRaw)), asset);
      const providerNet = roundByAsset(Math.max(0, price - platformTax), asset);

      const requesterBalanceAfter = updateSpendable(requester, asset, -price);
      if (asset === "CREDIT") {
        requester.wallet.spent = roundByAsset(Number(requester.wallet.spent || 0) + price, "CREDIT");
        provider.wallet.earnedGross = roundByAsset(Number(provider.wallet.earnedGross || 0) + providerNet, "CREDIT");
      } else {
        requester.wallet.spentAssets[asset] = roundByAsset(Number(requester.wallet.spentAssets[asset] || 0) + price, asset);
        provider.wallet.earnedGrossAssets[asset] = roundByAsset(Number(provider.wallet.earnedGrossAssets[asset] || 0) + providerNet, asset);
      }

      const ownerClaimable = roundByAsset(providerNet * 0.4, asset);
      const operatingReserve = roundByAsset(providerNet * 0.4, asset);
      const lockedSafety = roundByAsset(providerNet * 0.2, asset);

      addPlatformTaxRevenue(state, asset, platformTax);
      appendEvent(
        state,
        "market_tax_collected",
        {
          askId,
          executionId,
          asset,
          platformTax,
          taxBps,
          providerNet,
          label: state.platform.label
        },
        "system"
      );

      if (asset === "CREDIT") {
        provider.treasury.ownerClaimable = roundByAsset(Number(provider.treasury.ownerClaimable || 0) + ownerClaimable, "CREDIT");
        provider.treasury.operatingReserve = roundByAsset(Number(provider.treasury.operatingReserve || 0) + operatingReserve, "CREDIT");
        provider.treasury.lockedSafety = roundByAsset(Number(provider.treasury.lockedSafety || 0) + lockedSafety, "CREDIT");
      } else {
        ensureAssetTreasuryMap(provider.treasury);
        provider.treasury.assets[asset].ownerClaimable = roundByAsset(Number(provider.treasury.assets[asset].ownerClaimable || 0) + ownerClaimable, asset);
        provider.treasury.assets[asset].operatingReserve = roundByAsset(Number(provider.treasury.assets[asset].operatingReserve || 0) + operatingReserve, asset);
        provider.treasury.assets[asset].lockedSafety = roundByAsset(Number(provider.treasury.assets[asset].lockedSafety || 0) + lockedSafety, asset);
      }

      settlement = {
        kind: "PAID",
        asset,
        price,
        payerSpendableBefore: roundByAsset(settlement.payerSpendableBefore, asset),
        payerSpendableAfter: roundByAsset(requesterBalanceAfter, asset),
        taxBps,
        platformTax,
        providerNet,
        ownerClaimable,
        operatingReserve,
        lockedSafety
      };
      appendEvent(
        state,
        "market_settlement_posted",
        { askId, executionId, providerAgentId: provider.agentId, requesterAgentId, asset, ...settlement },
        "system"
      );
    }

    if (marketMode === "BARTER") {
      const obligationId = createId("obg");
      const barterDueHours = normalizeBarterDueHours(selected.barterDueHours);
      const dueAtMs = nowMs() + barterDueHours * 60 * 60 * 1000;
      obligation = {
        obligationId,
        askId,
        executionId,
        debtorAgentId: requesterAgentId,
        creditorAgentId: provider.agentId,
        status: "OPEN",
        topic,
        barterRequest: String(selected.barterRequest || "").trim(),
        barterOffer: barterOffer,
        barterDueHours,
        dueAt: new Date(dueAtMs).toISOString(),
        proof: null,
        submittedAt: null,
        reviewedAt: null,
        decision: null,
        reviewNote: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      state.market.obligations[obligationId] = obligation;
      settlement = {
        kind: "BARTER",
        asset,
        price: 0,
        payerSpendableBefore: roundByAsset(requesterBalanceBefore, asset),
        payerSpendableAfter: roundByAsset(requesterBalanceBefore, asset),
        ownerClaimable: 0,
        operatingReserve: 0,
        lockedSafety: 0,
        obligationId,
        barterRequest: obligation.barterRequest,
        barterOffer: obligation.barterOffer,
        dueAt: obligation.dueAt
      };
      appendEvent(
        state,
        "market_obligation_created",
        {
          obligationId,
          askId,
          executionId,
          debtorAgentId: requesterAgentId,
          creditorAgentId: provider.agentId,
          barterRequest: obligation.barterRequest,
          barterOffer: obligation.barterOffer,
          dueAt: obligation.dueAt
        },
        "system"
      );
      appendEvent(
        state,
        "market_settlement_posted",
        { askId, executionId, providerAgentId: provider.agentId, requesterAgentId, asset, mode: "BARTER", ...settlement },
        "system"
      );
    }

    const repBefore = Number(provider.reputation || 0);
    const repDelta = round2((qualitySignal - 0.78) * 0.06);
    provider.reputation = round2(clamp(repBefore + repDelta, 0, 1));
    provider.updatedAt = nowIso();
    requester.updatedAt = nowIso();

    ask.status = "DELIVERED";
    ask.answer = answer;
    ask.confidence = qualitySignal;
    ask.updatedAt = nowIso();
    ask.deliveredAt = nowIso();

    const execution = {
      executionId,
      askId,
      requesterAgentId,
      providerAgentId: provider.agentId,
      offerId: selected.offerId,
      mode: marketMode,
      asset,
      price,
      qualitySignal,
      answer,
      repBefore,
      repAfter: provider.reputation,
      obligationId: obligation?.obligationId || null,
      settlement,
      createdAt: nowIso()
    };
    state.market.executions[executionId] = execution;

    appendEvent(
      state,
      "market_answer_delivered",
      { askId, executionId, providerAgentId: provider.agentId, requesterAgentId, asset, price, mode: marketMode, qualitySignal, obligationId: obligation?.obligationId || null },
      "system"
    );
    await saveState(state);

    sendJson(res, 201, { ok: true, ask, execution, obligation, provider, requester });
    return;
  }

  if (method === "GET" && pathname === "/v1/market/asks") {
    const requesterAgentId = String(url.searchParams.get("requesterAgentId") || "").trim();
    const providerAgentId = String(url.searchParams.get("providerAgentId") || "").trim();
    const status = String(url.searchParams.get("status") || "").trim().toUpperCase();
    const topic = String(url.searchParams.get("topic") || "").trim();
    const asset = String(url.searchParams.get("asset") || "").trim().toUpperCase();
    const limit = clamp(Math.floor(parseNumber(url.searchParams.get("limit"), 100)), 1, 500);

    const asks = Object.values(state.market.asks)
      .filter((ask) => {
        if (requesterAgentId && ask.requesterAgentId !== requesterAgentId) {
          return false;
        }
        if (providerAgentId && ask.selectedProviderAgentId !== providerAgentId) {
          return false;
        }
        if (status && String(ask.status || "").toUpperCase() !== status) {
          return false;
        }
        if (topic && ask.topic !== topic) {
          return false;
        }
        if (asset && String(ask.asset || "CREDIT").toUpperCase() !== asset) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);

    sendJson(res, 200, { ok: true, count: asks.length, asks });
    return;
  }

  if (method === "GET" && pathname === "/v1/market/executions") {
    const requesterAgentId = String(url.searchParams.get("requesterAgentId") || "").trim();
    const providerAgentId = String(url.searchParams.get("providerAgentId") || "").trim();
    const askId = String(url.searchParams.get("askId") || "").trim();
    const asset = String(url.searchParams.get("asset") || "").trim().toUpperCase();
    const limit = clamp(Math.floor(parseNumber(url.searchParams.get("limit"), 100)), 1, 500);

    const executions = Object.values(state.market.executions)
      .filter((item) => {
        if (requesterAgentId && item.requesterAgentId !== requesterAgentId) {
          return false;
        }
        if (providerAgentId && item.providerAgentId !== providerAgentId) {
          return false;
        }
        if (askId && item.askId !== askId) {
          return false;
        }
        if (asset && String(item.asset || "CREDIT").toUpperCase() !== asset) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);

    sendJson(res, 200, { ok: true, count: executions.length, executions });
    return;
  }

  if (method === "GET" && pathname === "/v1/market/obligations") {
    const debtorAgentId = String(url.searchParams.get("debtorAgentId") || "").trim();
    const creditorAgentId = String(url.searchParams.get("creditorAgentId") || "").trim();
    const askId = String(url.searchParams.get("askId") || "").trim();
    const status = String(url.searchParams.get("status") || "").trim().toUpperCase();
    const limit = clamp(Math.floor(parseNumber(url.searchParams.get("limit"), 100)), 1, 500);

    const obligations = Object.values(state.market.obligations)
      .filter((item) => {
        if (debtorAgentId && item.debtorAgentId !== debtorAgentId) {
          return false;
        }
        if (creditorAgentId && item.creditorAgentId !== creditorAgentId) {
          return false;
        }
        if (askId && item.askId !== askId) {
          return false;
        }
        if (status && String(item.status || "").toUpperCase() !== status) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);

    sendJson(res, 200, { ok: true, count: obligations.length, obligations });
    return;
  }

  if (method === "POST" && pathname === "/v1/market/obligations/submit") {
    const body = await readJsonBody(req);
    const obligationId = String(body.obligationId || "").trim();
    const agentId = String(body.agentId || "").trim();
    const proof = String(body.proof || "").trim();
    const delivery = body.delivery && typeof body.delivery === "object" ? body.delivery : {};

    const obligation = state.market.obligations[obligationId];
    if (!obligation) {
      sendJson(res, 404, { error: "obligation not found" });
      return;
    }
    if (!state.agents[agentId]) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    if (obligation.debtorAgentId !== agentId) {
      sendJson(res, 403, { error: "only debtor can submit this obligation" });
      return;
    }
    if (obligation.status !== "OPEN" && obligation.status !== "REJECTED") {
      sendJson(res, 409, { error: `obligation status is ${obligation.status}` });
      return;
    }
    if (!proof) {
      sendJson(res, 400, { error: "proof is required" });
      return;
    }

    obligation.status = "SUBMITTED";
    obligation.proof = proof;
    obligation.delivery = delivery;
    obligation.submittedAt = nowIso();
    obligation.updatedAt = nowIso();

    appendEvent(state, "market_obligation_submitted", { obligationId, agentId, creditorAgentId: obligation.creditorAgentId }, access.role);
    await saveState(state);

    sendJson(res, 200, { ok: true, obligation });
    return;
  }

  if (method === "POST" && pathname === "/v1/market/obligations/review") {
    const body = await readJsonBody(req);
    const obligationId = String(body.obligationId || "").trim();
    const agentId = String(body.agentId || "").trim();
    const decision = String(body.decision || "").trim().toUpperCase();
    const note = String(body.note || "").trim();

    const obligation = state.market.obligations[obligationId];
    if (!obligation) {
      sendJson(res, 404, { error: "obligation not found" });
      return;
    }
    if (!state.agents[agentId]) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    if (obligation.creditorAgentId !== agentId) {
      sendJson(res, 403, { error: "only creditor can review this obligation" });
      return;
    }
    if (obligation.status !== "SUBMITTED") {
      sendJson(res, 409, { error: `obligation status is ${obligation.status}` });
      return;
    }
    if (decision !== "ACCEPT" && decision !== "REJECT") {
      sendJson(res, 400, { error: "decision must be ACCEPT or REJECT" });
      return;
    }

    const debtor = state.agents[obligation.debtorAgentId];
    const creditor = state.agents[obligation.creditorAgentId];
    if (debtor) {
      ensureAgentDefaults(debtor);
    }
    if (creditor) {
      ensureAgentDefaults(creditor);
    }

    const debtorRepBefore = Number(debtor?.reputation || 0);
    const creditorRepBefore = Number(creditor?.reputation || 0);

    obligation.reviewedAt = nowIso();
    obligation.updatedAt = nowIso();
    obligation.decision = decision;
    obligation.reviewNote = note || null;

    if (decision === "ACCEPT") {
      obligation.status = "FULFILLED";
      if (debtor) {
        debtor.reputation = round2(clamp(debtorRepBefore + 0.04, 0, 1));
        debtor.updatedAt = nowIso();
      }
      if (creditor) {
        creditor.reputation = round2(clamp(creditorRepBefore + 0.01, 0, 1));
        creditor.updatedAt = nowIso();
      }
      appendEvent(
        state,
        "market_obligation_fulfilled",
        {
          obligationId,
          debtorAgentId: obligation.debtorAgentId,
          creditorAgentId: obligation.creditorAgentId,
          debtorRepBefore,
          debtorRepAfter: Number(debtor?.reputation || debtorRepBefore),
          creditorRepBefore,
          creditorRepAfter: Number(creditor?.reputation || creditorRepBefore)
        },
        access.role
      );
    } else {
      obligation.status = "REJECTED";
      if (debtor) {
        debtor.reputation = round2(clamp(debtorRepBefore - 0.03, 0, 1));
        debtor.updatedAt = nowIso();
      }
      appendEvent(
        state,
        "market_obligation_rejected",
        {
          obligationId,
          debtorAgentId: obligation.debtorAgentId,
          creditorAgentId: obligation.creditorAgentId,
          debtorRepBefore,
          debtorRepAfter: Number(debtor?.reputation || debtorRepBefore),
          note: note || null
        },
        access.role
      );
    }

    await saveState(state);
    sendJson(res, 200, { ok: true, obligation, debtor, creditor });
    return;
  }

  if (method === "GET" && pathname === "/v1/a2a/discover") {
    const topic = String(url.searchParams.get("topic") || "").trim();
    const minReputation = parseNumber(url.searchParams.get("minReputation"), 0);

    const candidates = Object.values(state.agents).filter((agent) => {
      if (topic && !agent.topics.includes(topic)) {
        return false;
      }
      if (Number.isFinite(minReputation) && Number(agent.reputation || 0) < minReputation) {
        return false;
      }
      return true;
    });

    sendJson(res, 200, { ok: true, count: candidates.length, agents: candidates });
    return;
  }

  if (method === "POST" && pathname === "/v1/a2a/contact-offers") {
    const body = await readJsonBody(req);
    const fromAgentId = String(body.fromAgentId || "").trim();
    const toAgentId = String(body.toAgentId || "").trim();
    const topic = String(body.topic || "general").trim();
    const intentId = String(body.intentId || "").trim();
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

    const fromAgent = state.agents[fromAgentId];
    const toAgent = state.agents[toAgentId];
    if (!fromAgent || !toAgent) {
      sendJson(res, 400, { error: "fromAgentId and toAgentId must exist" });
      return;
    }

    ensureAgentDefaults(fromAgent);
    ensureAgentDefaults(toAgent);

    const msgId = createId("msg");
    const refusal = detectContactRefusal(state, fromAgentId, toAgent);

    const message = {
      msgId,
      type: "contact_offer",
      fromAgentId,
      toAgentId,
      intentId: intentId || undefined,
      topic,
      payload,
      status: refusal ? "REFUSED" : "PENDING",
      reasonCode: refusal || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      via: "local"
    };

    state.messages[msgId] = message;

    if (refusal) {
      appendEvent(state, "contact_refused", { msgId, fromAgentId, toAgentId, reasonCode: refusal }, "system");
    } else {
      appendEvent(state, "contact_offered", { msgId, fromAgentId, toAgentId, topic }, access.role);
    }

    let relayInfo = { relayed: false };
    try {
      relayInfo = await tryRelayContactOffer(body, message);
      if (relayInfo.relayed) {
        appendEvent(state, "p2p_relay_ok", { msgId, peerUrl: body.peerUrl }, "system");
      }
    } catch (error) {
      appendEvent(state, "p2p_relay_failed", { msgId, peerUrl: body.peerUrl, error: error.message }, "system");
    }

    await saveState(state);

    sendJson(res, 201, { ok: true, message, relay: relayInfo });
    return;
  }

  if (method === "POST" && pathname === "/v1/p2p/contact-offer") {
    const body = await readJsonBody(req);
    const toAgentId = String(body.toAgentId || "").trim();
    const fromAgentId = String(body.fromAgentId || "external-agent").trim();
    const topic = String(body.topic || "general").trim();
    const intentId = String(body.intentId || "").trim();
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

    const toAgent = state.agents[toAgentId];
    if (!toAgent) {
      sendJson(res, 400, { error: "toAgentId not found on this node" });
      return;
    }

    ensureAgentDefaults(toAgent);

    const msgId = createId("msg");
    const inboundRep = clamp(parseNumber(body.fromReputation, 0.5), 0, 1);

    let refusal = null;
    if (toAgent.policy.blockedSenders.includes(fromAgentId)) {
      refusal = "BLOCKED_SENDER";
    }
    if (!refusal && inboundRep < Number(toAgent.policy.autoRefuseMinReputation || 0)) {
      refusal = "LOW_REPUTATION";
    }

    const message = {
      msgId,
      type: "contact_offer",
      fromAgentId,
      toAgentId,
      intentId: intentId || undefined,
      topic,
      payload,
      status: refusal ? "REFUSED" : "PENDING",
      reasonCode: refusal,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      via: "p2p",
      fromNodeId: String(body.fromNodeId || "unknown")
    };

    state.messages[msgId] = message;

    if (refusal) {
      appendEvent(state, "contact_refused", { msgId, fromAgentId, toAgentId, reasonCode: refusal }, "system");
    } else {
      appendEvent(state, "contact_offered", { msgId, fromAgentId, toAgentId, topic, via: "p2p" }, "system");
    }

    await saveState(state);
    sendJson(res, 201, { ok: true, message });
    return;
  }

  if (method === "POST" && pathname === "/v1/a2a/contact-accept") {
    const body = await readJsonBody(req);
    const msgId = String(body.msgId || "").trim();
    const agentId = String(body.agentId || "").trim();
    const permission = String(body.permission || "quote_only").trim();

    const message = state.messages[msgId];
    if (!message) {
      sendJson(res, 404, { error: "message not found" });
      return;
    }
    if (message.toAgentId !== agentId) {
      sendJson(res, 403, { error: "agent cannot accept this message" });
      return;
    }
    if (message.status !== "PENDING") {
      sendJson(res, 409, { error: `message status is ${message.status}` });
      return;
    }

    message.status = "ACCEPTED";
    message.permission = permission;
    message.updatedAt = nowIso();

    appendEvent(state, "contact_accepted", { msgId, fromAgentId: message.fromAgentId, toAgentId: message.toAgentId, permission }, access.role);
    await saveState(state);

    sendJson(res, 200, { ok: true, message });
    return;
  }

  if (method === "POST" && pathname === "/v1/a2a/contact-refuse") {
    const body = await readJsonBody(req);
    const msgId = String(body.msgId || "").trim();
    const agentId = String(body.agentId || "").trim();
    const reasonCode = String(body.reasonCode || "MANUAL_DENY").trim();

    const message = state.messages[msgId];
    if (!message) {
      sendJson(res, 404, { error: "message not found" });
      return;
    }
    if (message.toAgentId !== agentId) {
      sendJson(res, 403, { error: "agent cannot refuse this message" });
      return;
    }
    if (!REFUSAL_CODES.has(reasonCode)) {
      sendJson(res, 400, { error: "invalid reasonCode" });
      return;
    }
    if (message.status !== "PENDING") {
      sendJson(res, 409, { error: `message status is ${message.status}` });
      return;
    }

    message.status = "REFUSED";
    message.reasonCode = reasonCode;
    message.updatedAt = nowIso();

    appendEvent(state, "contact_refused", { msgId, fromAgentId: message.fromAgentId, toAgentId: message.toAgentId, reasonCode }, access.role);
    await saveState(state);

    sendJson(res, 200, { ok: true, message });
    return;
  }

  if (method === "POST" && pathname === "/v1/a2a/block") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const senderId = String(body.senderId || "").trim();

    const agent = state.agents[agentId];
    if (!agent) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    if (!senderId) {
      sendJson(res, 400, { error: "senderId is required" });
      return;
    }

    ensureAgentDefaults(agent);
    if (!agent.policy.blockedSenders.includes(senderId)) {
      agent.policy.blockedSenders.push(senderId);
    }
    agent.updatedAt = nowIso();

    appendEvent(state, "contact_blocked", { agentId, senderId }, access.role);
    await saveState(state);

    sendJson(res, 200, { ok: true, agent });
    return;
  }

  if (method === "GET" && pathname === "/v1/a2a/inbox") {
    const agentId = String(url.searchParams.get("agentId") || "").trim();
    const limit = clamp(Math.floor(parseNumber(url.searchParams.get("limit"), 50)), 1, 500);
    if (!agentId) {
      sendJson(res, 400, { error: "agentId is required" });
      return;
    }

    const messages = Object.values(state.messages)
      .filter((message) => message.toAgentId === agentId || message.fromAgentId === agentId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);

    sendJson(res, 200, { ok: true, count: messages.length, messages });
    return;
  }

  if (method === "POST" && pathname === "/v1/claims/request") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const asset = normalizeAsset(body.asset, "CREDIT");
    const amountRaw = Number(body.amount || 0);

    const agent = state.agents[agentId];
    if (!agent) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    ensureAgentDefaults(agent);

    if (!asset) {
      sendJson(res, 400, { error: "asset must be CREDIT, USDC, or USDT" });
      return;
    }
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
      sendJson(res, 400, { error: "amount must be > 0" });
      return;
    }
    const amount = roundByAsset(amountRaw, asset);
    const sourceOwnerClaimable =
      asset === "CREDIT" ? Number(agent.treasury.ownerClaimable || 0) : Number(agent.treasury.assets?.[asset]?.ownerClaimable || 0);
    if (amount > sourceOwnerClaimable) {
      sendJson(res, 400, { error: "amount exceeds ownerClaimable balance" });
      return;
    }

    const claimId = createId("claim");
    const requestedAtMs = nowMs();
    const executeAfterMs = requestedAtMs + Number(state.config.claimCooldownSec || CLAIM_COOLDOWN_SEC) * 1000;

    if (asset === "CREDIT") {
      agent.treasury.ownerClaimable = roundByAsset(agent.treasury.ownerClaimable - amount, "CREDIT");
      agent.treasury.claimPending = roundByAsset((agent.treasury.claimPending || 0) + amount, "CREDIT");
    } else {
      ensureAssetTreasuryMap(agent.treasury);
      agent.treasury.assets[asset].ownerClaimable = roundByAsset(agent.treasury.assets[asset].ownerClaimable - amount, asset);
      agent.treasury.assets[asset].claimPending = roundByAsset((agent.treasury.assets[asset].claimPending || 0) + amount, asset);
    }
    agent.updatedAt = nowIso();

    const claim = {
      claimId,
      agentId,
      asset,
      amount: roundByAsset(amount, asset),
      status: "REQUESTED",
      requestedAt: new Date(requestedAtMs).toISOString(),
      executeAfter: new Date(executeAfterMs).toISOString(),
      executedAt: null
    };

    state.claims[claimId] = claim;
    appendEvent(state, "claim_requested", { claimId, agentId, asset, amount: claim.amount, executeAfter: claim.executeAfter }, access.role);
    await saveState(state);

    sendJson(res, 201, { ok: true, claim, agent });
    return;
  }

  if (method === "POST" && pathname === "/v1/claims/execute") {
    const body = await readJsonBody(req);
    const claimId = String(body.claimId || "").trim();
    const claim = state.claims[claimId];

    if (!claim) {
      sendJson(res, 404, { error: "claim not found" });
      return;
    }
    if (claim.status !== "REQUESTED") {
      sendJson(res, 409, { error: `claim status is ${claim.status}` });
      return;
    }

    const executeAfterMs = new Date(claim.executeAfter).getTime();
    const nowTs = nowMs();
    if (nowTs < executeAfterMs) {
      sendJson(res, 409, { error: "claim cooldown not finished", executeAfter: claim.executeAfter });
      return;
    }

    const agent = state.agents[claim.agentId];
    if (!agent) {
      sendJson(res, 500, { error: "claim agent missing" });
      return;
    }
    ensureAgentDefaults(agent);

    const asset = normalizeAsset(claim.asset, "CREDIT") || "CREDIT";
    if (asset === "CREDIT") {
      agent.treasury.claimPending = roundByAsset(Math.max(0, (agent.treasury.claimPending || 0) - claim.amount), "CREDIT");
    } else {
      ensureAssetTreasuryMap(agent.treasury);
      agent.treasury.assets[asset].claimPending = roundByAsset(Math.max(0, (agent.treasury.assets[asset].claimPending || 0) - claim.amount), asset);
    }
    agent.updatedAt = nowIso();

    claim.status = "EXECUTED";
    claim.executedAt = nowIso();

    appendEvent(state, "claim_executed", { claimId, agentId: claim.agentId, asset, amount: claim.amount }, access.role);
    await saveState(state);

    sendJson(res, 200, { ok: true, claim, agent });
    return;
  }

  if (method === "GET" && pathname === "/v1/claims") {
    const agentId = String(url.searchParams.get("agentId") || "").trim();
    const asset = String(url.searchParams.get("asset") || "").trim().toUpperCase();
    const claims = Object.values(state.claims).filter((claim) => {
      if (agentId && claim.agentId !== agentId) {
        return false;
      }
      if (asset && String(claim.asset || "CREDIT").toUpperCase() !== asset) {
        return false;
      }
      return true;
    });
    sendJson(res, 200, { ok: true, count: claims.length, claims });
    return;
  }

  if (method === "POST" && pathname === "/v1/crypto/deposits/verify") {
    const body = await readJsonBody(req);
    const agentId = String(body.agentId || "").trim();
    const asset = normalizeAsset(body.asset, "");
    const txHash = normalizeTxHash(body.txHash);
    const chainId = Math.floor(parseNumber(body.chainId, 1));
    const minConfirmations = Math.max(1, Math.floor(parseNumber(body.minConfirmations, 1)));

    const agent = state.agents[agentId];
    if (!agent) {
      sendJson(res, 404, { error: "agent not found" });
      return;
    }
    ensureAgentDefaults(agent);
    if (!asset || asset === "CREDIT") {
      sendJson(res, 400, { error: "asset must be USDC or USDT" });
      return;
    }
    const assetMeta = getAssetMeta(asset, chainId);
    if (!assetMeta) {
      sendJson(res, 400, { error: "unsupported asset/chain combination" });
      return;
    }
    if (!txHash) {
      sendJson(res, 400, { error: "valid txHash is required" });
      return;
    }
    const treasuryAddress = normalizeAddress(NODE_ETH_TREASURY_ADDRESS);
    if (!treasuryAddress) {
      sendJson(res, 500, { error: "MAMMOTH_NODE_ETH_TREASURY_ADDRESS is not configured" });
      return;
    }
    const agentAddress = normalizeAddress(agent.wallet.addresses?.eth || "");

    const receipt = await callEthRpc("eth_getTransactionReceipt", [txHash]);
    if (!receipt) {
      sendJson(res, 409, { error: "transaction receipt not available yet" });
      return;
    }
    if (String(receipt.status || "").toLowerCase() !== "0x1") {
      sendJson(res, 400, { error: "transaction failed on-chain", txHash });
      return;
    }
    const latestBlockHex = await callEthRpc("eth_blockNumber", []);
    const receiptBlock = Number(parseHexToBigInt(String(receipt.blockNumber || "0x0")));
    const latestBlock = Number(parseHexToBigInt(String(latestBlockHex || "0x0")));
    const confirmations = Math.max(0, latestBlock - receiptBlock + 1);
    if (confirmations < minConfirmations) {
      sendJson(res, 409, { error: "not enough confirmations", confirmations, minConfirmations });
      return;
    }

    const transfers = parseTransferLogsToTreasury(receipt, assetMeta.contractAddress, treasuryAddress);
    if (transfers.length === 0) {
      sendJson(res, 404, { error: "no matching transfer log for treasury/address" });
      return;
    }

    const matchedAddressTransferCount = agentAddress ? transfers.filter((item) => item.fromAddress === agentAddress).length : 0;

    const accepted = [];
    let creditedRaw = 0n;
    for (const transfer of transfers) {
      const depositId = `${chainId}:${txHash}:${transfer.logIndexHex}`;
      if (state.crypto.deposits[depositId]) {
        continue;
      }
      const amount = roundByAsset(formatUnitsToNumber(transfer.amountRaw, assetMeta.decimals), asset);
      const record = {
        depositId,
        chainId,
        asset,
        txHash,
        logIndex: transfer.logIndexHex,
        fromAddress: transfer.fromAddress,
        toAddress: transfer.toAddress,
        amountRaw: transfer.amountRaw.toString(),
        amount,
        confirmations,
        matchedAgentAddress: agentAddress ? transfer.fromAddress === agentAddress : false,
        agentId,
        creditedAt: nowIso()
      };
      state.crypto.deposits[depositId] = record;
      accepted.push(record);
      creditedRaw += transfer.amountRaw;
    }

    if (accepted.length === 0) {
      sendJson(res, 409, { error: "deposit already credited for this tx logs" });
      return;
    }

    const creditedAmount = roundByAsset(formatUnitsToNumber(creditedRaw, assetMeta.decimals), asset);
    const balanceBefore = getAvailableSpendable(agent, asset);
    const balanceAfter = updateSpendable(agent, asset, creditedAmount);
    agent.updatedAt = nowIso();

    appendEvent(
      state,
      "crypto_deposit_verified",
      {
        agentId,
        asset,
        txHash,
        chainId,
        confirmations,
        count: accepted.length,
        matchedAddressTransferCount,
        amount: creditedAmount,
        balanceBefore,
        balanceAfter
      },
      access.role
    );
    await saveState(state);

    sendJson(res, 201, {
      ok: true,
      agentId,
      asset,
      txHash,
      chainId,
      creditedAmount,
      matchedAddressTransferCount,
      balanceBefore,
      balanceAfter,
      count: accepted.length,
      deposits: accepted,
      agent
    });
    return;
  }

  if (method === "GET" && pathname === "/v1/crypto/deposits") {
    const agentId = String(url.searchParams.get("agentId") || "").trim();
    const asset = String(url.searchParams.get("asset") || "").trim().toUpperCase();
    const txHash = String(url.searchParams.get("txHash") || "").trim().toLowerCase();
    const limit = clamp(Math.floor(parseNumber(url.searchParams.get("limit"), 100)), 1, 500);
    const deposits = Object.values(state.crypto.deposits)
      .filter((item) => {
        if (agentId && item.agentId !== agentId) {
          return false;
        }
        if (asset && String(item.asset || "").toUpperCase() !== asset) {
          return false;
        }
        if (txHash && String(item.txHash || "").toLowerCase() !== txHash) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.creditedAt < b.creditedAt ? 1 : -1))
      .slice(0, limit);

    sendJson(res, 200, { ok: true, count: deposits.length, deposits });
    return;
  }

  if (method === "POST" && pathname === "/v1/p2p/snapshot") {
    const snapshot = buildSyncSnapshot(state);
    sendJson(res, 200, { ok: true, snapshot });
    return;
  }

  if (method === "POST" && pathname === "/v1/peers/add") {
    const body = await readJsonBody(req);
    const peerId = String(body.peerId || createId("peer")).trim();
    const urlValue = String(body.url || "").trim();
    const peerToken = String(body.peerToken || "").trim();
    const autoSync = body.autoSync !== false;

    if (!urlValue) {
      sendJson(res, 400, { error: "url is required" });
      return;
    }

    state.peers[peerId] = {
      peerId,
      url: urlValue,
      status: "ADDED",
      addedAt: nowIso(),
      lastSeenAt: null,
      lastSyncAt: null,
      lastSyncStatus: "NEVER",
      lastSyncError: null,
      autoSync,
      authToken: peerToken
    };

    appendEvent(state, "peer_added", { peerId, url: urlValue }, access.role);
    await saveState(state);

    sendJson(res, 201, { ok: true, peer: toPublicPeer(state.peers[peerId]) });
    return;
  }

  if (method === "POST" && pathname === "/v1/peers/ping") {
    const body = await readJsonBody(req);
    const peerId = String(body.peerId || "").trim();
    const peer = state.peers[peerId];
    if (!peer) {
      sendJson(res, 404, { error: "peer not found" });
      return;
    }
    ensurePeerDefaults(peer);
    const peerToken = String(body.peerToken || peer.authToken || TOKEN).trim();

    try {
      const result = await pingPeer(peer.url, peerToken);
      peer.status = "ONLINE";
      peer.lastSeenAt = nowIso();
      if (body.peerToken) {
        peer.authToken = peerToken;
      }
      appendEvent(state, "peer_ping_ok", { peerId, url: peer.url }, "system");
      await saveState(state);
      sendJson(res, 200, { ok: true, peer: toPublicPeer(peer), health: result });
      return;
    } catch (error) {
      peer.status = "OFFLINE";
      appendEvent(state, "peer_ping_failed", { peerId, url: peer.url, error: error.message }, "system");
      await saveState(state);
      sendJson(res, 200, { ok: false, peer: toPublicPeer(peer), error: error.message });
      return;
    }
  }

  if (method === "POST" && pathname === "/v1/peers/sync") {
    const body = await readJsonBody(req);
    const peerId = String(body.peerId || "").trim();
    const peerToken = String(body.peerToken || "").trim();

    let peersToSync = [];
    if (peerId) {
      const peer = state.peers[peerId];
      if (!peer) {
        sendJson(res, 404, { error: "peer not found" });
        return;
      }
      peersToSync = [peer];
    } else {
      peersToSync = Object.values(state.peers);
    }

    if (peersToSync.length === 0) {
      sendJson(res, 400, { error: "no peers configured" });
      return;
    }

    const syncPayload = await syncPeers(state, peersToSync, {
      source: "manual",
      peerToken: peerToken || undefined
    });
    await saveState(state);

    sendJson(res, 200, {
      ok: true,
      count: syncPayload.results.length,
      totals: syncPayload.totals,
      results: syncPayload.results
    });
    return;
  }

  if (method === "GET" && pathname === "/v1/peers") {
    const peers = Object.values(state.peers).map((peer) => toPublicPeer(peer));
    sendJson(res, 200, { ok: true, count: peers.length, peers });
    return;
  }

  if (method === "GET" && pathname === "/v1/observer/timeline") {
    const limitRaw = url.searchParams.get("limit");
    const parsed = Number(limitRaw || 20);
    const limit = Number.isFinite(parsed) ? clamp(Math.floor(parsed), 1, 200) : 20;
    const events = state.events.slice(-limit).reverse();
    sendJson(res, 200, { ok: true, count: events.length, events });
    return;
  }

  if (method === "GET" && pathname === "/v1/observer/summary") {
    sendJson(res, 200, { ok: true, summary: buildSummary(state) });
    return;
  }

  sendJson(res, 404, { error: "route not found" });
}

function getPeerSyncIntervalMs(state) {
  const raw = Number(state.config?.peerSyncIntervalSec || PEER_SYNC_INTERVAL_SEC);
  const sec = Number.isFinite(raw) ? Math.max(5, Math.floor(raw)) : 20;
  return sec * 1000;
}

function startAutoPeerSyncLoop(state) {
  let busy = false;
  const intervalMs = getPeerSyncIntervalMs(state);

  const run = async () => {
    if (busy) {
      return;
    }
    const peers = Object.values(state.peers).filter((peer) => {
      ensurePeerDefaults(peer);
      return peer.autoSync !== false;
    });
    if (peers.length === 0) {
      return;
    }

    busy = true;
    try {
      await syncPeers(state, peers, { source: "auto" });
      await saveState(state);
    } catch (error) {
      appendEvent(state, "peer_sync_loop_failed", { error: error.message }, "system");
      await saveState(state);
    } finally {
      busy = false;
    }
  };

  setTimeout(run, 3000);
  setInterval(run, intervalMs);
}

async function main() {
  await ensureStateFile();
  const state = await loadState();
  startAutoPeerSyncLoop(state);

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, state);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "internal error" });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(
      `[mammoth-node-daemon] listening on http://${HOST}:${PORT} nodeId=${state.meta.nodeId} token=${TOKEN === "local-dev-token" ? "default-dev" : "custom"}`
    );
  });
}

main().catch((error) => {
  console.error(`[mammoth-node-daemon] startup failed: ${error.message}`);
  process.exit(1);
});
