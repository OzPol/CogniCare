import { initialProgress, learn } from "@/shared/adaptive";
import { levelSchema, type Round } from "@/shared/domain";
import type { Actor } from "./auth";
import { ApiError } from "./http";
import { audit, mutate } from "./mutation";

export function recordRound(actor: Actor, correlation: string, mutationId: string, round: Round) {
  return mutate(actor.userId, "round.record", mutationId, round, async (tx) => {
    const playedAt = new Date(round.playedAt);
    const now = Date.now();
    if (playedAt.getTime() < now - 30 * 86_400_000 || playedAt.getTime() > now + 5 * 60_000) {
      throw new ApiError(400, "invalid_played_at");
    }
    const playerId = actor.userId;
    await tx.$executeRaw`
      INSERT INTO "PlayerProgress" ("playerId", "game", "skill", "difficulty", "rounds")
      VALUES (${playerId}, ${round.game}::"Game", ${initialProgress.skill}, ${initialProgress.difficulty}, 0)
      ON CONFLICT ("playerId", "game") DO NOTHING
    `;
    await tx.$queryRaw`
      SELECT "playerId" FROM "PlayerProgress"
      WHERE "playerId" = ${playerId} AND "game" = ${round.game}::"Game" FOR UPDATE
    `;
    const where = { playerId_game: { playerId, game: round.game } };
    const previous = await tx.playerProgress.findUniqueOrThrow({ where });
    const difficulty = levelSchema.parse(previous.difficulty);
    const learns = !previous.lastRound || previous.lastRound <= playedAt;
    const next = learns ? learn({ ...previous, difficulty }, round) : { ...previous, difficulty };
    if (learns) {
      await tx.playerProgress.update({
        where, data: { skill: next.skill, rounds: next.rounds, difficulty: next.difficulty, lastRound: playedAt },
      });
    }
    const { id } = await tx.activityResult.create({
      data: { playerId, game: round.game, difficulty: round.difficulty, correct: round.correct, attempts: round.attempts, playedAt },
      select: { id: true },
    });
    const day = new Date(playedAt);
    day.setUTCHours(0, 0, 0, 0);
    await tx.dailyActivity.upsert({
      where: { playerId_day_game: { playerId, day, game: round.game } },
      create: { playerId, day, game: round.game, rounds: 1, correct: round.correct, attempts: round.attempts },
      update: { rounds: { increment: 1 }, correct: { increment: round.correct }, attempts: { increment: round.attempts } },
    });
    await audit(tx, playerId, correlation, "activity.recorded", id,
      { difficulty }, { game: round.game, attemptedLevel: round.difficulty, nextLevel: next.difficulty, projectionDay: day.toISOString() });
    return { status: 201, body: { id, difficulty: next.difficulty } };
  });
}
