export * from "./generated/api";
// Note: do NOT re-export ./generated/types — Orval generates identically-named
// query-param interfaces there (e.g. ListScheduledDosesParams) that collide with
// the Zod schema exports above, causing TS2308.
// Use `z.infer<typeof SomeSchema>` to derive TypeScript types from Zod schemas.
