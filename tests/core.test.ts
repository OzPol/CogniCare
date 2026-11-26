import assert from "node:assert/strict";
import test from "node:test";
import { initialProgress, learn, predictedAccuracy } from "../src/shared/adaptive";
import { activitySubmission, planOutput, practiceInput, reminderDraft, reminderUpdate } from "../src/shared/domain";

test("adaptive levels increase with consistent success and decrease if a level is too difficult", () => {
  let progress = initialProgress;
  for (let i = 0; i < 14; i++) progress = learn(progress, { correct: 6, attempts: 6, difficulty: progress.difficulty });
  assert.ok(progress.difficulty > 1);
  assert.ok(progress.difficulty <= 4);
  assert.ok(progress.skill <= 5);
  for (let i = 0; i < 22; i++) progress = learn(progress, { correct: 0, attempts: 6, difficulty: progress.difficulty });
  assert.equal(progress.difficulty, 1);
  assert.ok(progress.skill >= -2);
  assert.ok(predictedAccuracy(1, 1) > predictedAccuracy(1, 4));
});

test("an easier round or a very short result does not change the recommended level", () => {
  const progress = { skill: 3, difficulty: 3, rounds: 4 } as const;
  assert.equal(learn(progress, { correct: 4, attempts: 4, difficulty: 1 }).difficulty, 3);
  assert.equal(learn(progress, { correct: 1, attempts: 1, difficulty: 3 }).difficulty, 3);
});

test("rounds reject impossible scores impersonation fields and invalid levels", () => {
  const round = { game: "MATCH", difficulty: 1, correct: 3, attempts: 3, playedAt: new Date().toISOString() };
  assert.ok(activitySubmission.safeParse(round).success);
  for (const bad of [{ correct: 4 }, { attempts: 0 }, { difficulty: 9 }, { userId: "another-user" }]) {
    assert.equal(activitySubmission.safeParse({ ...round, ...bad }).success, false);
  }
});

test("reminders require version tokens and a timezone-qualified date", () => {
  const draft = { title: "  Water  ", kind: "WATER", dueAt: "2026-11-26T13:00:00.000Z" };
  assert.equal(reminderDraft.parse(draft).title, "Water");
  assert.equal(reminderDraft.safeParse({ ...draft, dueAt: "2026-11-26T13:00:00" }).success, false);
  assert.equal(reminderUpdate.safeParse({ action: "done" }).success, false);
  assert.ok(reminderUpdate.safeParse({ action: "edit", ...draft, version: 1 }).success);
});

test("provider input is an enum and outputs must contain two distinct game IDs", () => {
  assert.equal(practiceInput.safeParse({ template: "quiet", name: "Patient" }).success, false);
  assert.ok(planOutput.safeParse({ games: ["MATCH", "FOCUS"] }).success);
  for (const bad of [["MATCH", "MATCH"], ["MESSAGE", "FOCUS"], ["MATCH"]]) {
    assert.equal(planOutput.safeParse({ games: bad }).success, false);
  }
});
