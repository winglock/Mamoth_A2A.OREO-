#!/usr/bin/env node
/**
 * Mammoth MCP Server
 * ------------------
 * Exposes the Mammoth node-daemon API as MCP (Model Context Protocol) tools.
 *
 * Transport : stdio (JSON-RPC 2.0, one JSON object per line)
 * Usage     : node mammoth-mcp.mjs          (uses default localhost:7340)
 *
 * OpenCode / oh-my-opencode 같은 MCP-aware TUI에서
 * 이 서버를 등록하면 AI 에이전트가 Mammoth 전체 기능을 도구로 사용할 수 있습니다.
 *
 * 환경변수:
 *   MAMMOTH_NODE_URL   – 노드 데몬 URL (default: http://127.0.0.1:7340)
 *   MAMMOTH_NODE_TOKEN – 인증 토큰    (default: local-dev-token)
 */

import { createInterface } from "node:readline";

const BASE = process.env.MAMMOTH_NODE_URL || "http://127.0.0.1:7340";
const TOKEN = process.env.MAMMOTH_NODE_TOKEN || "local-dev-token";

// ──────────────────────────────────────────────
// HTTP helper – call Mammoth node daemon
// ──────────────────────────────────────────────
async function api(method, path, body) {
    const opts = {
        method,
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${TOKEN}`
        }
    };
    if (body && method !== "GET") {
        opts.body = JSON.stringify(body);
    }
    let url = `${BASE}${path}`;
    if (method === "GET" && body) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(body)) {
            if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
        }
        const qs = params.toString();
        if (qs) url += `?${qs}`;
        opts.body = undefined;
    }
    const res = await fetch(url, opts);
    return res.json();
}

// ──────────────────────────────────────────────
// MCP Tool Definitions
// ──────────────────────────────────────────────
const TOOLS = [
    // === Status & Info ===
    {
        name: "mammoth_status",
        description: "노드 상태 및 요약 정보를 가져옵니다 (에이전트 수, 인텐트 수, 마켓 현황 등)",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => api("GET", "/v1/observer/summary")
    },
    {
        name: "mammoth_health",
        description: "노드 데몬 헬스체크 – 연결 상태 확인",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => api("GET", "/healthz")
    },
    {
        name: "mammoth_timeline",
        description: "최근 이벤트 타임라인 조회 (에이전트 활동, 거래, 메시지 등)",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "가져올 이벤트 수 (기본 20, 최대 200)" }
            }
        },
        handler: (args) => api("GET", "/v1/observer/timeline", { limit: args.limit })
    },

    // === Agent Management ===
    {
        name: "mammoth_agent_list",
        description: "등록된 모든 에이전트 목록을 가져옵니다 (평판, 잔고, 역할, 전문분야 포함)",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => api("GET", "/v1/agents")
    },
    {
        name: "mammoth_agent_register",
        description: "새 에이전트 등록. 에이전트 이름, 역할, 전문 토픽, 초기 잔고를 설정합니다",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "에이전트 이름 (예: CodeBot)" },
                role: { type: "string", description: "역할: provider, consumer, both (기본: both)" },
                topics: { type: "array", items: { type: "string" }, description: "전문 분야 (예: ['code_review', 'frontend'])" },
                balance: { type: "number", description: "초기 CREDIT 잔고 (기본: 1000)" }
            },
            required: ["name"]
        },
        handler: (args) => api("POST", "/v1/agents/register", args)
    },
    {
        name: "mammoth_agent_fund",
        description: "에이전트에게 CREDIT을 충전합니다",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "충전할 에이전트 ID" },
                amount: { type: "number", description: "충전 금액 (CREDIT)" }
            },
            required: ["agentId", "amount"]
        },
        handler: (args) => api("POST", "/v1/agents/fund", args)
    },
    {
        name: "mammoth_agent_policy",
        description: "에이전트 정책을 설정합니다 (자동승인, 최대수수료, 허용/차단 토픽 등)",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "대상 에이전트 ID" },
                policy: { type: "object", description: "설정할 정책 객체" }
            },
            required: ["agentId", "policy"]
        },
        handler: (args) => api("POST", "/v1/agents/policy", args)
    },

    // === Market (마켓) ===
    {
        name: "mammoth_market_offer",
        description: "마켓에 서비스 오퍼를 등록합니다 (다른 에이전트에게 서비스를 제안). 가격, 토픽, 유효기간 설정",
        inputSchema: {
            type: "object",
            properties: {
                providerAgentId: { type: "string", description: "서비스 제공 에이전트 ID" },
                topic: { type: "string", description: "서비스 토픽 (예: code_review)" },
                description: { type: "string", description: "오퍼 설명" },
                price: { type: "number", description: "가격 (CREDIT)" },
                asset: { type: "string", description: "결제 자산 (CREDIT, USDC 등)" },
                validHours: { type: "number", description: "유효 시간 (기본: 24)" }
            },
            required: ["providerAgentId", "topic", "price"]
        },
        handler: (args) => api("POST", "/v1/market/offers", args)
    },
    {
        name: "mammoth_market_ask",
        description: "마켓에 서비스 요청(Ask)을 올립니다 – 예: '프론트엔드 코드 리뷰가 필요합니다'. 전문가 에이전트를 찾기 위해 사용",
        inputSchema: {
            type: "object",
            properties: {
                requesterAgentId: { type: "string", description: "요청자 에이전트 ID" },
                topic: { type: "string", description: "필요한 서비스 토픽" },
                description: { type: "string", description: "상세 요청 내용" },
                maxPrice: { type: "number", description: "최대 지불 의향 (CREDIT)" },
                asset: { type: "string", description: "결제 자산" }
            },
            required: ["requesterAgentId", "topic"]
        },
        handler: (args) => api("POST", "/v1/market/asks", args)
    },
    {
        name: "mammoth_market_list",
        description: "마켓의 오퍼와 Ask 목록을 조회합니다 – 토픽별 필터링 가능. 평판, 가격 비교에 활용",
        inputSchema: {
            type: "object",
            properties: {
                type: { type: "string", description: "offers 또는 asks (기본: 둘 다)" },
                topic: { type: "string", description: "토픽 필터" }
            }
        },
        handler: async (args) => {
            const results = {};
            if (!args.type || args.type === "offers") {
                results.offers = await api("GET", "/v1/market/offers", { topic: args.topic });
            }
            if (!args.type || args.type === "asks") {
                results.asks = await api("GET", "/v1/market/asks", { topic: args.topic });
            }
            return results;
        }
    },
    {
        name: "mammoth_market_execute",
        description: "오퍼를 수락하여 거래를 실행합니다 – 요청자가 오퍼를 선택하면 CREDIT이 이동하고 의무가 생성됨",
        inputSchema: {
            type: "object",
            properties: {
                offerId: { type: "string", description: "수락할 오퍼 ID" },
                requesterAgentId: { type: "string", description: "요청자 에이전트 ID" },
                askId: { type: "string", description: "관련 Ask ID (선택)" }
            },
            required: ["offerId", "requesterAgentId"]
        },
        handler: (args) => api("POST", "/v1/market/execute", args)
    },

    // === A2A (Agent-to-Agent) 통신 ===
    {
        name: "mammoth_a2a_discover",
        description: "에이전트 발견 – 토픽과 역할로 다른 에이전트를 검색합니다. 평판 점수, 성공률, 거래 이력 기반으로 필터링",
        inputSchema: {
            type: "object",
            properties: {
                topic: { type: "string", description: "찾고자 하는 전문 분야 (예: 'security_audit')" },
                role: { type: "string", description: "역할 필터: provider, consumer" },
                minReputation: { type: "number", description: "최소 평판 점수 필터" }
            }
        },
        handler: (args) => api("POST", "/v1/a2a/discover", args)
    },
    {
        name: "mammoth_a2a_contact_offer",
        description: "다른 에이전트에게 연락을 제안합니다 (contact offer). 수락/거절 응답을 기다림",
        inputSchema: {
            type: "object",
            properties: {
                from: { type: "string", description: "보내는 에이전트 ID" },
                to: { type: "string", description: "받는 에이전트 ID" },
                topic: { type: "string", description: "연락 주제" },
                payload: { type: "object", description: "추가 데이터" }
            },
            required: ["from", "to"]
        },
        handler: (args) => api("POST", "/v1/a2a/contact-offer", args)
    },
    {
        name: "mammoth_a2a_respond",
        description: "연락 제안에 응답합니다 (accept / refuse) – 거절 시 사유 코드 포함",
        inputSchema: {
            type: "object",
            properties: {
                msgId: { type: "string", description: "응답할 메시지 ID" },
                action: { type: "string", description: "accept 또는 refuse" },
                from: { type: "string", description: "응답 에이전트 ID" },
                refusalCode: { type: "string", description: "거절 사유 코드 (refuse 시)" }
            },
            required: ["msgId", "action", "from"]
        },
        handler: (args) => {
            const endpoint = args.action === "accept" ? "/v1/a2a/contact-accept" : "/v1/a2a/contact-refuse";
            return api("POST", endpoint, args);
        }
    },
    {
        name: "mammoth_a2a_inbox",
        description: "에이전트의 메시지 수신함을 확인합니다 – 연락 제안, 수락, 거절 메시지 모두 포함",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "수신함 확인할 에이전트 ID" },
                limit: { type: "number", description: "가져올 메시지 수" }
            },
            required: ["agentId"]
        },
        handler: (args) => api("GET", "/v1/a2a/messages", { agentId: args.agentId, limit: args.limit })
    },

    // === Intent & Action (인텐트 & 실행) ===
    {
        name: "mammoth_intent_create",
        description: "AI 인텐트(의도)를 생성합니다 – 목표, 예산, 위험수준을 정의",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "실행 에이전트 ID" },
                goal: { type: "string", description: "인텐트 목표 (예: 'code_review for frontend module')" },
                budget: { type: "number", description: "최대 예산 (CREDIT)" },
                riskLevel: { type: "string", description: "위험수준: low, medium, high" }
            },
            required: ["agentId", "goal"]
        },
        handler: (args) => api("POST", "/v1/intents", args)
    },
    {
        name: "mammoth_action_run",
        description: "인텐트에 대한 실행 액션을 수행합니다",
        inputSchema: {
            type: "object",
            properties: {
                intentId: { type: "string", description: "실행할 인텐트 ID" },
                agentId: { type: "string", description: "실행 에이전트 ID" },
                action: { type: "string", description: "액션 유형" },
                payload: { type: "object", description: "액션 페이로드 데이터" }
            },
            required: ["intentId", "agentId"]
        },
        handler: (args) => api("POST", "/v1/actions/run", args)
    },

    // === Claims (청구) ===
    {
        name: "mammoth_claim_request",
        description: "작업 완료 후 보상을 청구합니다 (Proof of Action 포함)",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "청구 에이전트 ID" },
                intentId: { type: "string", description: "관련 인텐트 ID" },
                amount: { type: "number", description: "청구 금액" },
                receiptRef: { type: "string", description: "작업 증빙 참조" }
            },
            required: ["agentId", "intentId", "amount"]
        },
        handler: (args) => api("POST", "/v1/claims/request", args)
    },
    {
        name: "mammoth_claim_execute",
        description: "청구를 승인하고 CREDIT을 이체합니다",
        inputSchema: {
            type: "object",
            properties: {
                claimId: { type: "string", description: "승인할 청구 ID" }
            },
            required: ["claimId"]
        },
        handler: (args) => api("POST", "/v1/claims/execute", args)
    },
    {
        name: "mammoth_claims_list",
        description: "청구 목록 조회",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "에이전트 ID 필터" }
            }
        },
        handler: (args) => api("GET", "/v1/claims", { agentId: args.agentId })
    },

    // === Treasury & Obligations ===
    {
        name: "mammoth_treasury",
        description: "플랫폼 수수료 현황(treasury) 및 에이전트 잔고 조회",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => api("GET", "/v1/treasury")
    },
    {
        name: "mammoth_obligations",
        description: "BARTER 의무(obligation) 목록 조회 – 아직 이행하지 않은 상호 서비스 약속",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "에이전트 ID 필터" },
                status: { type: "string", description: "상태 필터: PENDING, FULFILLED, EXPIRED" }
            }
        },
        handler: (args) => api("GET", "/v1/market/obligations", { agentId: args.agentId, status: args.status })
    },
    {
        name: "mammoth_obligation_fulfill",
        description: "BARTER 의무를 이행합니다 – 이전에 서비스를 받았으므로 이제 되갚는 액션",
        inputSchema: {
            type: "object",
            properties: {
                obligationId: { type: "string", description: "이행할 의무 ID" },
                receiptRef: { type: "string", description: "이행 증빙" }
            },
            required: ["obligationId"]
        },
        handler: (args) => api("POST", "/v1/market/obligations/fulfill", args)
    },

    // === Peers ===
    {
        name: "mammoth_peers",
        description: "연결된 피어 노드 목록 조회 (분산 네트워크 상태)",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => api("GET", "/v1/peers")
    },

    // === Crypto ===
    {
        name: "mammoth_crypto_verify_deposit",
        description: "온체인 입금(USDC/USDT)을 검증하여 에이전트 잔고에 반영합니다",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "에이전트 ID" },
                txHash: { type: "string", description: "트랜잭션 해시 (0x...)" },
                asset: { type: "string", description: "자산: USDC 또는 USDT" }
            },
            required: ["agentId", "txHash"]
        },
        handler: (args) => api("POST", "/v1/crypto/deposits/verify", args)
    }
];

// ──────────────────────────────────────────────
// MCP Protocol – stdio JSON-RPC 2.0
// ──────────────────────────────────────────────
const SERVER_INFO = {
    name: "mammoth-mcp",
    version: "0.3.0"
};

const CAPABILITIES = {
    tools: {}
};

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}

function result(id, res) {
    send({ jsonrpc: "2.0", id, result: res });
}

function error(id, code, message) {
    send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRequest(msg) {
    const { id, method, params } = msg;

    switch (method) {
        case "initialize":
            return result(id, {
                protocolVersion: "2024-11-05",
                serverInfo: SERVER_INFO,
                capabilities: CAPABILITIES
            });

        case "notifications/initialized":
            // no-op: client acknowledges initialization
            return;

        case "tools/list":
            return result(id, {
                tools: TOOLS.map(t => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema
                }))
            });

        case "tools/call": {
            const toolName = params?.name;
            const args = params?.arguments || {};
            const tool = TOOLS.find(t => t.name === toolName);

            if (!tool) {
                return error(id, -32602, `Unknown tool: ${toolName}`);
            }

            try {
                const res = await tool.handler(args);
                return result(id, {
                    content: [{ type: "text", text: JSON.stringify(res, null, 2) }]
                });
            } catch (err) {
                return result(id, {
                    content: [{ type: "text", text: `Error: ${err.message}` }],
                    isError: true
                });
            }
        }

        default:
            if (id !== undefined) {
                return error(id, -32601, `Method not found: ${method}`);
            }
    }
}

// ──────────────────────────────────────────────
// Main: read JSON-RPC from stdin, respond on stdout
// ──────────────────────────────────────────────
const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
        const msg = JSON.parse(trimmed);
        await handleRequest(msg);
    } catch (err) {
        error(null, -32700, `Parse error: ${err.message}`);
    }
});

process.stderr.write(`[mammoth-mcp] ready — ${TOOLS.length} tools, daemon=${BASE}\n`);
