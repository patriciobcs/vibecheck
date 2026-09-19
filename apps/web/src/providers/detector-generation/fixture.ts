import type { DetectorGenerator } from "./types";

/** Deterministic detector for the Excalidraw "share drawing" journey. Labeled fixture, not agent output. */
export const EXCALIDRAW_SHARE_DRAWING_DETECTOR = {
  schema_version: "1.0" as const,
  journey_id: "share_drawing",
  required_events: [
    "journey_start",
    "progress",
    "action_attempt",
    "action_result",
    "help_request",
    "completion",
  ],
  missing_instrumentation: [],
  rationale:
    "Fixture detector for the demo target: the export journey has progress (drawing started, export dialog opened), attempts/results for the export action, help requests and a client-observed completion.",
  questions: {
    evidence_sufficiency: {
      type: "choice" as const,
      instructions:
        "Does the supplied journey state contain enough observed context to assess interference with progress? Missing signals must not be inferred.",
      criteria: {
        sufficient: "Relevant actions, progress coverage and outcomes are available.",
        partial: "Some interference can be assessed, but relevant context or outcomes are missing.",
        insufficient: "The available observations do not support an assessment.",
      },
    },
    ux_friction_observed: {
      type: "noul" as const,
      instructions:
        "Observed events demonstrate difficulty making progress in this journey. Silence, slow reading or inactivity alone do not demonstrate difficulty.",
      criteria: {
        true: "Events show failed attempts, unsuccessful detours or an explicit request for help.",
        false: "Available events do not demonstrate difficulty making progress.",
      },
    },
    targeted_research_warranted: {
      type: "noul" as const,
      instructions:
        "The supplied observations justify a targeted human usability study of this journey, considering missing context and plausible ordinary behavior.",
      criteria: {
        true: "Specific observed difficulty provides a useful research question.",
        false: "No specific observed difficulty supports targeted research.",
      },
    },
    problem_category: {
      type: "choice" as const,
      instructions:
        "Which category best describes the observed difficulty, judged only from the supplied events.",
      criteria: {
        discoverability: "The user could not locate the control or entry point for the goal.",
        feedback: "The user acted but the outcome or state was unclear.",
        failure: "An attempted action failed or was rejected.",
        other_or_uncertain: "Another category, or the events do not support a category.",
      },
    },
    export_dialog_reached: {
      type: "noul" as const,
      instructions:
        "The supplied events show the export image dialog was opened at least once during this journey.",
      criteria: {
        true: "A progress event for the export dialog is present.",
        false: "No export dialog progress event is present.",
      },
    },
  },
};

export const fixtureDetectorGenerator: DetectorGenerator = {
  name: "fixture",
  async generate(ctx) {
    return {
      raw: { ...EXCALIDRAW_SHARE_DRAWING_DETECTOR, journey_id: ctx.journeyHint || "share_drawing" },
      handle: {},
    };
  },
};
