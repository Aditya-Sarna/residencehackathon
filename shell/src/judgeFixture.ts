/** Deterministic winning path when Core/DataHub are offline (hosted shell / stage fallback). */
import type { InferNotification } from "./api";

export type JudgeDemoResult = {
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
  replay?: boolean;
};

export const JUDGE_FIXTURE: JudgeDemoResult = {
  ok: true,
  blocked: true,
  leaked: false,
  replay: true,
  utterance: "Sam birthday on the 15th, I want shoes, balance isn't much only $40",
  steps: [
    {
      id: "wallet",
      title: "Wallet locked $40 / week",
      detail: "Certified Budget fact written to DataHub.",
      factId: "fixture-budget",
    },
    {
      id: "voice",
      title: "Voice understood the moment",
      detail: "Sam birthday on the 15th, I want shoes, balance isn't much only $40",
      apps: ["calendar", "shop", "wallet"],
    },
    {
      id: "shop",
      title: "Shop paused Everyday Runners",
      detail: "$95 vs weekly $40",
      factId: "fixture-intent",
      blocked: true,
    },
    {
      id: "wellness",
      title: "Wellness kept private from Shop",
      detail: "Mentor sees 1 · Shop sees 0",
      factId: "fixture-health",
      leaked: false,
    },
    {
      id: "analytics",
      title: "Analytics Agent (ACK) answered Why",
      detail: "Everyday Runners ($95) exceeds certified Budget ceiling ($40/week).",
      skills: ["datahub-search", "datahub-lineage"],
      via: "warehouse",
    },
  ],
  notifications: [
    {
      fromApp: "voice",
      fromLabel: "Voice",
      color: "#0c0c0c",
      title: "Sam's birthday",
      body: "Added for the 15th from voice.",
      actionApp: "calendar",
      payload: { date: "15" },
      confidence: 0.92,
      type: "info",
    },
    {
      fromApp: "wallet",
      fromLabel: "Wallet",
      color: "#0c0c0c",
      title: "Weekly ceiling $40",
      body: "Certified Budget is live in DataHub.",
      actionApp: "wallet",
      payload: { ceilingWeeklyUsd: "40" },
      confidence: 1,
      type: "info",
    },
    {
      fromApp: "shop",
      fromLabel: "Shop",
      color: "#0c0c0c",
      title: "Everyday Runners paused",
      body: "$95 is over your $40 weekly spend.",
      actionApp: "shop",
      payload: { productId: "sh-1", price: "95" },
      confidence: 0.95,
      type: "warn",
    },
  ],
  why: {
    ok: true,
    headline: "Everyday Runners blocked by certified Budget",
    because:
      "Shopping Intent ($95) is linked by DataHub lineage to a user-confirmed Budget Fact ($40/week). CorpUser scopes kept Health Condition out of shopping-agent read scope.",
  },
  analytics: {
    ok: true,
    answer: "Everyday Runners ($95) exceeds certified Budget ceiling ($40/week).",
    skills: ["datahub-search", "datahub-lineage"],
    via: "warehouse",
  },
  closing: {
    headline: "DataHub won — not five private silos",
    bullets: [
      "Budget Fact certified in DataHub Glossary + Personal Context domain",
      "Shop Intent linked by native lineage to that Budget",
      "CorpUser scopes hid Health from shopping-agent",
      "Conflict resolution wrote a real DataHub Assertion + run event",
      "Analytics Agent: ACK discover warehouse.* → Text-to-SQL → lineage Why",
      "Official datahub-skills pack (.agents/skills) + DataHub MCP + Residence MCP",
    ],
    say: "Apps stopped lying because Facts live in DataHub — glossary, ownership, lineage, domains, assertions, sensitivity, Agent Context Kit, Skills, and a Text-to-SQL Analytics Agent.",
    openGraph: false,
  },
};
