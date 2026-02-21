#!/usr/bin/env node
/**
 * Mammoth TUI v2 — OpenCode-style Terminal UI
 * ============================================
 * 3-column layout: Sessions/Files | AI Chat | Agents/Market
 * Multi-model AI (Gemini, Claude, GPT) + Mammoth A2P integration
 *
 * 순수 Node.js — 외부 프레임워크 없이 raw ANSI 렌더링
 */

import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";

// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
const NODE_URL = process.env.MAMMOTH_NODE_URL || "http://127.0.0.1:7340";
const NODE_TOKEN = process.env.MAMMOTH_NODE_TOKEN || "local-dev-token";
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const CWD = process.cwd();

// ══════════════════════════════════════════════════════════════
// ANSI ESCAPE HELPERS
// ══════════════════════════════════════════════════════════════
const ESC = "\x1b";
const CSI = `${ESC}[`;
const ansi = {
    clear: `${CSI}2J${CSI}H`,
    hideCursor: `${CSI}?25l`,
    showCursor: `${CSI}?25h`,
    altScreen: `${CSI}?1049h`,
    mainScreen: `${CSI}?1049l`,
    bold: `${CSI}1m`,
    dim: `${CSI}2m`,
    italic: `${CSI}3m`,
    underline: `${CSI}4m`,
    reset: `${CSI}0m`,
    // Colors — curated palette
    fg: {
        black: `${CSI}30m`,
        red: `${CSI}38;5;203m`,
        green: `${CSI}38;5;114m`,
        yellow: `${CSI}38;5;221m`,
        blue: `${CSI}38;5;75m`,
        magenta: `${CSI}38;5;176m`,
        cyan: `${CSI}38;5;87m`,
        white: `${CSI}37m`,
        gray: `${CSI}38;5;245m`,
        orange: `${CSI}38;5;215m`,
        // Brand
        mammoth: `${CSI}38;5;208m`,  // 🦣 orange
        accent: `${CSI}38;5;75m`,    // blue
        success: `${CSI}38;5;114m`,
        warn: `${CSI}38;5;221m`,
        error: `${CSI}38;5;203m`,
        muted: `${CSI}38;5;242m`,
    },
    bg: {
        black: `${CSI}40m`,
        darkGray: `${CSI}48;5;236m`,
        medGray: `${CSI}48;5;238m`,
        highlight: `${CSI}48;5;237m`,
        accent: `${CSI}48;5;24m`,
        bar: `${CSI}48;5;235m`,
    },
    moveTo: (r, c) => `${CSI}${r};${c}H`,
    clearLine: `${CSI}2K`,
};

function w(s) { process.stdout.write(s); }
function cols() { return process.stdout.columns || 120; }
function rows() { return process.stdout.rows || 40; }

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════
const state = {
    mode: "chat",        // chat | command | market | agents | files
    activeProvider: "gemini",
    inputBuffer: "",
    inputCursorPos: 0,
    chatHistory: [],     // { role: "user"|"ai"|"system", text, ts }
    chatScroll: 0,
    cmdHistory: [],
    cmdHistoryIdx: -1,
    // Sidebar
    sessions: [{ id: 1, title: "새 세션", active: true }],
    fileTree: [],
    fileTreeOpen: true,
    sidebarSection: "sessions",  // sessions | files
    // Right panel
    agents: [],
    market: { offers: [], asks: [] },
    inbox: [],
    obligations: [],
    nodeSummary: null,
    panelSection: "agents",  // agents | market | inbox
    // Status
    connected: false,
    streaming: false,
    lastError: null,
};

const providers = {
    gemini: { name: "Gemini 2.5 Pro", key: GEMINI_KEY, model: "gemini-2.5-pro-preview-05-06" },
    claude: { name: "Claude Sonnet 4.5", key: ANTHROPIC_KEY, model: "claude-sonnet-4-5-20241022" },
    openai: { name: "GPT-4.1", key: OPENAI_KEY, model: "gpt-4.1" },
};

