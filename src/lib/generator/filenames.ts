import type { GeneratorContext } from "./types";
import { weightedChoice, randInt } from "./keys";
import { PARTNERS } from "./config";

// Generate a filename for the given partner based on their file_types config
export function generateFilename(
  partnerKey: string,
  dateStr: string, // YYYYMMDD
  ctx: GeneratorContext
): [string, number] {
  const p = PARTNERS[partnerKey];
  const [template, sizeRange] = weightedChoice(p.file_types, p.file_type_weights);
  const fileSize = randInt(sizeRange[0], sizeRange[1]);

  let filename = template;
  filename = filename.replace("{date}", dateStr);

  if (filename.includes("{seq}")) {
    const seq = String(ctx.keyCounter % 999 + 1).padStart(3, "0");
    filename = filename.replace("{seq}", seq);
  }

  if (filename.includes("{batch}")) {
    const batch = String(ctx.batchCounter++).padStart(4, "0");
    filename = filename.replace("{batch}", batch);
  }

  if (filename.includes("{id}")) {
    const id = String(ctx.loanIdCounter++);
    filename = filename.replace("{id}", id);
  }

  return [filename, fileSize];
}

// Generate a specific filename (for scenarios that need exact names)
export function specificFilename(name: string, fileSize: number): [string, number] {
  return [name, fileSize];
}
