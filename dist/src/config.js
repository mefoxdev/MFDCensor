import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
const raw = readFileSync("config.toml", "utf8");
export const config = parse(raw);