// ══════════════════════════════════════════════════════════════
// MAMMOTH API CLIENT
// ══════════════════════════════════════════════════════════════
async function mapi(method, path, body) {
    try {
        const opts = {
            method,
            headers: { "content-type": "application/json", authorization: `Bearer ${NODE_TOKEN}` },
        };
        let url = `${NODE_URL}${path}`;
        if (body && method === "GET") {
            const p = new URLSearchParams();
            for (const [k, v] of Object.entries(body)) {
                if (v != null && v !== "") p.set(k, String(v));
            }
            const q = p.toString();
            if (q) url += `?${q}`;
        } else if (body) {
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        return await res.json();
    } catch (e) {
        return { error: e.message };
    }
}

async function refreshDaemonData() {
    try {
        const [summary, agentRes, offersRes, asksRes, msgRes, oblRes] = await Promise.all([
            mapi("GET", "/v1/observer/summary"),
            mapi("GET", "/v1/agents"),
            mapi("GET", "/v1/market/offers"),
            mapi("GET", "/v1/market/asks"),
            mapi("GET", "/v1/a2a/messages", { limit: 10 }),
            mapi("GET", "/v1/market/obligations"),
        ]);
        state.connected = !summary.error;
        state.nodeSummary = summary.summary || null;
        state.agents = agentRes.agents || Object.values(agentRes.agents || {});
        if (!Array.isArray(state.agents)) state.agents = Object.values(state.agents);
        state.market.offers = offersRes.offers ? (Array.isArray(offersRes.offers) ? offersRes.offers : Object.values(offersRes.offers)) : [];
        state.market.asks = asksRes.asks ? (Array.isArray(asksRes.asks) ? asksRes.asks : Object.values(asksRes.asks)) : [];
        state.inbox = msgRes.messages || [];
        state.obligations = oblRes.obligations ? (Array.isArray(oblRes.obligations) ? oblRes.obligations : Object.values(oblRes.obligations)) : [];
    } catch {
        state.connected = false;
    }
}

// ══════════════════════════════════════════════════════════════
// FILE TREE
// ══════════════════════════════════════════════════════════════
async function loadFileTree(dir, depth = 0, maxDepth = 2) {
    if (depth > maxDepth) return [];
    const items = [];
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        const sorted = entries
            .filter(e => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist")
            .sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            })
            .slice(0, 25);
        for (const entry of sorted) {
            const full = path.join(dir, entry.name);
            const isDir = entry.isDirectory();
            items.push({ name: entry.name, path: full, isDir, depth });
            if (isDir && depth < maxDepth) {
                const children = await loadFileTree(full, depth + 1, maxDepth);
                items.push(...children);
            }
        }
    } catch { /* ignore */ }
    return items;
}

// ══════════════════════════════════════════════════════════════
// TEXT UTILITIES
// ══════════════════════════════════════════════════════════════
function truncate(s, maxLen) {
    if (!s) return "";
    maxLen = Math.max(0, maxLen);
    if (maxLen === 0) return "";
    // Strip ANSI for length comparison
    const vis = stripAnsi(s);
    if (vis.length <= maxLen) return s;
    // Naive truncate (keeps some ANSI codes, acceptable for display)
    return s.slice(0, Math.max(1, maxLen - 1)) + "…";
}

function padRight(s, len) {
    len = Math.max(0, len);
    const vis = stripAnsi(s).length;
    if (vis >= len) return s;
    return s + " ".repeat(Math.max(0, len - vis));
}

function safeRepeat(ch, n) {
    return ch.repeat(Math.max(0, Math.floor(n)));
}

function wrapText(text, width) {
    if (!text) return [""];
    const lines = [];
    for (const rawLine of text.split("\n")) {
        if (rawLine.length <= width) {
            lines.push(rawLine);
        } else {
            let remaining = rawLine;
            while (remaining.length > width) {
                let breakAt = remaining.lastIndexOf(" ", width);
                if (breakAt <= 0) breakAt = width;
                lines.push(remaining.slice(0, breakAt));
                remaining = remaining.slice(breakAt).trimStart();
            }
            if (remaining) lines.push(remaining);
        }
    }
    return lines;
}

