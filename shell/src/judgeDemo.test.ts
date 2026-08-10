import { describe, expect, it } from "vitest";
import { JUDGE_FIXTURE } from "./judgeFixture";
import {
  isWinningJudgePath,
  resolveJudgeResult,
  storyFromJudge,
  toastForJudge,
} from "./judgeDemo";

describe("judge demo contract", () => {
  it("fixture is a winning path", () => {
    expect(isWinningJudgePath(JUDGE_FIXTURE)).toBe(true);
    expect(JUDGE_FIXTURE.blocked).toBe(true);
    expect(JUDGE_FIXTURE.leaked).toBe(false);
    expect(JUDGE_FIXTURE.closing?.headline).toMatch(/DataHub won/i);
  });

  it("maps story tones for shop block", () => {
    const story = storyFromJudge(JUDGE_FIXTURE);
    const shop = story.find((s) => s.id === "shop");
    const wellness = story.find((s) => s.id === "wellness");
    expect(shop?.tone).toBe("warn");
    expect(wellness?.tone).toBe("good");
  });

  it("falls back to fixture when live fails", () => {
    const { result, replay } = resolveJudgeResult(null, false);
    expect(replay).toBe(true);
    expect(result).toBe(JUDGE_FIXTURE);
  });

  it("keeps live result when winning", () => {
    const live = { ...JUDGE_FIXTURE, replay: false, utterance: "live" };
    const { result, replay } = resolveJudgeResult(live, true);
    expect(replay).toBe(false);
    expect(result.utterance).toBe("live");
  });

  it("toasts distinguish replay vs live", () => {
    expect(toastForJudge(JUDGE_FIXTURE, true)).toMatch(/Replay/i);
    expect(toastForJudge(JUDGE_FIXTURE, false)).toMatch(/Shared memory won/i);
  });
});
