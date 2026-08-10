import type { JudgeDemoResult } from "./judgeFixture";
import { JUDGE_FIXTURE } from "./judgeFixture";

export type StoryStep = {
  id: string;
  title: string;
  detail: string;
  tone: "good" | "warn";
};

/** True when the demo completed the winning DataHub path. */
export function isWinningJudgePath(result: JudgeDemoResult): boolean {
  if (!result.ok || !result.blocked || result.leaked) return false;
  const ids = new Set(result.steps.map((s) => s.id));
  if (!["wallet", "voice", "shop", "wellness"].every((id) => ids.has(id))) return false;
  if (!result.why?.ok || !result.closing?.headline) return false;
  if ((result.closing.bullets?.length ?? 0) < 3) return false;
  return true;
}

export function storyFromJudge(result: JudgeDemoResult): StoryStep[] {
  return result.steps.map((s) => ({
    id: s.id,
    title: s.title,
    detail: s.detail,
    tone:
      (s.id === "shop" && s.blocked) || (s.id === "wellness" && s.leaked)
        ? "warn"
        : "good",
  }));
}

export function toastForJudge(_result: JudgeDemoResult, replay: boolean): string {
  if (replay) {
    return "Replay path — Shop blocked, health private. Connect Core :8700 for live DataHub writes.";
  }
  return "Shared memory won — Shop blocked, health stayed private.";
}

/** Resolve live API result or fall back to the offline fixture. */
export function resolveJudgeResult(
  live: JudgeDemoResult | null,
  liveOk: boolean
): { result: JudgeDemoResult; replay: boolean } {
  if (liveOk && live && isWinningJudgePath(live)) {
    return { result: live, replay: false };
  }
  return { result: JUDGE_FIXTURE, replay: true };
}