// ══════════════════════════════════════════════════════════════
// RENDER ENGINE
// ══════════════════════════════════════════════════════════════
function render() {
    const W = Math.max(40, cols());
    const H = Math.max(10, rows());
    const sideW = Math.max(16, Math.floor(W * 0.15));
    const panelW = Math.max(20, Math.floor(W * 0.22));
    const chatW = Math.max(10, W - sideW - panelW - 2); // 2 for borders

    let buf = ansi.hideCursor;

    // ── TOP BAR ──
    buf += ansi.moveTo(1, 1) + ansi.bg.bar + ansi.fg.mammoth + ansi.bold;
    const providerLabel = providers[state.activeProvider]?.name || state.activeProvider;
    const connStatus = state.connected ? `${ansi.fg.success}●` : `${ansi.fg.error}○`;
    const topLeft = ` 🦣 MAMMOTH`;
    const topMid = `${ansi.reset}${ansi.bg.bar}${ansi.fg.muted}  ${connStatus}${ansi.reset}${ansi.bg.bar}`;
    const agentCount = state.agents.length;
    const creditSum = state.agents.reduce((s, a) => s + (a.balance || a.spendable?.CREDIT || 0), 0);
    const topRight = `${ansi.fg.accent}[${providerLabel}]${ansi.fg.muted}  agents:${agentCount}  ₵${Math.round(creditSum)} `;
    const topStr = topLeft + topMid + safeRepeat(" ", W - stripAnsi(topLeft + topMid + topRight).length) + topRight;
    buf += padRight(stripAnsi(topStr).length <= W ? topStr : truncate(stripAnsi(topStr), W), W);
    buf += ansi.reset;

    // ── BORDER LINE ──
    buf += ansi.moveTo(2, 1) + ansi.fg.muted;
    buf += safeRepeat("─", sideW) + "┬" + safeRepeat("─", chatW) + "┬" + safeRepeat("─", panelW);

    // ── COLUMNS (rows 3 to H-2) ──
    const contentH = Math.max(1, H - 4); // rows 3 to H-2

    // Build column content
    const sideLines = renderSidebar(sideW - 1, contentH);
    const chatLines = renderChat(chatW - 1, contentH);
    const panelLines = renderPanel(panelW - 1, contentH);

    for (let i = 0; i < contentH; i++) {
        const row = i + 3;
        buf += ansi.moveTo(row, 1);
        // Sidebar
        buf += (sideLines[i] || padRight("", sideW - 1));
        buf += `${ansi.reset}${ansi.fg.muted}│`;
        // Chat
        buf += (chatLines[i] || padRight("", chatW - 1));
        buf += `${ansi.reset}${ansi.fg.muted}│`;
        // Panel
        buf += (panelLines[i] || padRight("", panelW - 1));
        buf += ansi.reset;
    }

    // ── BOTTOM BORDER ──
    const bottomRow = H - 1;
    buf += ansi.moveTo(bottomRow, 1) + ansi.fg.muted;
    buf += safeRepeat("─", sideW) + "┴" + safeRepeat("─", chatW) + "┴" + safeRepeat("─", panelW);

    // ── INPUT BAR ──
    buf += ansi.moveTo(H, 1) + ansi.clearLine + ansi.bg.bar;
    const modeLabel = state.mode === "chat" ? "💬" : state.mode === "command" ? ":" : state.mode === "market" ? "📊" : state.mode === "agents" ? "👥" : "📁";
    const inputPrefix = `${ansi.fg.mammoth}${ansi.bold} ${modeLabel} ${ansi.reset}${ansi.bg.bar}${ansi.fg.white}`;
    const helpHint = `${ansi.fg.muted} Tab:mode  Ctrl+C:exit`;
    const inputSpace = Math.max(1, W - 6 - 24);
    const displayInput = state.inputBuffer.length > inputSpace
        ? "…" + state.inputBuffer.slice(-(inputSpace - 1))
        : state.inputBuffer;
    buf += inputPrefix + padRight(displayInput, inputSpace) + helpHint;
    buf += safeRepeat(" ", W - stripAnsi(inputPrefix + displayInput + helpHint).length - inputSpace);
    buf += ansi.reset;

    // Cursor
    const cursorCol = 4 + Math.min(state.inputBuffer.length, inputSpace);
    buf += ansi.moveTo(H, cursorCol) + ansi.showCursor;

    w(buf);
}

function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
}

// ── SIDEBAR ──
function renderSidebar(width, height) {
    const lines = [];
    const w = width;

    // Section header
    if (state.sidebarSection === "sessions") {
        lines.push(`${ansi.fg.accent}${ansi.bold} SESSIONS${ansi.reset}`);
        lines.push(`${ansi.fg.muted} ${safeRepeat("─", w - 2)}`);
        for (const sess of state.sessions) {
            const prefix = sess.active ? `${ansi.fg.mammoth}▸` : `${ansi.fg.muted} `;
            lines.push(`${prefix} ${ansi.fg.white}${truncate(sess.title, w - 4)}${ansi.reset}`);
        }
        lines.push("");
        lines.push(`${ansi.fg.accent}${ansi.bold} FILES${ansi.reset}`);
        lines.push(`${ansi.fg.muted} ${"─".repeat(w - 2)}`);
    } else {
        lines.push(`${ansi.fg.accent}${ansi.bold} FILES${ansi.reset}`);
        lines.push(`${ansi.fg.muted} ${"─".repeat(w - 2)}`);
    }

    // File tree
    for (const f of state.fileTree.slice(0, height - lines.length - 1)) {
        const indent = "  ".repeat(f.depth);
        const icon = f.isDir ? `${ansi.fg.accent}📁` : `${ansi.fg.muted}  `;
        const name = f.isDir ? `${ansi.fg.accent}${f.name}/` : `${ansi.fg.gray}${f.name}`;
        lines.push(` ${indent}${icon} ${truncate(name, w - 3 - f.depth * 2)}${ansi.reset}`);
    }

    // Pad remaining
    while (lines.length < height) lines.push(padRight("", w));
    return lines.map(l => padRight(l, w));
}

