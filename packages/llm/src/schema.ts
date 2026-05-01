import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";
import schema from "../../../data/schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
export const validateExtraction = ajv.compile(schema as any);
export const extractionJsonSchema = schema as any;

export function formatAjvErrors(errors: ErrorObject[] | null | undefined) {
  if (!errors?.length) return [];
  return errors.map((e) => {
    const instancePath = e.instancePath || "/";
    const msg = e.message ?? "invalid";
    const extra = e.params ? ` (${JSON.stringify(e.params)})` : "";
    return `${instancePath} ${msg}${extra}`;
  });
}

