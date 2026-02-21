#!/usr/bin/env node

/**
 * Mammoth Shell — Command-prompt style A2P interface
 * 
 * Codex / Claude CLI + Mammoth 전체 기능 통합 커맨드 프롬프트
 * 에이전트 등록, 거래, A2A 메시지, 마켓 Q&A, 클레임, 피어 관리 등
 */

import process from "node:process";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const NODE_URL = process.env.MAMMOTH_NODE_URL || "http://127.0.0.1:7340";
const NODE_TOKEN = process.env.MAMMOTH_NODE_TOKEN || "local-dev-token";
const CODEX_ASK_CMD = process.env.MAMMOTH_CODEX_ASK_CMD || "codex {prompt}";
const CLAUDE_ASK_CMD = process.env.MAMMOTH_CLAUDE_ASK_CMD || "claude -p {prompt}";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.join(__dirname, "mammoth.mjs");

/* ─────────── ANSI Colors ─────────── */

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgGray: "\x1b[100m",
  bgCyan: "\x1b[46m",
};

function paint(text, ...codes) {
  return `${codes.join("")}${text}${C.reset}`;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

/* ─────────── Utilities ─────────── */

function nowIso() {
  return new Date().toISOString();
}

function shortTime(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(11, 19) : "??:??:??";
}

function truncate(text, max = 60) {
  const s = String(text ?? "");
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function padRight(text, width) {
  const s = stripAnsi(String(text));
  return String(text) + " ".repeat(Math.max(0, width - s.length));
}

function parseArgs(input) {
  const result = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let m;
  while ((m = pattern.exec(input)) !== null) {
    result.push(m[1] ?? m[2] ?? m[0]);
  }
  return result;
}

function findFlag(args, name, defaultVal = undefined) {
  const idx = args.indexOf(name);
  if (idx < 0) return defaultVal;
  return args[idx + 1] !== undefined ? args[idx + 1] : defaultVal;
}

function removeFlags(args, ...flags) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) {
      i++; // skip value
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

/* ─────────── Table Formatter ─────────── */

function drawTable(headers, rows) {
  if (!rows || rows.length === 0) {
    println(paint("  (empty)", C.dim));
    return;
  }

  const widths = headers.map((h, i) => {
    const dataMax = Math.max(...rows.map(r => stripAnsi(String(r[i] ?? "")).length));
    return Math.max(stripAnsi(h).length, dataMax) + 2;
  });

  const divider = "  " + widths.map(w => "─".repeat(w)).join("─┬─");
  const headerLine = "  " + headers.map((h, i) => paint(padRight(h, widths[i]), C.bold, C.cyan)).join(" │ ");

  println(headerLine);
  println(paint(divider, C.dim));

  for (const row of rows) {
    const line = "  " + row.map((cell, i) => padRight(String(cell ?? "-"), widths[i])).join(" │ ");
    println(line);
  }
}

/* ─────────── Output ─────────── */

let rl = null;

function println(text = "") {
  console.log(text);
}

function printSection(title) {
  println();
  println(paint(`━━━ ${title} ━━━`, C.bold, C.yellow));
  println();
}

function printSuccess(msg) {
  println(paint(`  ✓ ${msg}`, C.green));
}

function printError(msg) {
  println(paint(`  ✗ ${msg}`, C.red));
}

function printInfo(msg) {
  println(paint(`  ℹ ${msg}`, C.cyan));
}

function printWarn(msg) {
  println(paint(`  ⚠ ${msg}`, C.yellow));
}

/* ─────────── API Client ─────────── */

async function api(method, path, body = null) {
  const headers = {
    "content-type": "application/json",
    "x-mammoth-token": NODE_TOKEN,
    "x-mammoth-role": "owner",
  };

  let res;
  try {
    res = await fetch(`${NODE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Node unreachable at ${NODE_URL}. Start daemon first (npm run daemon).`);
  }

  const raw = await res.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!res.ok) {
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return payload;
}

/* ─────────── Provider (Codex/Claude) ─────────── */

function resolveProvider(template, prompt) {
  const tokens = parseArgs(template);
  if (!tokens.length) throw new Error("empty provider template");
  let replaced = false;
  const resolved = tokens.map(t => {
    if (t.includes("{prompt}")) { replaced = true; return t.replaceAll("{prompt}", prompt); }
    return t;
  });
  if (!replaced) resolved.push(prompt);
  return { command: resolved[0], args: resolved.slice(1) };
}

async function askProvider(providerKey, prompt) {
  const template = providerKey === "codex" ? CODEX_ASK_CMD : CLAUDE_ASK_CMD;
  const label = providerKey.toUpperCase();
  printInfo(`${label}에 질의 중...`);

  const { command, args } = resolveProvider(template, prompt);
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = String(stdout || stderr || "").trim();
    println();
    println(paint(`  ┌─ ${label} ─────────────────────`, C.magenta));
    for (const line of output.split("\n")) {
      println(paint(`  │ `, C.magenta) + line);
    }
    println(paint(`  └──────────────────────────────`, C.magenta));
    return output;
  } catch (err) {
    throw new Error(`${label} 실행 실패: ${err.message}. 환경변수 확인 필요.`);
  }
}

/* ─────────── CLI Forwarding ─────────── */

async function runCliJson(cliArgs) {
  const fullArgs = [CLI_PATH, "--json", ...cliArgs];
  try {
    const { stdout } = await execFileAsync(process.execPath, fullArgs, {
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout || "{}");
  } catch (err) {
    const stderr = String(err?.stderr || "").trim();
    throw new Error(stderr || err.message);
  }
}

/* ═══════════════════════════════════════════════════════
   COMMAND HANDLERS
   ═══════════════════════════════════════════════════════ */

async function cmdHelp() {
  printSection("MAMMOTH SHELL — 커맨드 목록");

  println(paint("  기본", C.bold));
  println("    help                         이 도움말");
  println("    status                       노드 상태 요약");
  println("    timeline [N]                 최근 이벤트 (기본 20)");
  println("    clear                        화면 초기화");
  println("    exit / quit                  종료");
  println();

  println(paint("  에이전트", C.bold));
  println("    agents                       에이전트 목록");
  println("    agent register <name> <topics>  에이전트 등록 (topics: 쉼표 구분)");
  println("    agent show <id>              에이전트 상세");
  println("    agent fund <id> <amount>     에이전트 펀딩 (CREDIT)");
  println("    agent policy <id>            에이전트 정책 보기");
  println();

  println(paint("  인텐트 & 실행", C.bold));
  println('    intent <agent_id> "goal" [--budget N]   인텐트 생성 + 실행');
  println();

  println(paint("  마켓 Q&A", C.bold));
  println("    offers                       오퍼 목록");
  println('    offer <agent_id> <topic> [--price N] [--mode PAID|FREE|BARTER]');
  println("                                 오퍼 등록");
  println('    ask <agent_id> "question" [--topic T] [--budget N]');
  println("                                 다른 에이전트에 질문");
  println("    obligations                  의무(Barter) 목록");
  println();

  println(paint("  A2A 통신", C.bold));
  println("    a2a discover <agent_id>      에이전트 발견");
  println('    a2a offer <from> <to> "topic"  연락 제안');
  println("    a2a accept <msg_id>          연락 수락");
  println("    a2a refuse <msg_id> [code]   연락 거부");
  println("    a2a inbox [agent_id]         수신함");
  println();

  println(paint("  클레임 & 정산", C.bold));
  println("    claims                       클레임 목록");
  println("    claim request <agent_id>     클레임 요청");
  println("    claim execute <claim_id>     클레임 실행");
  println();

  println(paint("  피어", C.bold));
  println("    peers                        피어 목록");
  println("    peer add <url> [--token T]   피어 추가");
  println("    peer ping <peer_id>          피어 핑");
  println("    peer sync                    전체 동기화");
  println();

  println(paint("  AI 프로바이더", C.bold));
  println('    @codex "prompt"              Codex CLI 질의');
  println('    @claude "prompt"             Claude CLI 질의');
  println('    @both "prompt"               양쪽 동시 질의');
  println();

  println(paint("  유틸", C.bold));
  println("    quickstart [--mode PAID|BARTER|BOTH]  자동 부트스트랩");
  println("    doctor                       노드 진단");
  println("    treasury                     플랫폼 수익");
}

async function cmdStatus() {
  printSection("노드 상태");
  try {
    const { summary: s } = await api("GET", "/v1/observer/summary");
    println(`  Node ID      ${paint(s.nodeId || "-", C.cyan)}`);
    println(`  Agents       ${s.agents ?? 0}`);
    println(`  Intents      ${s.intents ?? 0} (open: ${s.openIntents ?? 0})`);
    println(`  Actions      ${s.executedActions ?? 0} executed`);
    println(`  Messages     ${s.messages ?? 0} (pending: ${s.pendingMessages ?? 0})`);
    println(`  Claims       ${s.claims ?? 0} (requested: ${s.claimRequested ?? 0})`);
    println(`  Peers        ${s.peers ?? 0} (online: ${s.peersOnline ?? 0})`);
    println(`  Avg Rep      ${s.averageReputation ?? 0}`);
    println(`  Payout       ${s.totalPayout ?? 0} CREDIT`);
    println();
    println(paint("  마켓", C.bold));
    println(`  Offers       ${s.marketOffers ?? 0}`);
    println(`  Asks         ${s.marketAsks ?? 0}`);
    println(`  Volume       ${s.marketVolume ?? 0}`);
    println(`  Obligations  ${s.marketObligations ?? 0} (open: ${s.marketOpenObligations ?? 0})`);
    println();
    println(paint("  플랫폼", C.bold));
    println(`  Tax          ${s.platformTaxBps ?? 0} bps (${((s.platformTaxBps ?? 0) / 100).toFixed(1)}%)`);
    println(`  Treasury     ${s.platformRevenueCredit ?? 0} CREDIT | ${s.platformRevenueUSDC ?? 0} USDC | ${s.platformRevenueUSDT ?? 0} USDT`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdAgents() {
  printSection("에이전트 목록");
  try {
    const { agents } = await api("GET", "/v1/agents");
    if (!agents || agents.length === 0) {
      printInfo("등록된 에이전트가 없습니다. 'agent register <name> <topics>' 으로 등록하세요.");
      return;
    }
    drawTable(
      ["ID", "이름", "평판", "상태", "토픽", "잔액(CREDIT)"],
      agents.map(a => [
        a.agentId,
        a.name || "-",
        Number(a.reputation || 0).toFixed(2),
        a.status || "ACTIVE",
        (a.topics || []).join(", ") || "-",
        a.wallet?.spendable ?? 0,
      ])
    );
  } catch (err) {
    printError(err.message);
  }
}

async function cmdAgentRegister(args) {
  const name = args[0];
  const topicsRaw = args[1] || "";
  if (!name) {
    printWarn("사용법: agent register <name> <topics>");
    printInfo("예: agent register CodeReviewer code_review,testing");
    return;
  }
  const topics = topicsRaw.split(",").map(t => t.trim()).filter(Boolean);

  printInfo(`에이전트 '${name}' 등록 중...`);
  try {
    const { agent } = await api("POST", "/v1/agents/register", { name, topics });
    printSuccess(`에이전트 등록 완료!`);
    println(`  Agent ID     ${paint(agent.agentId, C.cyan)}`);
    println(`  Name         ${agent.name}`);
    println(`  Topics       ${(agent.topics || []).join(", ")}`);
    println(`  ETH Address  ${agent.wallet?.addresses?.eth || "-"}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdAgentShow(args) {
  const id = args[0];
  if (!id) { printWarn("사용법: agent show <agent_id>"); return; }
  try {
    const { agent } = await api("GET", `/v1/agents/${encodeURIComponent(id)}`);
    printSection(`에이전트: ${id}`);
    println(`  Name         ${agent.name}`);
    println(`  Status       ${agent.status}`);
    println(`  Reputation   ${Number(agent.reputation || 0).toFixed(4)}`);
    println(`  Topics       ${(agent.topics || []).join(", ") || "-"}`);
    println(`  Created      ${agent.createdAt || "-"}`);
    println();
    println(paint("  지갑", C.bold));
    println(`  Spendable    ${agent.wallet?.spendable ?? 0} CREDIT`);
    println(`  Spent        ${agent.wallet?.spent ?? 0} CREDIT`);
    println(`  Earned       ${agent.wallet?.earnedGross ?? 0} CREDIT`);
    println(`  ETH          ${agent.wallet?.addresses?.eth || "-"}`);
    if (agent.wallet?.assets) {
      const assets = agent.wallet.assets;
      println(`  USDC         ${assets.USDC ?? 0}`);
      println(`  USDT         ${assets.USDT ?? 0}`);
    }
    println();
    println(paint("  재무/정책", C.bold));
    println(`  Claimable    ${agent.treasury?.ownerClaimable ?? 0}`);
    println(`  Reserve      ${agent.treasury?.operatingReserve ?? 0}`);
    println(`  Locked       ${agent.treasury?.lockedSafety ?? 0}`);
    println(`  Block List   ${(agent.policy?.blockedSenders || []).length} senders`);
    println(`  Min Rep      ${agent.policy?.autoRefuseMinReputation ?? 0}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdAgentFund(args) {
  const id = args[0];
  const amount = Number(args[1]);
  if (!id || !Number.isFinite(amount) || amount <= 0) {
    printWarn("사용법: agent fund <agent_id> <amount>");
    return;
  }
  try {
    const { agent } = await api("POST", "/v1/agents/fund", { agentId: id, amount });
    printSuccess(`${id} 에이전트에 ${amount} CREDIT 충전 완료`);
    println(`  현재 잔액: ${agent.wallet?.spendable ?? 0} CREDIT`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdIntent(args) {
  const agentId = args[0];
  const rest = removeFlags(args.slice(1), "--budget");
  const goal = rest.join(" ").trim();
  const budget = Number(findFlag(args, "--budget", "10"));

  if (!agentId || !goal) {
    printWarn('사용법: intent <agent_id> "goal" [--budget N]');
    return;
  }

  printInfo(`인텐트 생성: ${agentId} → "${truncate(goal, 40)}" (budget: ${budget})`);
  try {
    const { intent } = await api("POST", "/v1/intents", {
      agentId, goal, budget, riskLevel: "low",
    });
    const intentId = intent.intentId;
    printSuccess(`인텐트 생성됨: ${intentId}`);

    printInfo("액션 실행 중...");
    const { action } = await api("POST", "/v1/actions/run", { agentId, intentId });
    printSuccess(`액션 실행 완료!`);
    println(`  Action ID    ${action.actionId}`);
    println(`  Status       ${action.status}`);
    if (action.settlement) {
      println(`  Payout       ${action.settlement.payout ?? 0} CREDIT`);
    }
  } catch (err) {
    printError(err.message);
  }
}

async function cmdOffers() {
  printSection("마켓 오퍼 목록");
  try {
    const { offers } = await api("GET", "/v1/market/offers?status=ACTIVE");
    if (!offers || offers.length === 0) {
      printInfo("활성 오퍼가 없습니다. 'offer <agent_id> <topic>' 으로 등록하세요.");
      return;
    }
    drawTable(
      ["Offer ID", "Provider", "Topic", "Mode", "Price", "Asset", "Barter Request"],
      offers.map(o => [
        o.offerId,
        o.providerAgentId,
        o.topic || "-",
        o.mode || "PAID",
        o.pricePerQuestion ?? 0,
        o.asset || "CREDIT",
        truncate(o.barterRequest || "-", 25),
      ])
    );
  } catch (err) {
    printError(err.message);
  }
}

async function cmdOfferRegister(args) {
  const agentId = args[0];
  const topic = args[1];
  if (!agentId || !topic) {
    printWarn("사용법: offer <agent_id> <topic> [--price N] [--mode PAID|FREE|BARTER]");
    return;
  }
  const price = Number(findFlag(args, "--price", "5"));
  const mode = findFlag(args, "--mode", "PAID");
  const barterRequest = findFlag(args, "--barter-request", "");

  try {
    const body = {
      providerAgentId: agentId,
      topic,
      pricePerQuestion: price,
      mode: mode.toUpperCase(),
      qualityHint: 0.8,
    };
    if (barterRequest) body.barterRequest = barterRequest;

    const { offer } = await api("POST", "/v1/market/offers", body);
    printSuccess(`오퍼 등록 완료!`);
    println(`  Offer ID     ${offer.offerId}`);
    println(`  Topic        ${offer.topic}`);
    println(`  Mode         ${offer.mode}`);
    println(`  Price        ${offer.pricePerQuestion} ${offer.asset || "CREDIT"}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdAsk(args) {
  const agentId = args[0];
  const rest = removeFlags(args.slice(1), "--topic", "--budget", "--mode");
  const question = rest.join(" ").trim();

  if (!agentId || !question) {
    printWarn('사용법: ask <agent_id> "question" [--topic T] [--budget N]');
    return;
  }

  const topic = findFlag(args, "--topic", "general");
  const budget = Number(findFlag(args, "--budget", "10"));
  const mode = findFlag(args, "--mode", "ANY");

  printInfo(`${agentId} 에이전트에 질문 중...`);
  println(paint(`  📨 "${truncate(question, 50)}"`, C.dim));

  try {
    const { execution, answer, obligation } = await api("POST", "/v1/market/ask", {
      requesterAgentId: agentId,
      topic,
      question,
      budget,
      modePreference: mode.toUpperCase(),
    });

    if (execution) {
      println();
      println(paint("  ┌─ 답변 ─────────────────────────────", C.green));
      println(paint(`  │ Provider: ${execution.providerAgentId || "-"}`, C.green));
      println(paint(`  │ Mode: ${execution.mode || "-"} | Price: ${execution.price ?? 0}`, C.green));
      println(paint(`  │`, C.green));

      const answerText = String(answer || execution.answer || "(답변 없음)");
      for (const line of answerText.split("\n")) {
        println(paint(`  │ `, C.green) + line);
      }
      println(paint("  └────────────────────────────────────", C.green));

      if (obligation) {
        println();
        printWarn(`Barter 의무 생성됨: ${obligation.obligationId}`);
        println(`  상태: ${obligation.status} | 기한: ${obligation.dueAt || "-"}`);
        println(`  요청: ${obligation.barterRequest || "-"}`);
      }
    } else {
      printWarn("매칭된 오퍼가 없습니다. 'offers' 로 확인하세요.");
    }
  } catch (err) {
    printError(err.message);
  }
}

async function cmdObligations() {
  printSection("Barter 의무 목록");
  try {
    const { obligations } = await api("GET", "/v1/market/obligations?limit=50");
    if (!obligations || obligations.length === 0) {
      printInfo("의무가 없습니다.");
      return;
    }
    drawTable(
      ["ID", "상태", "채무자", "채권자", "Barter 요청", "기한"],
      obligations.map(o => [
        o.obligationId,
        o.status,
        o.debtorAgentId,
        o.creditorAgentId,
        truncate(o.barterRequest || "-", 20),
        o.dueAt ? shortTime(o.dueAt) : "-",
      ])
    );
  } catch (err) {
    printError(err.message);
  }
}

async function cmdA2aDiscover(args) {
  const agentId = args[0];
  if (!agentId) { printWarn("사용법: a2a discover <agent_id>"); return; }
  try {
    const result = await api("POST", "/v1/a2a/discover", { agentId });
    printSection(`에이전트 발견: ${agentId}`);
    const candidates = result.candidates || [];
    if (candidates.length === 0) {
      printInfo("발견된 에이전트가 없습니다.");
      return;
    }
    drawTable(
      ["Agent ID", "이름", "평판", "토픽"],
      candidates.map(c => [c.agentId, c.name || "-", Number(c.reputation || 0).toFixed(2), (c.topics || []).join(", ")])
    );
  } catch (err) {
    printError(err.message);
  }
}

async function cmdA2aOffer(args) {
  const from = args[0];
  const to = args[1];
  const topic = args.slice(2).join(" ").trim() || "general";
  if (!from || !to) {
    printWarn('사용법: a2a offer <from_agent> <to_agent> "topic"');
    return;
  }
  try {
    const { message } = await api("POST", "/v1/a2a/contact-offer", {
      fromAgentId: from,
      toAgentId: to,
      topic,
      payload: { greeting: `Hello from ${from}` },
    });
    printSuccess(`연락 제안 전송됨!`);
    println(`  Message ID   ${message?.messageId || "-"}`);
    println(`  Status       ${message?.status || "-"}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdA2aAccept(args) {
  const msgId = args[0];
  if (!msgId) { printWarn("사용법: a2a accept <message_id>"); return; }
  try {
    const result = await api("POST", "/v1/a2a/contact-accept", { messageId: msgId });
    printSuccess(`연락 수락: ${msgId}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdA2aRefuse(args) {
  const msgId = args[0];
  const reasonCode = args[1] || "MANUAL_DENY";
  if (!msgId) { printWarn("사용법: a2a refuse <message_id> [reason_code]"); return; }
  try {
    await api("POST", "/v1/a2a/contact-refuse", { messageId: msgId, reasonCode });
    printSuccess(`연락 거부: ${msgId} (사유: ${reasonCode})`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdA2aInbox(args) {
  const agentId = args[0] || "";
  printSection("A2A 메시지 수신함");
  try {
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    const { messages } = await api("GET", `/v1/a2a/messages${query}`);
    if (!messages || messages.length === 0) {
      printInfo("수신 메시지가 없습니다.");
      return;
    }
    drawTable(
      ["ID", "유형", "보낸이", "받는이", "상태", "토픽", "시간"],
      messages.map(m => [
        m.messageId,
        m.type || "-",
        m.fromAgentId || "-",
        m.toAgentId || "-",
        m.status || "-",
        m.topic || "-",
        m.timestamp ? shortTime(m.timestamp) : "-",
      ])
    );
  } catch (err) {
    printError(err.message);
  }
}

async function cmdClaims() {
  printSection("클레임 목록");
  try {
    const { claims } = await api("GET", "/v1/claims");
    if (!claims || claims.length === 0) {
      printInfo("클레임이 없습니다.");
      return;
    }
    drawTable(
      ["Claim ID", "Agent ID", "상태", "금액", "요청 시간", "실행 후"],
      claims.map(c => [
        c.claimId,
        c.agentId,
        c.status,
        c.amount ?? "-",
        c.requestedAt ? shortTime(c.requestedAt) : "-",
        c.executeAfter ? shortTime(c.executeAfter) : "-",
      ])
    );
  } catch (err) {
    printError(err.message);
  }
}

async function cmdClaimRequest(args) {
  const agentId = args[0];
  if (!agentId) { printWarn("사용법: claim request <agent_id>"); return; }
  try {
    const { claim } = await api("POST", "/v1/claims/request", { agentId });
    printSuccess(`클레임 요청됨!`);
    println(`  Claim ID     ${claim.claimId}`);
    println(`  Amount       ${claim.amount ?? 0} CREDIT`);
    println(`  Execute After ${claim.executeAfter || "-"}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdClaimExecute(args) {
  const claimId = args[0];
  if (!claimId) { printWarn("사용법: claim execute <claim_id>"); return; }
  try {
    const { claim } = await api("POST", "/v1/claims/execute", { claimId });
    printSuccess(`클레임 실행 완료!`);
    println(`  Claim ID     ${claim.claimId}`);
    println(`  Amount       ${claim.amount ?? 0} CREDIT`);
    println(`  Status       ${claim.status}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdPeers() {
  printSection("피어 목록");
  try {
    const { peers } = await api("GET", "/v1/peers");
    if (!peers || peers.length === 0) {
      printInfo("등록된 피어가 없습니다. 'peer add <url>' 로 추가하세요.");
      return;
    }
    drawTable(
      ["Peer ID", "URL", "상태", "마지막 동기화", "Auth"],
      peers.map(p => [
        p.peerId,
        truncate(p.url || "-", 30),
        p.status || "-",
        p.lastSyncAt ? shortTime(p.lastSyncAt) : "never",
        p.hasAuthToken ? "✓" : "✗",
      ])
    );
  } catch (err) {
    printError(err.message);
  }
}

async function cmdPeerAdd(args) {
  const url = args[0];
  if (!url) { printWarn("사용법: peer add <url> [--token T]"); return; }
  const authToken = findFlag(args, "--token", "");
  try {
    const { peer } = await api("POST", "/v1/peers/add", { url, authToken });
    printSuccess(`피어 추가됨: ${peer.peerId}`);
    println(`  URL: ${peer.url}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdPeerPing(args) {
  const peerId = args[0];
  if (!peerId) { printWarn("사용법: peer ping <peer_id>"); return; }
  try {
    const result = await api("POST", "/v1/peers/ping", { peerId });
    printSuccess(`피어 핑 응답: ${result.status || "OK"}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdPeerSync() {
  printInfo("전체 피어 동기화 실행 중...");
  try {
    const result = await api("POST", "/v1/peers/sync", {});
    printSuccess(`동기화 완료`);
    if (result.results) {
      for (const r of result.results) {
        println(`  ${r.peerId}: ${r.status || "ok"}`);
      }
    }
  } catch (err) {
    printError(err.message);
  }
}

async function cmdTimeline(args) {
  const limit = Number(args[0]) || 20;
  printSection(`최근 이벤트 (${limit}개)`);
  try {
    const { events } = await api("GET", `/v1/observer/timeline?limit=${limit}`);
    if (!events || events.length === 0) {
      printInfo("이벤트가 없습니다.");
      return;
    }
    for (const evt of events) {
      const time = paint(shortTime(evt.timestamp), C.dim);
      const type = paint(evt.eventType, C.cyan, C.bold);
      println(`  ${time}  ${type}`);
      const payload = JSON.stringify(evt.payload || {});
      if (payload.length > 120) {
        println(paint(`    ${payload.slice(0, 117)}...`, C.dim));
      } else {
        println(paint(`    ${payload}`, C.dim));
      }
    }
  } catch (err) {
    printError(err.message);
  }
}

async function cmdTreasury() {
  printSection("플랫폼 수익 (Treasury)");
  try {
    const { summary: s } = await api("GET", "/v1/observer/summary");
    println(`  Tax Rate     ${s.platformTaxBps ?? 0} bps (${((s.platformTaxBps ?? 0) / 100).toFixed(1)}%)`);
    println(`  CREDIT       ${s.platformRevenueCredit ?? 0}`);
    println(`  USDC         ${s.platformRevenueUSDC ?? 0}`);
    println(`  USDT         ${s.platformRevenueUSDT ?? 0}`);
  } catch (err) {
    printError(err.message);
  }
}

async function cmdQuickstart(args) {
  const mode = findFlag(args, "--mode", "BOTH");
  printInfo(`부트스트랩 실행 중 (mode: ${mode})...`);
  try {
    const result = await runCliJson(["quickstart", "--mode", mode]);
    printSuccess("부트스트랩 완료!");
    if (result.summary) {
      println(`  Agents: ${result.summary.agents ?? 0}`);
      println(`  Offers: ${result.summary.marketOffers ?? 0}`);
      println(`  Volume: ${result.summary.marketVolume ?? 0}`);
    }
  } catch (err) {
    printError(err.message);
  }
}

async function cmdDoctor() {
  printSection("노드 진단 (Doctor)");
  try {
    const result = await runCliJson(["doctor"]);
    if (result.checks && Array.isArray(result.checks)) {
      for (const check of result.checks) {
        const icon = check.status === "PASS" ? paint("✓", C.green) :
          check.status === "WARN" ? paint("⚠", C.yellow) :
            paint("✗", C.red);
        println(`  ${icon}  ${check.name}`);
        if (check.detail) println(paint(`       ${check.detail}`, C.dim));
        if (check.fix) println(paint(`       fix: ${check.fix}`, C.yellow));
      }
    }
  } catch (err) {
    printError(err.message);
  }
}

/* ═══════════════════════════════════════════════════════
   COMMAND ROUTER
   ═══════════════════════════════════════════════════════ */

const COMMANDS = [
  "help", "status", "agents", "agent", "intent", "offers", "offer", "ask",
  "obligations", "a2a", "claims", "claim", "peers", "peer", "timeline",
  "treasury", "quickstart", "doctor", "clear", "exit", "quit",
  "@codex", "@claude", "@both",
];

async function dispatch(input) {
  const raw = input.trim();
  if (!raw) return;

  const args = parseArgs(raw);
  const head = args[0].toLowerCase();

  try {
    // AI Providers
    if (head === "@codex" || head === "@claude" || head === "@both") {
      const prompt = args.slice(1).join(" ").trim();
      if (!prompt) {
        printWarn(`사용법: ${head} "prompt"`);
        return;
      }
      if (head === "@both") {
        await Promise.all([
          askProvider("codex", prompt).catch(err => printError(`Codex: ${err.message}`)),
          askProvider("claude", prompt).catch(err => printError(`Claude: ${err.message}`)),
        ]);
      } else {
        await askProvider(head.slice(1), prompt);
      }
      return;
    }

    // Built-in
    if (head === "help" || head === "?") return cmdHelp();
    if (head === "status") return cmdStatus();
    if (head === "agents") return cmdAgents();
    if (head === "agent") {
      const sub = (args[1] || "").toLowerCase();
      if (sub === "register") return cmdAgentRegister(args.slice(2));
      if (sub === "show") return cmdAgentShow(args.slice(2));
      if (sub === "fund") return cmdAgentFund(args.slice(2));
      if (sub === "policy") return cmdAgentShow(args.slice(2)); // show includes policy
      printWarn("사용법: agent [register|show|fund|policy] ...");
      return;
    }
    if (head === "intent") return cmdIntent(args.slice(1));
    if (head === "offers") return cmdOffers();
    if (head === "offer") return cmdOfferRegister(args.slice(1));
    if (head === "ask") return cmdAsk(args.slice(1));
    if (head === "obligations") return cmdObligations();

    if (head === "a2a") {
      const sub = (args[1] || "").toLowerCase();
      if (sub === "discover") return cmdA2aDiscover(args.slice(2));
      if (sub === "offer") return cmdA2aOffer(args.slice(2));
      if (sub === "accept") return cmdA2aAccept(args.slice(2));
      if (sub === "refuse") return cmdA2aRefuse(args.slice(2));
      if (sub === "inbox") return cmdA2aInbox(args.slice(2));
      printWarn("사용법: a2a [discover|offer|accept|refuse|inbox] ...");
      return;
    }

    if (head === "claims") return cmdClaims();
    if (head === "claim") {
      const sub = (args[1] || "").toLowerCase();
      if (sub === "request") return cmdClaimRequest(args.slice(2));
      if (sub === "execute") return cmdClaimExecute(args.slice(2));
      printWarn("사용법: claim [request|execute] ...");
      return;
    }

    if (head === "peers") return cmdPeers();
    if (head === "peer") {
      const sub = (args[1] || "").toLowerCase();
      if (sub === "add") return cmdPeerAdd(args.slice(2));
      if (sub === "ping") return cmdPeerPing(args.slice(2));
      if (sub === "sync") return cmdPeerSync();
      printWarn("사용법: peer [add|ping|sync] ...");
      return;
    }

    if (head === "timeline") return cmdTimeline(args.slice(1));
    if (head === "treasury") return cmdTreasury();
    if (head === "quickstart") return cmdQuickstart(args.slice(1));
    if (head === "doctor") return cmdDoctor();

    if (head === "clear" || head === "cls") {
      console.clear();
      return;
    }

    if (head === "exit" || head === "quit") {
      println(paint("\n  👋 Mammoth Shell 종료. Bye!\n", C.dim));
      process.exit(0);
    }

    // Unknown → forward to CLI
    printInfo(`CLI 포워딩: mammoth ${args.join(" ")}`);
    try {
      const result = await runCliJson(args);
      println(JSON.stringify(result, null, 2));
    } catch (err) {
      printError(err.message);
    }

  } catch (err) {
    printError(`명령 처리 중 오류: ${err.message}`);
  }
}

/* ═══════════════════════════════════════════════════════
   MAIN — REPL
   ═══════════════════════════════════════════════════════ */

function printBanner() {
  const mammoth = [
    "         ___",
    "     .--'   '--.   ",
    "    /  .--. .--.\\  ",
    "   /  /  | |   \\ \\ ",
    "  |  |   | |    | |",
    "  |  \\   | |   / / ",
    "   \\  '--' '--'/   ",
    "    '----. .---'   ",
    "         | |       ",
    "        _| |_      ",
    "       |_____|  MAMMOTH SHELL",
  ];

  println();
  for (const line of mammoth) {
    println(paint(line, C.cyan));
  }
  println();
  println(paint("  🦣 Mammoth Shell v0.3.0", C.bold, C.white));
  println(paint(`  Node: ${NODE_URL}`, C.dim));
  println(paint("  \"Humans watch. Agents act.\"", C.dim, C.italic));
  println();
  println(paint("  'help' 입력으로 전체 커맨드 확인 | 'exit' 으로 종료", C.dim));
  println(paint("  ─".repeat(30), C.dim));
  println();
}

function completer(line) {
  const hits = COMMANDS.filter(c => c.startsWith(line.toLowerCase()));
  return [hits.length ? hits : COMMANDS, line];
}

async function main() {
  printBanner();

  // Quick health check
  try {
    await api("GET", "/health");
    printSuccess(`노드 연결 성공: ${NODE_URL}`);
  } catch {
    printWarn(`노드에 연결할 수 없습니다: ${NODE_URL}`);
    printInfo("'npm run daemon' 으로 데몬을 먼저 실행하세요.");
  }
  println();

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: paint("mammoth", C.bold, C.cyan) + paint("> ", C.bold),
    completer,
    terminal: true,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    await dispatch(line);
    println();
    rl.prompt();
  });

  rl.on("close", () => {
    println(paint("\n  👋 Bye!\n", C.dim));
    process.exit(0);
  });

  rl.on("SIGINT", () => {
    println(paint("\n  (Ctrl+C 으로 종료. 'exit' 입력도 가능)", C.dim));
    rl.prompt();
  });
}

main().catch(err => {
  console.error(`[mammoth-shell] ${err.message}`);
  process.exit(1);
});
