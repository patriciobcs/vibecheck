import { fixtureValidator } from "./fixture";
import type { Validator } from "./types";

export function validatorFor(name = process.env.VALIDATOR ?? "fixture"): Validator {
  if (name !== "fixture") throw new Error(`validator_unavailable_${name}`);
  return fixtureValidator;
}
