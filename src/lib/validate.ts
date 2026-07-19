import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats.default ? addFormats.default(ajv) : (addFormats as unknown as (a: Ajv2020) => void)(ajv);

function load(name: string): ValidateFunction {
  const schema = JSON.parse(readFileSync(join(schemasDir, name), "utf8"));
  return ajv.compile(schema);
}

export const validatePayload = load("payload.schema.json");
export const validateSeries = load("series.schema.json");
export const validateEpisode = load("episode.schema.json");

export function assertValid(
  validate: ValidateFunction,
  data: unknown,
  label: string,
): asserts data {
  if (!validate(data)) {
    const details = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(`${label} failed validation:\n${details}`);
  }
}
