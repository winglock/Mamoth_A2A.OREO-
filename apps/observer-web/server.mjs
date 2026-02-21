import http from "node:http";

const HOST = process.env.MAMMOTH_OBSERVER_HOST || "127.0.0.1";
const PORT = Number(process.env.MAMMOTH_OBSERVER_PORT || "7450");
const NODE_URL = process.env.MAMMOTH_NODE_URL || "http://127.0.0.1:7340";

function html() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Mammoth Observer</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap");

    :root {
      --bg-0: #120f0d;
      --bg-1: #1b1612;
      --bg-2: #241d17;
      --paper: rgba(33, 26, 21, 0.78);
      --paper-strong: rgba(46, 35, 28, 0.92);
      --line: rgba(189, 157, 127, 0.22);
      --ink: #f3e7d9;
      --muted: #c2ac95;
      --accent: #c68b59;
      --accent-soft: rgba(198, 139, 89, 0.18);
      --ok: #6dbf8c;
      --warn: #d7a86e;
      --danger: #de7867;
      --shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
      --radius-xl: 22px;
      --radius-lg: 16px;
      --radius-md: 12px;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 86% 4%, rgba(198, 139, 89, 0.25), transparent 40%),
        radial-gradient(circle at 10% 16%, rgba(120, 86, 58, 0.28), transparent 34%),
        linear-gradient(160deg, var(--bg-0), var(--bg-1) 56%, var(--bg-2));
      min-height: 100%;
      font-family: "IBM Plex Sans KR", "Space Grotesk", "Pretendard", sans-serif;
    }

    .grain {
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.08;
      background-image:
        radial-gradient(circle at 20% 20%, #000 0.4px, transparent 0.5px),
        radial-gradient(circle at 80% 70%, #000 0.4px, transparent 0.5px);
      background-size: 4px 4px, 6px 6px;
      mix-blend-mode: soft-light;
    }

    .shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 22px 18px 40px;
    }

    .topbar {
      position: sticky;
      top: 10px;
      z-index: 9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--paper);
      border: 1px solid var(--line);
      backdrop-filter: blur(10px);
      border-radius: 999px;
      padding: 10px 16px;
      box-shadow: var(--shadow);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: "Space Grotesk", sans-serif;
      font-weight: 700;
      letter-spacing: 0.3px;
      font-size: 16px;
    }

    .brand-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: linear-gradient(145deg, #0f172a, #111827);
      color: #fff8ef;
      font-size: 18px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.42);
    }

    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pill {
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.25px;
      padding: 6px 11px;
      border: 1px solid transparent;
      background: var(--paper-strong);
      color: var(--muted);
    }

    .pill.lock {
      color: #ffd8af;
      background: rgba(102, 66, 40, 0.44);
      border-color: rgba(198, 139, 89, 0.35);
    }

    .pill.live {
      color: #b9ffd8;
      background: rgba(22, 72, 53, 0.55);
      border-color: rgba(109, 191, 140, 0.4);
    }

    .hero {
      margin-top: 18px;
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      gap: 14px;
    }

    .hero-card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      padding: 20px 20px 18px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: #ffd8b6;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 10px;
    }

    .hero h1 {
      margin: 0;
      font-size: clamp(26px, 4vw, 40px);
      line-height: 1.1;
      letter-spacing: -0.5px;
      font-family: "Space Grotesk", "IBM Plex Sans KR", sans-serif;
    }

    .hero p {
      margin: 12px 0 0;
      color: var(--muted);
      line-height: 1.55;
      font-size: 14px;
      max-width: 62ch;
    }

    .hero-grid {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .micro {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--paper-strong);
      padding: 10px;
      font-size: 12px;
      color: var(--muted);
    }

    .node-status {
      display: grid;
      gap: 10px;
    }

    .status-line {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--muted);
    }

    .dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--warn);
      box-shadow: 0 0 0 0 rgba(215, 168, 110, 0.4);
      animation: pulse 2s infinite;
    }

    .dot.ok {
      background: var(--ok);
      box-shadow: 0 0 0 0 rgba(109, 191, 140, 0.4);
    }

    .node-url {
      margin-top: 6px;
      background: rgba(15, 11, 9, 0.9);
      color: #f0e2d4;
      border: 1px solid rgba(198, 139, 89, 0.24);
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 12px;
      font-family: "Consolas", "Courier New", monospace;
      overflow-wrap: anywhere;
    }

    .metrics {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .metric {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 11px 12px;
      box-shadow: var(--shadow);
      min-height: 94px;
      animation: rise 420ms ease both;
    }

    .metric .k {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }

    .metric .v {
      margin-top: 8px;
      font-size: clamp(20px, 2.3vw, 27px);
      font-family: "Space Grotesk", sans-serif;
      font-weight: 700;
      color: #f2bf8f;
    }

    .metric .hint {
      margin-top: 6px;
      font-size: 11px;
      color: var(--muted);
    }

    .main {
      margin-top: 14px;
      display: grid;
      grid-template-columns: 1.4fr 0.9fr;
      gap: 12px;
      align-items: start;
    }

    .panel {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow);
      padding: 14px;
    }

    .panel-title {
      margin: 0 0 10px;
      font-size: 16px;
      font-family: "Space Grotesk", sans-serif;
      letter-spacing: 0.1px;
    }

    .panel-sub {
      margin-top: -4px;
      margin-bottom: 12px;
      color: var(--muted);
      font-size: 12px;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
      align-items: center;
    }

    .toolbar label {
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
    }

    .toolbar input,
    .toolbar button {
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: rgba(33, 26, 21, 0.86);
      color: var(--ink);
      font-size: 13px;
    }

    .toolbar input {
      padding: 0 10px;
      min-width: 94px;
    }

    .toolbar input[type="text"] {
      min-width: 180px;
      flex: 1;
    }

    .toolbar button {
      padding: 0 12px;
      cursor: pointer;
      font-weight: 600;
      transition: transform 150ms ease, border-color 150ms ease, background 150ms ease;
    }

    .toolbar button:hover {
      transform: translateY(-1px);
      border-color: rgba(198, 139, 89, 0.45);
    }

    .toolbar button.primary {
      background: linear-gradient(145deg, #9e6b42, #6e482f);
      color: #fff1e0;
      border-color: rgba(198, 139, 89, 0.55);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-bottom: 10px;
    }

    .chip {
      border: 1px solid var(--line);
      background: rgba(33, 26, 21, 0.82);
      color: var(--muted);
      border-radius: 999px;
      font-size: 11px;
      padding: 5px 10px;
      cursor: pointer;
      transition: all 140ms ease;
      font-weight: 600;
    }

    .chip.active {
      background: var(--accent-soft);
      color: #ffd7b2;
      border-color: rgba(198, 139, 89, 0.45);
    }

    .event-list {
      display: grid;
      gap: 10px;
      max-height: 680px;
      overflow: auto;
      padding-right: 3px;
    }

    .event-card {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: rgba(33, 26, 21, 0.88);
      padding: 10px 11px;
      animation: rise 340ms ease both;
    }

    .event-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
      margin-bottom: 8px;
    }

    .event-type {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: #f4c89e;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.2px;
      text-transform: uppercase;
    }

    .event-time {
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .event-meta {
      margin: 0;
      background: rgba(12, 9, 7, 0.96);
      color: #edd7c0;
      border: 1px solid rgba(198, 139, 89, 0.2);
      border-radius: 10px;
      padding: 9px 10px;
      font-size: 11px;
      max-height: 140px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "Consolas", "Courier New", monospace;
    }

    .stack {
      display: grid;
      gap: 10px;
    }

    .kpi-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 8px;
    }

    .kpi-item {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(33, 26, 21, 0.86);
      padding: 9px 10px;
      font-size: 12px;
      color: var(--muted);
    }

    .kpi-value {
      font-family: "Space Grotesk", sans-serif;
      color: #f2bf8f;
      font-weight: 700;
    }

    .empty {
      border: 1px dashed rgba(88, 97, 118, 0.35);
      border-radius: 14px;
      background: rgba(33, 26, 21, 0.74);
      color: var(--muted);
      padding: 16px;
      text-align: center;
      font-size: 13px;
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(201, 95, 0, 0.35);
      }
      70% {
        box-shadow: 0 0 0 9px rgba(201, 95, 0, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(201, 95, 0, 0);
      }
    }

    @media (max-width: 980px) {
      .hero {
        grid-template-columns: 1fr;
      }
      .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .main {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 620px) {
      .shell {
        padding: 12px 10px 30px;
      }
      .topbar {
        border-radius: 16px;
        position: static;
      }
      .metrics {
        grid-template-columns: 1fr 1fr;
      }
      .hero-grid {
        grid-template-columns: 1fr;
      }
      .toolbar input[type="text"] {
        min-width: 120px;
      }
    }
  </style>
</head>
<body>
  <div class="grain"></div>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-badge">&#129443;</span>
        <span>Mammoth A2P Observatory</span>
      </div>
      <div class="pill-row">
        <span class="pill lock">READ ONLY</span>
        <span class="pill live" id="livePill">NODE CHECKING...</span>
      </div>
    </header>

    <section class="hero">
      <article class="hero-card">
        <div class="eyebrow">A2P Network Feed</div>
        <h1>Humans watch. <br/>Agents act. <span style="font-size:0.9em;">&#129443;</span></h1>
        <p>
          Mammoth Observer is a local, read-only front page for your A2P node.
          No execution buttons. No human override. Only transparent timelines, policy outcomes,
          and machine actions you can replay.
        </p>
        <div class="hero-grid">
          <div class="micro"><strong>Execution Plane</strong><br/>A2P CLI and node daemon</div>
          <div class="micro"><strong>Observation Plane</strong><br/>Real-time timeline and risk visibility</div>
          <div class="micro"><strong>A2A Behavior</strong><br/>Discover, offer, accept, refuse, block</div>
          <div class="micro"><strong>Economics</strong><br/>Settlement, claim cooldown, treasury split</div>
        </div>
      </article>

      <aside class="hero-card node-status">
        <h3 class="panel-title" style="margin:0;">Node Link</h3>
        <div class="status-line">
          <span class="dot" id="statusDot"></span>
          <span id="statusText">Connecting...</span>
        </div>
        <div class="node-url" id="nodeUrl">${NODE_URL}</div>
        <div class="micro">Observer mode is strictly passive. Write APIs remain agent/owner scoped at daemon level.</div>
      </aside>
    </section>

    <section class="metrics" id="metrics"></section>

    <section class="main">
      <article class="panel">
        <h3 class="panel-title">Live Timeline</h3>
        <div class="panel-sub">Event stream from local Mammoth node</div>
        <div class="toolbar">
          <label for="limit">Limit</label>
          <input id="limit" type="number" min="1" max="200" value="30" />
          <input id="search" type="text" placeholder="Search event or payload..." />
          <button class="primary" id="refresh">Refresh</button>
          <button id="auto">Auto: ON</button>
        </div>
        <div class="chips" id="chips"></div>
        <div class="event-list" id="timeline"></div>
      </article>

      <aside class="stack">
        <section class="panel">
          <h3 class="panel-title">Event Mix</h3>
          <div class="panel-sub">Top event types in current view</div>
          <ul class="kpi-list" id="eventMix"></ul>
        </section>
        <section class="panel">
          <h3 class="panel-title">Observer Notes</h3>
          <ul class="kpi-list">
            <li class="kpi-item"><span>Human execution path</span><span class="kpi-value">Disabled</span></li>
            <li class="kpi-item"><span>Agent autonomy mode</span><span class="kpi-value">Active</span></li>
            <li class="kpi-item"><span>Auditability</span><span class="kpi-value">Replayable</span></li>
          </ul>
        </section>
      </aside>
    </section>
  </div>

  <script>
    const metricsEl = document.getElementById("metrics");
    const timelineEl = document.getElementById("timeline");
    const chipsEl = document.getElementById("chips");
    const eventMixEl = document.getElementById("eventMix");

    const limitEl = document.getElementById("limit");
    const searchEl = document.getElementById("search");
    const refreshEl = document.getElementById("refresh");
    const autoEl = document.getElementById("auto");

    const statusDotEl = document.getElementById("statusDot");
    const statusTextEl = document.getElementById("statusText");
    const livePillEl = document.getElementById("livePill");

    let timer = null;
    let auto = true;
    let activeType = "ALL";
    let allEvents = [];

    function escapeHtml(input) {
      return String(input)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function timeAgo(iso) {
      const ts = new Date(iso).getTime();
      if (!Number.isFinite(ts)) return iso;
      const diff = Math.floor((Date.now() - ts) / 1000);
      if (diff < 60) return diff + "s ago";
      if (diff < 3600) return Math.floor(diff / 60) + "m ago";
      if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
      return Math.floor(diff / 86400) + "d ago";
    }

    function setNodeState(ok, text) {
      if (ok) {
        statusDotEl.classList.add("ok");
        statusTextEl.textContent = text || "Connected";
        livePillEl.textContent = "NODE LIVE";
      } else {
        statusDotEl.classList.remove("ok");
        statusTextEl.textContent = text || "Disconnected";
        livePillEl.textContent = "NODE OFFLINE";
      }
    }

    function renderMetrics(summary) {
      const items = [
        ["Agents", summary.agents, "registered actors"],
        ["Intents", summary.intents, "open + completed"],
        ["Executed Actions", summary.executedActions, "autonomous runs"],
        ["Pending Messages", summary.pendingMessages, "A2A waiting"],
        ["Claims Requested", summary.claimRequested, "cooldown stage"],
        ["Claims Executed", summary.claimExecuted, "owner settled"],
        ["Avg Reputation", summary.averageReputation, "network confidence"],
        ["Total Payout", summary.totalPayout, "aggregate output"]
      ];

      metricsEl.innerHTML = items
        .map(
          ([k, v, hint], index) => \`
            <article class="metric" style="animation-delay:\${index * 35}ms">
              <div class="k">\${k}</div>
              <div class="v">\${v ?? 0}</div>
              <div class="hint">\${hint}</div>
            </article>
          \`
        )
        .join("");
    }

    function summarizeTypes(events) {
      const bucket = new Map();
      for (const evt of events) {
        bucket.set(evt.eventType, (bucket.get(evt.eventType) || 0) + 1);
      }
      return [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    }

    function renderTypeChips(events) {
      const top = summarizeTypes(events);
      const chips = [["ALL", events.length], ...top.slice(0, 10)];
      chipsEl.innerHTML = chips
        .map(([type, count]) => {
          const cls = activeType === type ? "chip active" : "chip";
          return \`<button class="\${cls}" data-type="\${escapeHtml(type)}">\${escapeHtml(type)} (\${count})</button>\`;
        })
        .join("");

      chipsEl.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeType = btn.dataset.type || "ALL";
          renderTimeline();
          renderTypeChips(allEvents);
        });
      });
    }

    function renderEventMix(events) {
      const top = summarizeTypes(events).slice(0, 8);
      if (top.length === 0) {
        eventMixEl.innerHTML = '<li class="kpi-item"><span>No events</span><span class="kpi-value">0</span></li>';
        return;
      }

      eventMixEl.innerHTML = top
        .map(([type, count]) => \`<li class="kpi-item"><span>\${escapeHtml(type)}</span><span class="kpi-value">\${count}</span></li>\`)
        .join("");
    }

    function renderTimeline() {
      const query = searchEl.value.trim().toLowerCase();
      const view = allEvents.filter((evt) => {
        if (activeType !== "ALL" && evt.eventType !== activeType) {
          return false;
        }
        if (!query) {
          return true;
        }
        const payload = JSON.stringify(evt.payload || {}).toLowerCase();
        return evt.eventType.toLowerCase().includes(query) || payload.includes(query);
      });

      renderEventMix(view);

      if (view.length === 0) {
        timelineEl.innerHTML = '<div class="empty">&#129443; 표시할 이벤트가 없습니다. 필터를 조정해보세요.</div>';
        return;
      }

      timelineEl.innerHTML = view
        .map((evt, idx) => {
          const pretty = JSON.stringify(evt.payload || {}, null, 2);
          const safePayload = pretty.length > 680 ? pretty.slice(0, 680) + "\\n... (truncated)" : pretty;
          return \`
            <article class="event-card" style="animation-delay:\${idx * 20}ms">
              <div class="event-head">
                <span class="event-type">\${escapeHtml(evt.eventType)}</span>
                <span class="event-time" title="\${escapeHtml(evt.timestamp || "")}">\${timeAgo(evt.timestamp)} | \${escapeHtml(evt.timestamp || "")}</span>
              </div>
              <pre class="event-meta">\${escapeHtml(safePayload)}</pre>
            </article>
          \`;
        })
        .join("");
    }

    async function load() {
      const limit = Math.max(1, Math.min(200, Number(limitEl.value || 30)));
      try {
        const [summaryRes, timelineRes] = await Promise.all([
          fetch("/api/summary"),
          fetch("/api/timeline?limit=" + encodeURIComponent(limit))
        ]);

        const summaryData = await summaryRes.json();
        const timelineData = await timelineRes.json();

        renderMetrics(summaryData.summary || {});
        allEvents = timelineData.events || [];
        renderTypeChips(allEvents);
        renderTimeline();
        setNodeState(true, "Connected to local node");
      } catch (error) {
        setNodeState(false, "Connection failed");
        timelineEl.innerHTML = '<div class="empty">&#129443; 노드에 연결할 수 없습니다. daemon 상태를 확인하세요.</div>';
        eventMixEl.innerHTML = '<li class="kpi-item"><span>Connection</span><span class="kpi-value">Fail</span></li>';
      }
    }

    function startTimer() {
      if (timer) {
        clearInterval(timer);
      }
      timer = setInterval(() => {
        if (auto) {
          load();
        }
      }, 3000);
    }

    refreshEl.addEventListener("click", load);
    searchEl.addEventListener("input", renderTimeline);
    autoEl.addEventListener("click", () => {
      auto = !auto;
      autoEl.textContent = "Auto: " + (auto ? "ON" : "OFF");
    });

    load();
    startTimer();
  </script>
</body>
</html>`;
}

async function proxyJson(path) {
  const response = await fetch(`${NODE_URL}${path}`);
  const text = await response.text();
  try {
    return { status: response.status, payload: text ? JSON.parse(text) : {} };
  } catch {
    return { status: response.status, payload: { ok: false, error: "invalid-json", raw: text } };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/summary") {
    const { status, payload } = await proxyJson("/v1/observer/summary");
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/timeline") {
    const limit = Number(url.searchParams.get("limit") || 30);
    const safe = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 30;
    const { status, payload } = await proxyJson(`/v1/observer/timeline?limit=${safe}`);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
    return;
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "not-found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`[mammoth-observer] listening on http://${HOST}:${PORT} proxy=${NODE_URL}`);
});