// ── CHAT AREA ──
function renderChat(width, height) {
    const lines = [];
    const w = width;

    if (state.chatHistory.length === 0) {
        // Welcome screen
        const welcome = [
            "",
            `${ansi.fg.mammoth}${ansi.bold}  🦣 Welcome to Mammoth${ansi.reset}`,
            "",
            `${ansi.fg.muted}  AI 코딩 + 에이전트 마켓플레이스${ansi.reset}`,
            "",
            `${ansi.fg.gray}  메시지를 입력하거나 슬래시 명령어를 사용하세요:${ansi.reset}`,
            "",
            `${ansi.fg.accent}  /model${ansi.fg.gray}       AI 모델 전환`,
            `${ansi.fg.accent}  /market${ansi.fg.gray}      마켓 오퍼 & Ask`,
            `${ansi.fg.accent}  /agents${ansi.fg.gray}      에이전트 목록`,
            `${ansi.fg.accent}  /discover${ansi.fg.gray}    전문가 에이전트 검색`,
            `${ansi.fg.accent}  /inbox${ansi.fg.gray}       A2A 메시지`,
            `${ansi.fg.accent}  /status${ansi.fg.gray}      노드 상태`,
            `${ansi.fg.accent}  /help${ansi.fg.gray}        전체 명령어`,
            "",
            `${ansi.fg.muted}  Provider: ${ansi.fg.white}${providers[state.activeProvider]?.name}`,
            `${ansi.fg.muted}  Node: ${state.connected ? `${ansi.fg.success}Connected` : `${ansi.fg.error}Disconnected`}`,
        ];
        // Center vertically
        const padTop = Math.max(0, Math.floor((height - welcome.length) / 3));
        for (let i = 0; i < padTop; i++) lines.push("");
        lines.push(...welcome);
    } else {
        // Render chat messages
        const msgLines = [];
        for (const msg of state.chatHistory) {
            if (msg.role === "user") {
                msgLines.push(`${ansi.fg.accent}${ansi.bold} You:${ansi.reset}`);
                const wrapped = wrapText(msg.text, w - 3);
                for (const line of wrapped) {
                    msgLines.push(`${ansi.fg.white} ${line}${ansi.reset}`);
                }
                msgLines.push("");
            } else if (msg.role === "ai") {
                const icon = state.streaming && msg === state.chatHistory[state.chatHistory.length - 1] ? "⟳" : "🤖";
                msgLines.push(`${ansi.fg.green}${ansi.bold} ${icon} AI:${ansi.reset}`);
                const wrapped = wrapText(msg.text, w - 3);
                for (const line of wrapped) {
                    msgLines.push(`${ansi.fg.gray} ${line}${ansi.reset}`);
                }
                msgLines.push("");
            } else if (msg.role === "system") {
                msgLines.push(`${ansi.fg.yellow} ⚡ ${msg.text}${ansi.reset}`);
                msgLines.push("");
            } else if (msg.role === "tool") {
                msgLines.push(`${ansi.fg.cyan} 🔧 ${truncate(msg.text, w - 5)}${ansi.reset}`);
            }
        }

        // Auto-scroll to bottom
        const visibleLines = msgLines.slice(-(height));
        lines.push(...visibleLines);
    }

    while (lines.length < height) lines.push("");
    return lines.slice(0, height).map(l => ` ${truncate(l, w - 1)}`);
}

