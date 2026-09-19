# Agent instructions for VibeCheck

Read `specs/README.md` and the relevant workflow specs before changing product behavior.

The specs describe the intended product, not proof that features are implemented. They are flexible: make reasonable changes within the user's authorized scope without asking for approval merely because a spec needs updating.

When changing behavior, interfaces, data models, configuration, workflow states, dependencies, or scope:

1. Update every affected spec in the same change as the implementation.
2. Edit the spec itself to describe current behavior, including relevant rationale and compatibility or migration requirements. Use Git history for change tracking; do not add manual change logs, per-change files, document revision counters, or routine updated-date fields.
3. Update shared contracts in `specs/README.md` and all producers/consumers together. Use a new schema version for breaking changes.
4. Record unresolved choices in Open decisions; do not silently present assumptions as verified facts.
5. Update acceptance criteria and run relevant verification. Report implementation limitations honestly.
6. Reference affected spec IDs and explain the reason for changes in the commit, PR or handoff. If there is no PR, include a concise explanation in the completion message.

Do not fabricate human sessions, passing checks, adoption metrics, or validation. Sample data and demo modifications must be labeled. Do not upload private session media, transcripts, credentials, or personal information to public GitHub issues.

Use the existing repository conventions. These documentation rules do not authorize production deployment, changes to upstream third-party repositories, or unsolicited messages to real participants while developing the application.
