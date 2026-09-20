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
    "Fixture detector for the demo target: the export journey has progress (drawing started, export dialog opened), attempts/results for the export and share controls, main-menu and share-dialog navigation, help requests and a client-observed completion.",
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
    wrong_path_taken: {
      type: "noul" as const,
      instructions:
        "The supplied events show the user opened a control that does not lead to an image of the drawing, such as the share or live collaboration dialog, and left it without a successful result.",
      criteria: {
        true: "At least one attempt on a share or collaboration control ended cancelled or failed.",
        false: "No such detour is present in the events.",
      },
    },
    goal_reached: {
      type: "noul" as const,
      instructions:
        "The supplied events show the journey reached its goal: an image export action succeeded and a completion event is present.",
      criteria: {
        true: "A successful export result and a completion event are present.",
        false: "No successful export or completion is present.",
      },
    },
    recovered_after_help: {
      type: "noul" as const,
      instructions:
        "The supplied events show that a help request was followed, later in the same journey, by progress toward the goal or by the goal being reached.",
      criteria: {
        true: "Progress or completion events occur after a help request.",
        false: "No help request is present, or nothing follows it.",
      },
    },
    confusion_source: {
      type: "choice" as const,
      instructions:
        "Judged only from the supplied events, which explanation best fits the observed difficulty in getting an image of the drawing.",
      criteria: {
        share_mistaken_for_export:
          "The user tried the share or collaboration control when looking for an image export.",
        export_hidden_in_menu:
          "The user reached the export only after opening the main menu or asking for help.",
        export_dialog_unclear: "The export dialog was opened but the export did not succeed.",
        none_or_uncertain:
          "No difficulty is observed, or the events do not support an explanation.",
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