// ── RIGHT PANEL ──
function renderPanel(width, height) {
    const lines = [];
    const w = width;

    // Agents section
    lines.push(`${ansi.fg.accent}${ansi.bold} AGENTS${ansi.reset}`);
    lines.push(`${ansi.fg.muted} ${safeRepeat("─", w - 2)}`);

    if (state.agents.length === 0) {
        lines.push(`${ansi.fg.muted} (없음)${ansi.reset}`);
    } else {
        for (const agent of state.agents.slice(0, 5)) {
            const name = agent.name || agent.agentId || "?";
            const rep = agent.reputation?.score != null ? `★${agent.reputation.score}` : "";
            const bal = agent.balance ?? agent.spendable?.CREDIT ?? 0;
            const status = agent.status === "ACTIVE" ? `${ansi.fg.success}●` : `${ansi.fg.warn}○`;
            lines.push(` ${status} ${ansi.fg.white}${truncate(name, w - 12)} ${ansi.fg.muted}₵${Math.round(bal)}${rep ? ` ${ansi.fg.yellow}${rep}` : ""}${ansi.reset}`);
        }
    }

    lines.push("");

    // Market section
    lines.push(`${ansi.fg.accent}${ansi.bold} MARKET${ansi.reset}`);
    lines.push(`${ansi.fg.muted} ${"─".repeat(w - 2)}`);
    lines.push(` ${ansi.fg.green}Offers: ${ansi.fg.white}${state.market.offers.length}${ansi.reset}`);
    lines.push(` ${ansi.fg.yellow}Asks:   ${ansi.fg.white}${state.market.asks.length}${ansi.reset}`);

    // Show recent offers
    for (const offer of state.market.offers.slice(0, 3)) {
        const topic = offer.topic || "?";
        const price = offer.price || 0;
        lines.push(` ${ansi.fg.muted}  ${truncate(topic, w - 10)} ${ansi.fg.green}₵${price}${ansi.reset}`);
    }

    lines.push("");

    // A2A Inbox
    lines.push(`${ansi.fg.accent}${ansi.bold} A2A INBOX${ansi.reset}`);
    lines.push(`${ansi.fg.muted} ${"─".repeat(w - 2)}`);
    const unread = state.inbox.length;
    if (unread > 0) {
        lines.push(` ${ansi.fg.mammoth}📨 ${unread} messages${ansi.reset}`);
        for (const msg of state.inbox.slice(0, 3)) {
            const from = msg.from || "?";
            const type = msg.type || "msg";
            lines.push(` ${ansi.fg.muted}  ${truncate(from, w - 12)} ${ansi.fg.cyan}${type}${ansi.reset}`);
        }
    } else {
        lines.push(` ${ansi.fg.muted}(없음)${ansi.reset}`);
    }

    lines.push("");

    // Obligations
    lines.push(`${ansi.fg.accent}${ansi.bold} OBLIGATIONS${ansi.reset}`);
    lines.push(`${ansi.fg.muted} ${"─".repeat(w - 2)}`);
    const pendingObl = state.obligations.filter(o => o.status === "PENDING");
    if (pendingObl.length > 0) {
        lines.push(` ${ansi.fg.warn}⚠ ${pendingObl.length} pending${ansi.reset}`);
    } else {
        lines.push(` ${ansi.fg.success}✓ all clear${ansi.reset}`);
    }

    lines.push("");
    lines.push(`${ansi.fg.muted} ── Quick ──${ansi.reset}`);
    lines.push(` ${ansi.fg.accent}/market  /agents${ansi.reset}`);
    lines.push(` ${ansi.fg.accent}/inbox   /claims${ansi.reset}`);
    lines.push(` ${ansi.fg.accent}/discover /status${ansi.reset}`);

    while (lines.length < height) lines.push("");
    return lines.slice(0, height).map(l => padRight(l, w));
}

// ══════════════════════════════════════════════════════════════
// AI CHAT ENGINE
// ══════════════════════════════════════════════════════════════
function buildSystemPrompt() {
    const agentList = state.agents.map(a =>
        `- ${a.name || a.agentId} (${a.role || "agent"}, ₵${a.balance || a.spendable?.CREDIT || 0}, rep: ${a.reputation?.score ?? "N/A"})`
    ).join("\n");

    return `당신은 Mammoth AI 어시스턴트입니다.
사용자가 코딩을 하면서 다른 에이전트와 협업할 수 있도록 도와줍니다.

현재 Mammoth 노드 상태:
- 연결: ${state.connected ? "정상" : "미연결"}
- 등록된 에이전트: ${state.agents.length}개
${agentList}
- 마켓 오퍼: ${state.market.offers.length}개
- 마켓 Ask: ${state.market.asks.length}개
- A2A 메시지: ${state.inbox.length}개
- BARTER 의무: ${state.obligations.length}개

사용자가 에이전트 찾기, 마켓 거래, A2A 메시지 등을 요청하면
구체적인 조언과 다음 단계를 제안하세요.

작업 디렉토리: ${CWD}`;
}

async function sendToGemini(userMsg) {
    if (!GEMINI_KEY) {
        pushChat("system", "⚠ GEMINI_API_KEY가 설정되지 않았습니다. 환경변수를 확인하세요.");
        return;
    }

    const messages = state.chatHistory
        .filter(m => m.role === "user" || m.role === "ai")
        .slice(-10)
        .map(m => ({
            role: m.role === "user" ? "user" : "model",
            parts: [{ text: m.text }],
        }));

    const body = {
        system_instruction: { parts: [{ text: buildSystemPrompt() }] },
        contents: messages,
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    };

    state.streaming = true;
    pushChat("ai", "");
    render();

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${providers.gemini.model}:generateContent?key=${GEMINI_KEY}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        if (data.error) {
            state.chatHistory[state.chatHistory.length - 1].text = `❌ Error: ${data.error.message}`;
        } else {
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "(빈 응답)";
            state.chatHistory[state.chatHistory.length - 1].text = text;
        }
    } catch (e) {
        state.chatHistory[state.chatHistory.length - 1].text = `❌ Network error: ${e.message}`;
    }

    state.streaming = false;
    render();
}

