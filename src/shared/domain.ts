import { z } from "zod";

export const games = ["MATCH", "FOCUS", "ROUTINE", "PATTERN"] as const;
export const gameSchema = z.enum(games);
export type Game = z.infer<typeof gameSchema>;
export type Locale = "en" | "es";
export type Role = "PLAYER" | "CAREGIVER" | "HEALTH_WORKER";
export type Level = 1 | 2 | 3 | 4;
export type OAuthProvider = "google" | "microsoft" | "github";

export const levelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const reminderKinds = ["MEDICINE", "WATER", "ACTIVITY", "APPOINTMENT"] as const;
export const reminderKindSchema = z.enum(reminderKinds);
export const reminderDraft = z.strictObject({
  title: z.string().trim().min(1).max(80),
  kind: reminderKindSchema,
  dueAt: z.iso.datetime(),
});
export const reminderUpdate = z.discriminatedUnion("action", [
  reminderDraft.extend({ action: z.literal("edit"), version: z.int().positive() }),
  z.strictObject({ action: z.enum(["done", "remove", "reopen"]), version: z.int().positive() }),
]);

export const activitySubmission = z.strictObject({
  game: gameSchema,
  difficulty: levelSchema,
  attempts: z.int().min(1).max(120),
  correct: z.int().min(0).max(120),
  playedAt: z.iso.datetime(),
}).refine((round) => round.correct <= round.attempts, "Correct answers must be at most the attempts.");
export type Round = z.infer<typeof activitySubmission>;

export const practiceInput = z.strictObject({
  template: z.enum(["quiet", "variety", "routine"]),
});
export const planOutput = z.strictObject({
  games: z.tuple([gameSchema, gameSchema]).refine(([first, second]) => first !== second),
});
export type PracticeInput = z.infer<typeof practiceInput>;
export type PlanOutput = z.infer<typeof planOutput>;

export type AccountView =
  | { state: "disabled" | "signed-out"; providers: OAuthProvider[]; localLogin: boolean }
  | { state: "enroll" | "verify" }
  | { state: "ready"; id: string; role: Role; levels: Partial<Record<Game, Level>> };

export type ReminderView = z.infer<typeof reminderDraft> & {
  id: string;
  version: number;
  doneAt: string | null;
};
export type Person = { id: string; name: string };
export type CareSummary = {
  rounds: number;
  lastPlayedAt: string | null;
  activities: { game: Game; rounds: number; correct: number; attempts: number }[];
  days: { day: string; rounds: number }[];
  overdue: ReminderView[];
  overdueCount: number;
};
export type PracticeView = {
  id: string;
  state: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  result: PlanOutput | null;
};

export const patientId = z.string().regex(/^[a-zA-Z0-9_-]{16,64}$/);
export const idSchema = z.uuid();
export const invitationCode = z.string().trim().regex(/^[A-Za-z0-9_-]{24}$/);
