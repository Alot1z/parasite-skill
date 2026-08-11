import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry, registryDir, loadSets, loadSetsWithProject, saveCustomSets, SETS } from "../engine.js";

export function cmdSets(args) {
  const reg = registryDir(args.registry);
  const payload = loadRegistry(reg, args.dirs, args.force);
  const installed = new Set(payload.skills.map((s) => s.name));
  const sets = loadSetsWithProject(reg, args.sets);
  const custom = currentCustom(reg);
  const builtin = new Set(Object.keys(SETS));

  // ---- editor: new set -----------------------------------------------------
  if (args.new) {
    const name = args.new;
    if (sets[name] && !args.force) {
      console.error(`set '${name}' already exists (use --force to replace)`);
      return 1;
    }
    const members = (args.members || "").split(",").map((m) => m.trim()).filter(Boolean);
    if (!members.length) {
      console.error("usage: sets --new NAME --members a,b,c [--desc text]");
      return 1;
    }
    custom[name] = { desc: args.desc || "custom set", members };
    ensureCustomDir(reg);
    saveCustomSets(reg, custom);
    console.log(`set '${name}' created (${members.length} members)`);
    return 0;
  }

  // ---- editor: add member --------------------------------------------------
  if (args.add) {
    const [name, member] = String(args.add).split(":");
    if (!name || !member) {
      console.error("usage: sets --add NAME:member");
      return 1;
    }
    if (!sets[name]) {
      console.error(`unknown set '${name}'. available: ${Object.keys(sets).join(", ")}`);
      return 1;
    }
    if (sets[name].project) {
      console.error(`'${name}' is defined in skill-router.json — edit the config file directly (project sets are not editable via the editor)`);
      return 1;
    }
    const target = custom[name] ?? { desc: sets[name].desc, members: [...sets[name].members] };
    if (!target.members.includes(member)) target.members.push(member);
    custom[name] = target;
    saveCustomSets(reg, custom);
    console.log(`'${member}' added to '${name}' (now ${target.members.length} members)`);
    return 0;
  }

  // ---- editor: remove member -----------------------------------------------
  if (args.remove) {
    const [name, member] = String(args.remove).split(":");
    if (!name || !member) {
      console.error("usage: sets --remove NAME:member");
      return 1;
    }
    if (sets[name]?.project) {
      console.error(`'${name}' is defined in skill-router.json — edit the config file directly (project sets are not editable via the editor)`);
      return 1;
    }
    const target = custom[name] ?? { desc: sets[name]?.desc, members: [...(sets[name]?.members ?? [])] };
    const idx = target.members.indexOf(member);
    if (idx === -1) {
      console.error(`'${member}' is not in '${name}'`);
      return 1;
    }
    target.members.splice(idx, 1);
    custom[name] = target;
    ensureCustomDir(reg);
    saveCustomSets(reg, custom);
    console.log(`'${member}' removed from '${name}' (now ${target.members.length} members)`);
    return 0;
  }

  // ---- editor: delete whole set ---------------------------------------------
  if (args.delete) {
    if (!custom[args.delete]) {
      console.error(`no custom set '${args.delete}' (built-ins cannot be deleted; --add/--remove edit copies)`);
      return 1;
    }
    delete custom[args.delete];
    ensureCustomDir(reg);
    saveCustomSets(reg, custom);
    console.log(`custom set '${args.delete}' deleted`);
    return 0;
  }

  // ---- view: load order -----------------------------------------------------
  if (args.apply) {
    const set = sets[args.apply];
    if (!set) {
      console.error(`unknown set '${args.apply}'. available: ${Object.keys(sets).join(", ")}`);
      return 1;
    }
    console.log(`set '${args.apply}': ${set.desc}`);
    set.members.forEach((m, i) => console.log(`  ${i + 1}. ${m}${installed.has(m) ? "" : "  (not installed)"}`));
    console.log("\nalways-on prepend: tractatus-thinking, sequential-thinking");
    console.log("always-on append: verification-before-completion, code-review-and-quality");
    return 0;
  }

  // ---- view: all sets -------------------------------------------------------
  for (const [name, set] of Object.entries(sets)) {
    const present = set.members.filter((m) => installed.has(m)).length;
    const projectMark = set.project ? " (project)" : "";
    const mark = builtin.has(name) ? "" : " *";
    console.log(`${name.padEnd(14)} ${set.desc.padEnd(32)} ${present}/${set.members.length} installed${mark}${projectMark}`);
  }
  console.log("\n* = custom set (editable via --new/--add/--remove/--delete)");
  console.log("(project) = defined in skill-router.json");
  return 0;
}

function currentCustom(reg) {
  try {
    const f = join(reg, "sets.custom.json");
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf-8")) : {};
  } catch {
    return {};
  }
}

function ensureCustomDir(reg) {
  try {
    mkdirSync(reg, { recursive: true });
  } catch {
    /* ignore */
  }
}