async function sendToAI(userMsg) {
    pushChat("user", userMsg);
    render();

    const provider = state.activeProvider;
    if (provider === "gemini") {
        await sendToGemini(userMsg);
    } else if (provider === "claude") {
        if (!ANTHROPIC_KEY) {
            pushChat("system", "⚠ ANTHROPIC_API_KEY가 설정되지 않았습니다.");
            render();
            return;
        }
        await sendToClaude(userMsg);
    } else if (provider === "openai") {
        if (!OPENAI_KEY) {
            pushChat("system", "⚠ OPENAI_API_KEY가 설정되지 않았습니다.");
            render();
            return;
        }
        await sendToOpenAI(userMsg);
    }
}

async function sendToClaude(userMsg) {
    const messages = state.chatHistory
        .filter(m => m.role === "user" || m.role === "ai")
        .slice(-10)
        .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));

    state.streaming = true;
    pushChat("ai", "");
    render();

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: providers.claude.model,
                max_tokens: 4096,
                system: buildSystemPrompt(),
                messages,
            }),
        });
        const data = await res.json();
        if (data.error) {
            state.chatHistory[state.chatHistory.length - 1].text = `❌ ${data.error.message}`;
        } else {
            state.chatHistory[state.chatHistory.length - 1].text = data.content?.[0]?.text || "(빈 응답)";
        }
    } catch (e) {
        state.chatHistory[state.chatHistory.length - 1].text = `❌ ${e.message}`;
    }
    state.streaming = false;
    render();
}

async function sendToOpenAI(userMsg) {
    const messages = [
        { role: "system", content: buildSystemPrompt() },
        ...state.chatHistory
            .filter(m => m.role === "user" || m.role === "ai")
            .slice(-10)
            .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
    ];

    state.streaming = true;
    pushChat("ai", "");
    render();

    try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
            body: JSON.stringify({ model: providers.openai.model, messages, max_tokens: 4096 }),
        });
        const data = await res.json();
        if (data.error) {
            state.chatHistory[state.chatHistory.length - 1].text = `❌ ${data.error.message}`;
        } else {
            state.chatHistory[state.chatHistory.length - 1].text = data.choices?.[0]?.message?.content || "(빈 응답)";
        }
    } catch (e) {
        state.chatHistory[state.chatHistory.length - 1].text = `❌ ${e.message}`;
    }
    state.streaming = false;
    render();
}

function pushChat(role, text) {
    state.chatHistory.push({ role, text, ts: Date.now() });
}

