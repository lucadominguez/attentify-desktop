"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/cards/seeds.ts
var seeds_exports = {};
__export(seeds_exports, {
  defaultCards: () => defaultCards,
  mergeSeeds: () => mergeSeeds
});
module.exports = __toCommonJS(seeds_exports);
var seedId = (n) => `seed-${n}`;
function defaultCards(now = Date.now()) {
  const base = { seeded: true, createdAt: now };
  return [
    // ── Analytics ─────────────────────────────────────────────────────────────
    // Four only, and deliberately one of each shape: two charts, a table and a graph.
    // A wall of defaults buries the point that these are yours to change, and the page
    // should read as a starting point rather than a finished dashboard.
    {
      ...base,
      id: seedId("distractions"),
      kind: "data",
      page: "analytics",
      order: 0,
      title: "Top distractions",
      description: "Where off-task time goes",
      viz: "bar",
      spec: { source: "activity", rangeDays: 7, groupBy: "domain", metric: "time", distraction: "only", limit: 8 }
    },
    {
      ...base,
      id: seedId("heatmap"),
      kind: "data",
      page: "analytics",
      order: 1,
      title: "Focus heatmap",
      description: "When you work, hour by weekday",
      // 14 days so the grid has enough to show a shape rather than a scatter.
      viz: "heatmap",
      spec: { source: "activity", rangeDays: 14, groupBy: "hour", metric: "time", distraction: "all" }
    },
    {
      ...base,
      id: seedId("apps-table"),
      kind: "data",
      page: "analytics",
      order: 2,
      title: "Time per app",
      description: "Every app you touched, last 7 days",
      viz: "table",
      spec: { source: "activity", rangeDays: 7, groupBy: "app", metric: "time", distraction: "all", limit: 10 }
    },
    {
      ...base,
      id: seedId("focus-hour"),
      kind: "data",
      page: "analytics",
      order: 3,
      title: "Focus by hour",
      description: "When you focus best across the day",
      viz: "line",
      spec: { source: "activity", rangeDays: 7, groupBy: "hour", metric: "focus_ratio", distraction: "all" }
    },
    // Timesheets and Logic deliberately have NO seeds: those pages keep their own
    // purpose-built views. Cards are not automatically the right answer everywhere.
    // ── Deep Focus (action cards: controls, not queries) ───────────────────────
    {
      ...base,
      id: seedId("df-pomodoro"),
      kind: "action",
      page: "deep-focus",
      order: 0,
      title: "Pomodoro",
      description: "A standard 25 minute block",
      viz: "number",
      action: { tool: "start_focus_session", params: { mode: "normal", duration_minutes: 25 }, label: "Start 25 min", confirm: false },
      spec: { rangeDays: 1, groupBy: "app", metric: "time", distraction: "all" }
    },
    {
      ...base,
      id: seedId("df-flow"),
      kind: "action",
      page: "deep-focus",
      order: 1,
      title: "Flow state",
      description: "A locked 90 minutes with no bypass",
      viz: "number",
      action: { tool: "start_focus_session", params: { mode: "deep", duration_minutes: 90 }, label: "Start 90 min", confirm: true },
      spec: { rangeDays: 1, groupBy: "app", metric: "time", distraction: "all" }
    },
    {
      ...base,
      id: seedId("df-deep"),
      kind: "action",
      page: "deep-focus",
      order: 2,
      title: "Deep work",
      description: "A locked 3 hours. You cannot end this early.",
      viz: "number",
      action: { tool: "start_focus_session", params: { mode: "deep", duration_minutes: 180 }, label: "Start 3 hours", confirm: true },
      spec: { rangeDays: 1, groupBy: "app", metric: "time", distraction: "all" }
    },
    {
      ...base,
      id: seedId("df-end"),
      kind: "action",
      page: "deep-focus",
      order: 3,
      title: "End session",
      description: "Stop a normal session. Deep sessions refuse until they expire.",
      viz: "number",
      action: { tool: "stop_focus_session", params: {}, label: "End now", confirm: true },
      spec: { rangeDays: 1, groupBy: "app", metric: "time", distraction: "all" }
    },
    // ── Logic (the AI's working memory, not activity) ─────────────────────────
    // These read non-activity sources, resolved in main by cards/sources.ts rather than
    // aggregated by runAnalyticsQuery, which only understands the session log.
    // ── Scheduler ─────────────────────────────────────────────────────────────
    {
      ...base,
      id: seedId("sch-active"),
      kind: "data",
      page: "scheduler",
      order: 0,
      title: "Your schedules",
      description: "Blocks that turn on and off by themselves",
      viz: "list",
      spec: { source: "schedules", rangeDays: 31, groupBy: "app", metric: "time", distraction: "all", limit: 10 }
    },
    {
      ...base,
      id: seedId("sch-workday"),
      kind: "action",
      page: "scheduler",
      order: 1,
      title: "Work hours focus",
      description: "Block social media 9 to 5, weekdays",
      viz: "number",
      action: {
        tool: "create_schedule",
        params: { name: "Work hours focus", days: [1, 2, 3, 4, 5], start_time: "09:00", end_time: "17:00", categories: ["social_media"] },
        label: "Add this schedule",
        confirm: true
      },
      spec: { rangeDays: 1, groupBy: "app", metric: "time", distraction: "all" }
    },
    {
      ...base,
      id: seedId("sch-evening"),
      kind: "action",
      page: "scheduler",
      order: 2,
      title: "Wind down",
      description: "Block video and social from 10pm, every night",
      viz: "number",
      action: {
        tool: "create_schedule",
        params: { name: "Wind down", days: [0, 1, 2, 3, 4, 5, 6], start_time: "22:00", end_time: "06:00", categories: ["video", "social_media"] },
        label: "Add this schedule",
        confirm: true
      },
      spec: { rangeDays: 1, groupBy: "app", metric: "time", distraction: "all" }
    }
  ];
}
function mergeSeeds(existing, dismissedSeedIds = []) {
  const have = new Set(existing.map((c) => c.id));
  const dismissed = new Set(dismissedSeedIds);
  const missing = defaultCards().filter((c) => !have.has(c.id) && !dismissed.has(c.id));
  if (!missing.length) return existing;
  return [...existing, ...missing];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  defaultCards,
  mergeSeeds
});
