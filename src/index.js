// Public entry point. bin/parasite-skill.js imports run() from here.
export { run, parseFlags, HELP } from "./cli.js";
export { VERSION, SETS, registryDir, loadRegistry, scan, scanSkillAssets, scoreIdea, classifyRequest, composePayload } from "./engine.js";
export { CLIENTS } from "./clients.js";