// ══════════════════════════════════════════════════════════════
// SLASH COMMANDS
// ══════════════════════════════════════════════════════════════
async function handleSlashCommand(input) {
    const [cmd, ...args] = input.trim().split(/\s+/);
    const arg = args.join(" ");

    switch (cmd) {
        case "/help":
            pushChat("system", `사용 가능한 명령어:
/model [gemini|claude|openai] — AI 모델 전환
/status — 노드 상태 조회
/agents — 에이전트 목록
/register <name> — 에이전트 등록
/market — 마켓 현황
/offer <agentId> <topic> <price> — 오퍼 등록
/ask <agentId> <topic> — Ask 등록
/discover <topic> — 전문가 검색
/inbox — A2A 메시지 확인
/contact <from> <to> — 연락 보내기
/claims — 청구 목록
/obligations — BARTER 의무
/fund <agentId> <amount> — 잔고 충전
/clear — 채팅 초기화`);
            break;

        case "/model": {
            const target = arg.toLowerCase();
            if (target === "gemini" || target === "claude" || target === "openai") {
                state.activeProvider = target;
                pushChat("system", `모델 전환: ${providers[target].name}`);
            } else {
                pushChat("system", `사용 가능: gemini, claude, openai. 현재: ${state.activeProvider}`);
            }
            break;
        }

        case "/status": {
            await refreshDaemonData();
            if (state.nodeSummary) {
                const s = state.nodeSummary;
                pushChat("system", `노드 상태:
  agents: ${s.agentCount ?? "?"}
  intents: ${s.intentCount ?? "?"}
  market offers: ${s.offerCount ?? state.market.offers.length}
  market asks: ${s.askCount ?? state.market.asks.length}
  events: ${s.eventCount ?? "?"}`);
            } else {
                pushChat("system", "노드 연결 실패. 데몬이 실행 중인지 확인하세요.");
            }
            break;
        }

        case "/agents": {
            await refreshDaemonData();
            if (state.agents.length === 0) {
                pushChat("system", "등록된 에이전트 없음. /register <name> 으로 등록하세요.");
            } else {
                const list = state.agents.map(a => {
                    const name = a.name || a.agentId;
                    const bal = a.balance ?? a.spendable?.CREDIT ?? 0;
                    const rep = a.reputation?.score ?? "N/A";
                    return `  ${name} | ₵${bal} | ★${rep} | ${a.role || "agent"}`;
                }).join("\n");
                pushChat("system", `에이전트 목록 (${state.agents.length}):\n${list}`);
            }
            break;
        }

        case "/register": {
            if (!arg) { pushChat("system", "사용법: /register <이름>"); break; }
            const res = await mapi("POST", "/v1/agents/register", { name: arg, role: "both", topics: [], balance: 1000 });
            if (res.error) {
                pushChat("system", `등록 실패: ${res.error}`);
            } else {
                pushChat("system", `에이전트 등록 완료: ${res.agent?.name || arg} (₵${res.agent?.balance || 1000})`);
                await refreshDaemonData();
            }
            break;
        }

        case "/market": {
            await refreshDaemonData();
            let text = `마켓 현황:\n  Offers: ${state.market.offers.length} | Asks: ${state.market.asks.length}\n`;
            if (state.market.offers.length > 0) {
                text += "\n  최근 Offers:\n";
                for (const o of state.market.offers.slice(0, 5)) {
                    text += `    ${o.offerId?.slice(0, 12) || "?"} | ${o.topic} | ₵${o.price} | ${o.providerAgentId?.slice(0, 12) || "?"}\n`;
                }
            }
            if (state.market.asks.length > 0) {
                text += "\n  최근 Asks:\n";
                for (const a of state.market.asks.slice(0, 5)) {
                    text += `    ${a.askId?.slice(0, 12) || "?"} | ${a.topic} | max ₵${a.maxPrice || "?"}\n`;
                }
            }
            pushChat("system", text);
            break;
        }

        case "/discover": {
            if (!arg) { pushChat("system", "사용법: /discover <토픽> (예: /discover code_review)"); break; }
            const res = await mapi("POST", "/v1/a2a/discover", { topic: arg });
            if (res.error) {
                pushChat("system", `검색 실패: ${res.error}`);
            } else {
                const agents = res.agents || [];
                if (agents.length === 0) {
                    pushChat("system", `'${arg}' 토픽 전문가 없음.`);
                } else {
                    const list = agents.map(a => {
                        const rep = a.reputation?.score ?? "N/A";
                        const success = a.reputation?.successRate ?? "N/A";
                        return `  ${a.name || a.agentId} | ★${rep} | 성공률 ${success}% | ₵${a.balance || 0}`;
                    }).join("\n");
                    pushChat("system", `'${arg}' 전문가 (${agents.length}):\n${list}`);
                }
            }
            break;
        }

        case "/inbox": {
            await refreshDaemonData();
            if (state.inbox.length === 0) {
                pushChat("system", "수신함 비어있음.");
            } else {
                const list = state.inbox.slice(0, 10).map(m =>
                    `  [${m.type}] from: ${m.from?.slice(0, 15) || "?"} → ${m.to?.slice(0, 15) || "?"}`
                ).join("\n");
                pushChat("system", `A2A 메시지 (${state.inbox.length}):\n${list}`);
            }
            break;
        }

        case "/contact": {
            const parts = arg.split(/\s+/);
            if (parts.length < 2) { pushChat("system", "사용법: /contact <fromAgentId> <toAgentId>"); break; }
            const res = await mapi("POST", "/v1/a2a/contact-offer", { from: parts[0], to: parts[1], topic: parts[2] || "general" });
            if (res.error) pushChat("system", `실패: ${res.error}`);
            else pushChat("system", `연락 제안 전송 완료: ${res.message?.msgId || "OK"}`);
            break;
        }

        case "/offer": {
            const parts = arg.split(/\s+/);
            if (parts.length < 3) { pushChat("system", "사용법: /offer <agentId> <topic> <price>"); break; }
            const res = await mapi("POST", "/v1/market/offers", {
                providerAgentId: parts[0], topic: parts[1], price: Number(parts[2]) || 10, description: parts.slice(3).join(" ") || ""
            });
            if (res.error) pushChat("system", `실패: ${res.error}`);
            else pushChat("system", `오퍼 등록: ${res.offer?.offerId || "OK"} (₵${parts[2]})`);
            await refreshDaemonData();
            break;
        }

        case "/ask": {
            const parts = arg.split(/\s+/);
            if (parts.length < 2) { pushChat("system", "사용법: /ask <agentId> <topic> [maxPrice]"); break; }
            const res = await mapi("POST", "/v1/market/asks", {
                requesterAgentId: parts[0], topic: parts[1], maxPrice: Number(parts[2]) || 100
            });
            if (res.error) pushChat("system", `실패: ${res.error}`);
            else pushChat("system", `Ask 등록: ${res.ask?.askId || "OK"}`);
            await refreshDaemonData();
            break;
        }

        case "/claims": {
            const res = await mapi("GET", "/v1/claims");
            const claims = res.claims ? (Array.isArray(res.claims) ? res.claims : Object.values(res.claims)) : [];
            if (claims.length === 0) {
                pushChat("system", "청구 없음.");
            } else {
                const list = claims.slice(0, 10).map(c =>
                    `  ${c.claimId?.slice(0, 12) || "?"} | ₵${c.amount || 0} | ${c.status}`
                ).join("\n");
                pushChat("system", `청구 목록 (${claims.length}):\n${list}`);
            }
            break;
        }

        case "/obligations": {
            await refreshDaemonData();
            if (state.obligations.length === 0) {
                pushChat("system", "BARTER 의무 없음 ✓");
            } else {
                const list = state.obligations.map(o =>
                    `  ${o.obligationId?.slice(0, 12) || "?"} | ${o.status} | due: ${o.dueAt || "?"}`
                ).join("\n");
                pushChat("system", `의무 목록 (${state.obligations.length}):\n${list}`);
            }
            break;
        }

        case "/fund": {
            const parts = arg.split(/\s+/);
            if (parts.length < 2) { pushChat("system", "사용법: /fund <agentId> <amount>"); break; }
            const res = await mapi("POST", "/v1/agents/fund", { agentId: parts[0], amount: Number(parts[1]) || 100 });
            if (res.error) pushChat("system", `실패: ${res.error}`);
            else pushChat("system", `충전 완료: ${parts[0]} ← ₵${parts[1]}`);
            await refreshDaemonData();
            break;
        }

        case "/clear":
            state.chatHistory = [];
            break;

        default:
            pushChat("system", `알 수 없는 명령어: ${cmd}. /help 를 참조하세요.`);
    }
    render();
}

