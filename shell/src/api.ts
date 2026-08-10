const BASE = import.meta.env.VITE_CORE_URL || "/api";
const API_KEY = (import.meta.env.VITE_RESIDENCE_API_KEY as string | undefined) || "";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function req<T>(path: string, init?: RequestInit, retries = 2): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 22000);
    try {
      const r = await fetch(`${BASE}${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY
            ? { Authorization: `Bearer ${API_KEY}`, "X-Residence-Key": API_KEY }
            : {}),
          ...(init?.headers || {}),
        },
        ...init,
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      return (await r.json()) as T;
    } catch (e) {
      last = e;
      if (attempt < retries) await sleep(350 * (attempt + 1));
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export type Fact = {
  factId: string;
  glossaryTermUrn: string;
  value: string;
  assertedByAgentUrn: string;
  assertedAt: string;
  confidence: number;
  certificationStatus: string;
  sensitivityTag: string;
  ttlSeconds?: number | null;
  decisionLabel?: string | null;
};

export type FactResult = { fact: Fact; stale: boolean; provenance: string };

export type Agent = {
  agentId: string;
  displayName: string;
  readScopes: string[];
  writeScopes: string[];
  implementation: string;
};

export type InferNotification = {
  fromApp: string;
  fromLabel: string;
  color: string;
  title: string;
  body: string;
  actionApp: string;
  payload: Record<string, string>;
  confidence: number;
  type: string;
  fromMemory?: boolean;
};

export type InferResult = {
  ok: boolean;
  engine?: string;
  llm?: boolean;
  text?: string;
  slots?: Record<string, unknown>;
  intents?: Array<{
    type: string;
    confidence: number;
    target_app: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  }>;
  notifications: InferNotification[];
  persisted?: Array<{ factId: string; type: string; glossary_term: string }>;
  error?: string;
};

export type GraphNode = {
  id: string;
  urn: string;
  kind: "fact" | "agent" | "glossaryTerm";
  label: string;
  glossaryTerm?: string;
  sensitivityTag?: string;
  certificationStatus?: string;
  confidence?: number;
  stale?: boolean;
  assertedAt?: string;
  decisionLabel?: string | null;
  agentId?: string;
  readScopes?: string[];
  writeScopes?: string[];
  datahubUrl?: string;
};

export type GraphEdge = {
  id: string;
  type: "lineage" | "ownership" | "classifiedAs";
  subtype: string;
  source: string;
  target: string;
};

export type GraphResponse = {
  ok: boolean;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    factCount: number;
    agentCount: number;
    lineageEdgeCount: number;
    sensitivityCounts: Record<string, number>;
  };
};

export type GlossaryTermInfo = {
  name: string;
  urn: string;
  definition: string;
  factCount: number;
  activeCount: number;
};

export type ActivityCell = {
  date: string;
  count: number;
  weekday: string;
  intensity: number;
};

export type Activity = {
  ok: boolean;
  start: string;
  end: string;
  total: number;
  activeDays: number;
  peak: number;
  cells: ActivityCell[];
};

export const api = {
  health: () => req<{ ok: boolean }>("/health", undefined, 1),
  ready: () =>
    req<{ ok: boolean; core: boolean; datahub: boolean; message: string }>("/ready", undefined, 1),
  activity: () => req<Activity>("/activity"),
  config: () =>
    req<{
      tier: string;
      anthropicConfigured: boolean;
      openaiConfigured: boolean;
    }>("/config"),
  infer: (body: {
    text: string;
    source_app?: string;
    persist?: boolean;
    agent_id?: string;
    use_llm?: boolean;
  }) =>
    req<InferResult>("/infer", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  queryFacts: (query: string, agent = "mentor-user", glossary_term?: string) =>
    req<{ results: FactResult[]; skill_invocations: string[] }>("/facts/query", {
      method: "POST",
      body: JSON.stringify({ query, requesting_agent_id: agent, glossary_term }),
    }),
  assertFact: (body: Record<string, unknown>) =>
    req<{ fact: Fact }>("/facts/assert", { method: "POST", body: JSON.stringify(body) }),
  certify: (id: string) => req<{ fact: Fact }>(`/facts/${id}/certify`, { method: "POST" }),
  lineage: (id: string) => req<Record<string, unknown>>(`/facts/${id}/lineage`),
  graph: () => req<GraphResponse>("/graph"),
  glossary: () =>
    req<{ ok: boolean; terms: GlossaryTermInfo[]; totalFacts: number }>("/glossary"),
  factHistory: (id: string) =>
    req<{
      ok: boolean;
      factId: string;
      chain: Array<{
        factId: string;
        value: string;
        certificationStatus: string;
        confidence: number;
        assertedAt: string;
        assertedBy: string;
        decisionLabel?: string | null;
        isCurrent: boolean;
      }>;
      length: number;
    }>(`/facts/${id}/history`),
  impact: (id: string) => req<Record<string, unknown>>(`/facts/${id}/impact`),
  agents: () => req<{ agents: Agent[] }>("/agents"),
  trust: (id: string, readScopes: string[], writeScopes: string[]) =>
    req<Agent>(`/agents/${id}/trust`, {
      method: "PUT",
      body: JSON.stringify({ readScopes, writeScopes }),
    }),
  reset: () => req<{ deleted: number }>("/demo/reset", { method: "POST" }),
  clearHistory: () =>
    req<{ ok: boolean; deleted: number; reseeding: boolean }>("/demo/clear", { method: "POST" }),
  explainLatestBlock: () =>
    req<{
      ok: boolean;
      headline: string;
      because: string;
      apps: string[];
      decisionFactId?: string;
      budgetFactId?: string;
    }>("/explain/latest-block"),
  analyticsAsk: (question: string, use_llm = false) =>
    req<{
      ok: boolean;
      agent?: string;
      via?: string;
      headline?: string;
      answer?: string;
      skills?: string[];
      steps?: Array<{ id: string; title: string; detail: string }>;
      entities?: Array<{ urn?: string; name?: string; type?: string }>;
      error?: string;
    }>("/analytics/ask", {
      method: "POST",
      body: JSON.stringify({ question, use_llm }),
    }, 1),
  briefing: () =>
    req<{
      ok: boolean;
      dateISO: string;
      headline: string;
      summary: string;
      today: {
        calendar: Array<{ title?: string; dateISO?: string; startHhmm?: string }>;
        commitments: Array<{ title?: string; dayOfMonth?: number; dateISO?: string }>;
      };
      upcoming: Array<{ title?: string; dayOfMonth?: number; dateISO?: string }>;
      budget?: number | null;
      allergens: string[];
      pendingCount: number;
      clashes: Array<{ kind?: string; calendar?: string; facts?: string[] }>;
    }>("/desktop/briefing", undefined, 1),
  ackStatus: () =>
    req<{
      ackAvailable: boolean;
      ackBound: boolean;
      tools: string[];
      package: string;
    }>("/ack/status", undefined, 1),
  skills: () =>
    req<{ ok: boolean; count: number; skills: Array<{ name: string; description: string }> }>(
      "/skills",
      undefined,
      1
    ),
  judgeDemo: () =>
    req<{
      ok: boolean;
      blocked: boolean;
      leaked: boolean;
      utterance: string;
      steps: Array<{
        id: string;
        title: string;
        detail: string;
        factId?: string;
        apps?: string[];
        blocked?: boolean;
        leaked?: boolean;
        skills?: string[];
        via?: string;
      }>;
      notifications: InferNotification[];
      why: { ok: boolean; headline: string; because: string };
      analytics?: {
        ok: boolean;
        answer?: string;
        skills?: string[];
        via?: string;
      };
      closing?: {
        headline: string;
        bullets: string[];
        say: string;
        openGraph?: boolean;
      };
    }>("/demo/judge", { method: "POST" }, 1),
  smartMemoryDemo: () =>
    req<{
      ok: boolean;
      strictOk?: boolean;
      coverage?: {
        scenarios: number;
        hit: number;
        missing: string[];
        bannerTypes: string[];
      };
      seeds: Array<{ kind: string; factId: string; value: string }>;
      scenarios: Array<{
        id: string;
        label: string;
        text: string;
        apps: string[];
        memoryTypes: string[];
        notifications: InferNotification[];
        hit?: boolean;
      }>;
      notifications: InferNotification[];
      steps: Array<{ id: string; title: string; detail: string }>;
    }>("/demo/smart-memory", { method: "POST" }, 1),
  claudeStatus: () =>
    req<{
      ok: boolean;
      loggedIn: boolean;
      residenceConnected: boolean;
      source?: string | null;
      model?: string;
    }>("/claude/status", undefined, 1),
  claudeLogin: (api_key?: string) =>
    req<{
      ok: boolean;
      loggedIn: boolean;
      residenceConnected: boolean;
      source?: string;
      model?: string;
    }>("/claude/login", {
      method: "POST",
      body: JSON.stringify({ api_key: api_key || null }),
    }),
  claudeLogout: () =>
    req<{ ok: boolean; loggedIn: boolean; residenceConnected: boolean }>("/claude/logout", {
      method: "POST",
    }),
  claudeChat: (message: string, history: Array<{ role: string; content: string }>) =>
    req<{
      ok: boolean;
      reply: string;
      model?: string;
      residenceConnected: boolean;
      notifications: InferNotification[];
      intents: InferResult["intents"];
      utterance: string;
    }>("/claude/chat", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
  mapsSearch: (q: string) =>
    req<{
      ok: boolean;
      query: string;
      residenceConnected: boolean;
      results: Array<{
        id: string;
        name: string;
        label: string;
        lat: number;
        lon: number;
        kind: string;
        embedUrl: string;
        openStreetMapUrl: string;
        googleMapsUrl: string;
        appleMapsUrl: string;
      }>;
    }>(`/maps/search?q=${encodeURIComponent(q)}`),
  weather: (opts: { q?: string; lat?: number; lon?: number }) => {
    const sp = new URLSearchParams();
    if (opts.q) sp.set("q", opts.q);
    if (opts.lat != null) sp.set("lat", String(opts.lat));
    if (opts.lon != null) sp.set("lon", String(opts.lon));
    return req<{
      ok: boolean;
      place: string;
      lat: number;
      lon: number;
      current: {
        temp: number;
        humidity: number;
        wind: number;
        code: number;
        label: string;
      };
      daily: Array<{
        date: string;
        code: number;
        label: string;
        high: number;
        low: number;
        precip: number;
      }>;
      source: string;
      residenceConnected: boolean;
    }>(`/weather?${sp.toString()}`);
  },
  appsListen: (text: string, source_app: string) =>
    req<{
      ok: boolean;
      residenceConnected: boolean;
      notifications: InferNotification[];
      intents: InferResult["intents"];
      utterance: string;
    }>("/apps/listen", {
      method: "POST",
      body: JSON.stringify({ text, source_app }),
    }),
  youtubeSearch: (q: string, limit = 12) =>
    req<{
      ok: boolean;
      query: string;
      source: string;
      residenceConnected: boolean;
      results: Array<{
        id: string;
        title: string;
        author: string;
        views: number;
        length: number;
        lengthLabel?: string;
        published: string;
        thumbnail: string;
        embedUrl: string;
        watchUrl: string;
        channelUrl: string;
      }>;
    }>(`/youtube/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  desktopCapture: (body: {
    text: string;
    source?: string;
    operation_id?: string;
    capture_method?: string;
    consent_mode?: string;
  }) =>
    req<{
      ok: boolean;
      duplicate?: boolean;
      operationId: string;
      utterance?: string;
      contradictions?: unknown[];
      queued: DesktopPermission[];
      pendingCount: number;
    }>("/desktop/capture", { method: "POST", body: JSON.stringify(body) }),

  desktopPending: (status = "pending", limit = 50) =>
    req<{
      ok: boolean;
      pending: DesktopPermission[];
      status: string;
      offset: number;
      limit: number;
    }>(`/desktop/pending?status=${encodeURIComponent(status)}&limit=${limit}`, undefined, 1),

  desktopResolve: (body: {
    id: string;
    accept: boolean;
    destination?: "calendar" | "notes" | "reminders" | "facts-only" | null;
  }) =>
    req<{
      ok: boolean;
      status: string;
      id: string;
      actionApp?: string;
      factId?: string;
      idempotent?: boolean;
    }>("/desktop/resolve", { method: "POST", body: JSON.stringify(body) }),

  desktopActivity: (limit = 40) =>
    req<{
      ok: boolean;
      items?: Array<Record<string, unknown>>;
      activity?: Array<Record<string, unknown>>;
    }>(`/desktop/activity?limit=${limit}`, undefined, 1),

  desktopUndo: (body: { fact_id: string; permission_id?: string | null; operation_id?: string | null }) =>
    req<{ ok: boolean; factId: string; status: string }>("/desktop/undo", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export type DesktopPermission = {
  id: string;
  createdAt?: string;
  status?: string;
  kind?: string;
  source?: string;
  operationId?: string;
  captureMethod?: string;
  consentMode?: string;
  title?: string;
  body?: string;
  actionApp?: string;
  payload?: Record<string, unknown>;
  utterance?: string;
  fromLabel?: string;
  factId?: string;
  destination?: string;
};
