import type { Level, Round } from "./domain";

export type Progress = { skill: number; difficulty: Level; rounds: number };
export const initialProgress: Progress = { skill: 0.85, difficulty: 1, rounds: 0 };

export function predictedAccuracy(skill: number, difficulty: Level) {
  return 1 / (1 + Math.exp(0.85 * (difficulty - 1) - skill));
}

export function learn(progress: Progress, round: Pick<Round, "difficulty" | "correct" | "attempts">): Progress {
  const accuracy = round.correct / round.attempts;
  const expected = predictedAccuracy(progress.skill, round.difficulty);
  const weight = Math.min(1, round.attempts / 4);
  const skill = Math.max(-2, Math.min(5, 0.98 * progress.skill + 1.7 * weight * (accuracy - expected)));
  const rounds = progress.rounds + 1;
  let difficulty = progress.difficulty;

  // An offline round or an easier round selected for comfort still informs skill.
  // Change the recommended level only when practice was at the recommended level.
  if (rounds >= 2 && weight >= 0.75 && round.difficulty === difficulty) {
    const estimate = predictedAccuracy(skill, difficulty);
    if (estimate > 0.80 && accuracy >= 0.8 && difficulty < 4) difficulty = (difficulty + 1) as Level;
    if (estimate < 0.60 && accuracy < 0.65 && difficulty > 1) difficulty = (difficulty - 1) as Level;
  }

  return { skill, difficulty, rounds };
}