// ══════════════════════════════════════════════════════════════
// INPUT HANDLING
// ══════════════════════════════════════════════════════════════
async function handleSubmit() {
    const input = state.inputBuffer.trim();
    state.inputBuffer = "";
    state.inputCursorPos = 0;

    if (!input) return;

    // Save to history
    state.cmdHistory.unshift(input);
    if (state.cmdHistory.length > 100) state.cmdHistory.pop();
    state.cmdHistoryIdx = -1;

    // Slash command?
    if (input.startsWith("/")) {
        await handleSlashCommand(input);
        return;
    }

    // AI chat
    await sendToAI(input);
}

function handleKeypress(key, data) {
    // Ctrl+C — exit
    if (data?.ctrl && data?.name === "c") {
        cleanup();
        process.exit(0);
    }

    // Tab — cycle mode
    if (data?.name === "tab") {
        const modes = ["chat", "command"];
        const idx = modes.indexOf(state.mode);
        state.mode = modes[(idx + 1) % modes.length];
        render();
        return;
    }

    // Enter
    if (data?.name === "return") {
        handleSubmit();
        return;
    }

    // Backspace
    if (data?.name === "backspace") {
        if (state.inputBuffer.length > 0) {
            state.inputBuffer = state.inputBuffer.slice(0, -1);
            render();
        }
        return;
    }

    // Arrow up — history
    if (data?.name === "up") {
        if (state.cmdHistory.length > 0) {
            state.cmdHistoryIdx = Math.min(state.cmdHistoryIdx + 1, state.cmdHistory.length - 1);
            state.inputBuffer = state.cmdHistory[state.cmdHistoryIdx];
            render();
        }
        return;
    }

    // Arrow down — history
    if (data?.name === "down") {
        if (state.cmdHistoryIdx > 0) {
            state.cmdHistoryIdx--;
            state.inputBuffer = state.cmdHistory[state.cmdHistoryIdx];
        } else {
            state.cmdHistoryIdx = -1;
            state.inputBuffer = "";
        }
        render();
        return;
    }

    // Regular character
    if (key && !data?.ctrl && !data?.meta && key.length === 1) {
        state.inputBuffer += key;
        render();
    }
}

// ══════════════════════════════════════════════════════════════
// LIFECYCLE
// ══════════════════════════════════════════════════════════════
function cleanup() {
    w(ansi.showCursor + ansi.mainScreen);
    process.stdin.setRawMode?.(false);
}

async function main() {
    // Enter alternate screen
    w(ansi.altScreen + ansi.clear + ansi.hideCursor);

    // Raw mode for keypress
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const readline = await import("node:readline");
        readline.emitKeypressEvents(process.stdin);
        process.stdin.on("keypress", handleKeypress);
    }

    // Handle resize
    process.stdout.on("resize", () => render());

    // Handle exit
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
    process.on("exit", cleanup);

    // Load initial data
    await Promise.all([
        refreshDaemonData(),
        loadFileTree(CWD, 0, 2).then(tree => { state.fileTree = tree; }),
    ]);

    // Initial render
    render();

    // Periodic data refresh
    setInterval(async () => {
        await refreshDaemonData();
        if (!state.streaming) render();
    }, 10000);
}

main().catch(e => {
    cleanup();
    console.error("Fatal:", e);
    process.exit(1);
});
