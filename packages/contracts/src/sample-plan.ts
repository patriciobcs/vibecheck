import type { StudyPlan } from "./study-plan";

/**
 * SAMPLE DATA. A labeled stand-in for the VC-01 handoff, taken from specs/README.md.
 * The commit SHA is a placeholder; no real baseline build exists yet.
 */
export const SAMPLE_STUDY_PLAN: StudyPlan = {
  schema_version: "1.0",
  study_id: "study_sample_reschedule",
  study_revision: 1,
  product_id: "product_sample_booking",
  task: {
    task_id: "task_reschedule",
    participant_prompt:
      "Your haircut is booked for September 22 at 3 p.m., but your plans have changed. You are available September 25 at 4 p.m. Use this app to arrange your appointment for that time.",
    research_question: "Can a customer change an existing appointment?",
    time_limit_seconds: 300,
    success_rule_ref: "booking_time_changed_v1",
    fixture_ref: "booking_fixture_v1",
  },
  baseline: {
    commit_sha: "0000000000000000000000000000000000000000",
    environment_ref: "baseline_preview",
  },
  recruitment: {
    source: "marketplace",
    target_count: 2,
    cohort: "fresh",
    eligibility_rule_ref: "eligible_booking_users_v1",
  },
  capture: {
    screen: "required",
    microphone: "required",
    webcam: "off",
    pointer: "on",
    keyboard: "semantic_only",
    text_values: "off",
    retention_days: 30,
  },
  automation: {
    mode: "prototype_and_retest",
    max_variants: 1,
    max_repair_attempts: 2,
    agent_budget_ref: "demo_budget",
    retest_target_count: 2,
  },
};
