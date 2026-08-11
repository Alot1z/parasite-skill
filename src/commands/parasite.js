// Parasite command - manage runtime extensions without modifying source
import { readFileSync, writeFileSync } from "node:fs";
import { CLIENTS } from "../clients.js";
import { 
  addInjection, 
  generateBuildHook, 
  generateServerWrapper, 
  protectTraceability,
  listExtensions, 
  toggleInjection, 
  removeInjection,
  getInjectionStatus 
} from "../parasite/index.js";
import { banner, smallLogo } from "../logo.js";

/**
 * Parasite command - enhance clients without modifying source
 */
export function cmdParasite(args) {
  console.log(banner());

  // Per-project parasite control from skill-router.json (merged into args):
  //  - "parasite": false                -> injections disabled for this project
  //  - "parasite": { enabled, clients } -> restrict which clients are touched
  //  - "clients": [...]                 -> project-wide client allowlist
  const parasiteCfg = args.parasite;
  if (parasiteCfg && parasiteCfg.enabled === false) {
    if (!args.add && !args.remove && !args.toggle && !args.hook && !args.wrap && !args.protect) {
      console.log('');
      console.log('  ⛔ parasite is disabled for this project (skill-router.json: "parasite": false)');
      console.log('');
      return 0;
    }
    console.error('parasite is disabled for this project (skill-router.json). Set "parasite": true to re-enable.');
    return 1;
  }
  const allowedClients = new Set(
    (Array.isArray(parasiteCfg?.clients) ? parasiteCfg.clients : [])
      .concat(Array.isArray(args.clients) ? args.clients : []),
  );
  
  // List all injections
  if (args.status || (!args.add && !args.remove && !args.toggle && !args.hook && !args.wrap && !args.protect)) {
    console.log("\\nParasite Extension Status:\\n");
    const status = getInjectionStatus();
    
    for (const s of status) {
      if (allowedClients.size && !allowedClients.has(s.client)) continue;
      const mark = s.active > 0 ? "●" : "○";
      console.log(`  ${mark} ${s.label}: ${s.active}/${s.injections} active`);
      if (s.injections > 0) {
        console.log(`    path: ${s.path}`);
      }
    }
    console.log("\\n  ● = active injections  ○ = no injections\\n");
    return 0;
  }
  
  // Add injection
  const guardClient = (clientId) => {
    if (allowedClients.size && !allowedClients.has(clientId)) {
      console.error('client "' + clientId + '" is not in this project. allowed clients (skill-router.json)');
      console.error('allowed: ' + [...allowedClients].join(", "));
      return true;
    }
    return false;
  };

  if (args.add) {
    const clientId = args.agent || "universal";
    if (guardClient(clientId)) return 1;
    const client = CLIENTS.find(c => c.id === clientId);
    
    if (!client) {
      console.error(`unknown client: ${clientId}`);
      console.error(`available: ${CLIENTS.map(c => c.id).join(", ")}`);
      return 1;
    }
    
    const code = args.code || `// Injection ${Date.now()}\nconsole.log('skill-router parasite active');`;
    const type = args.type || "hook";
    const target = args.target || "default";
    const position = args.position || "wrap";
    
    const injection = addInjection(client, {
      id: args.id,
      type,
      code,
      target,
      position
    });
    
    console.log(`\\n  ${smallLogo()} Added injection to ${client.label}:`);
    console.log(`    id: ${injection.id}`);
    console.log(`    type: ${injection.type}`);
    console.log(`    target: ${injection.target}`);
    console.log(`    position: ${injection.position}\\n`);
    return 0;
  }
  
  // Remove injection
  if (args.remove) {
    const clientId = args.agent || "universal";
    if (guardClient(clientId)) return 1;
    const client = CLIENTS.find(c => c.id === clientId);
    
    if (!client) {
      console.error(`unknown client: ${clientId}`);
      return 1;
    }
    
    const removed = removeInjection(client, args.remove);
    if (removed) {
      console.log(`\\n  ${smallLogo()} Removed injection ${args.remove} from ${client.label}\\n`);
    } else {
      console.error(`injection ${args.remove} not found`);
      return 1;
    }
    return 0;
  }
  
  // Toggle injection
  if (args.toggle) {
    const clientId = args.agent || "universal";
    if (guardClient(clientId)) return 1;
    const client = CLIENTS.find(c => c.id === clientId);
    
    if (!client) {
      console.error(`unknown client: ${clientId}`);
      return 1;
    }
    
    const enabled = args.enable !== false;
    const toggled = toggleInjection(client, args.toggle, enabled);
    if (toggled) {
      console.log(`\\n  ${smallLogo()} ${enabled ? "Enabled" : "Disabled"} injection ${args.toggle} in ${client.label}\\n`);
    } else {
      console.error(`injection ${args.toggle} not found`);
      return 1;
    }
    return 0;
  }
  
  // Generate build hook
  if (args.hook) {
    const format = args.format || "vite";
    const hookCode = generateBuildHook({ format, env: args.env });
    
    const outPath = args.out || `skill-router-parasite-${format}.js`;
    writeFileSync(outPath, hookCode);
    
    console.log(`\\n  ${smallLogo()} Generated ${format} hook: ${outPath}\\n`);
    return 0;
  }
  
  // Generate server wrapper
  if (args.wrap) {
    const serverPath = args.server || "./upstream-server.js";
    const wrapperCode = generateServerWrapper({ serverPath, env: args.env });
    
    const outPath = args.out || "parasite-wrapped-server.js";
    writeFileSync(outPath, wrapperCode);
    
    console.log(`\\n  ${smallLogo()} Generated server wrapper: ${outPath}\\n`);
    console.log("  Usage: import from 'parasite-wrapped-server.js' instead of upstream\\n");
    return 0;
  }
  
  // Protect traceability
  if (args.protect) {
    const level = args.level || "medium";
    
    let code;
    if (args.file) {
      code = readFileSync(args.file, "utf-8");
    } else if (args.code) {
      code = args.code;
    } else {
      console.error("provide --file or --code to protect");
      return 1;
    }
    
    const protectedCode = protectTraceability(code, { level });
    
    if (args.out) {
      writeFileSync(args.out, protectedCode);
      console.log(`\\n  ${smallLogo()} Protected code written to: ${args.out}\\n`);
    } else {
      console.log("\\n--- Protected Code ---\\n");
      console.log(protectedCode);
      console.log("\\n--- End ---\\n");
    }
    return 0;
  }
  
  return 0;
}
