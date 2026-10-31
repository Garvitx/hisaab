// pnpm inject <type> --demo | --merchant MID-xxxx | --random [--failed]
// pnpm inject:decoy <type> [--demo | --merchant MID-xxxx | --random]
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const args = process.argv.slice(2), has = (f: string) => args.includes(f);
  const type = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--merchant");
  const target = has("--demo") ? "demo" : has("--merchant") ? args[args.indexOf("--merchant") + 1] : "random";
  // Dynamic import: db.ts reads DATABASE_URL at load, which must happen after dotenv.
  const { inject, catalog } = await import("../src/inject");
  if (!type) {
    const c = catalog();
    throw new Error(`usage: pnpm inject <type> --demo|--merchant MID-xxxx|--random [--failed]\n  types: ${c.types.map((t) => t.type).join(", ")}\n  decoys: ${c.decoys.map((t) => t.type).join(", ")}`);
  }
  const t0 = Date.now();
  const r = await inject(type, target, { decoy: has("--decoy"), failed: has("--failed") });
  console.log(`${has("--decoy") ? "decoy " : ""}${type} -> ${r.merchant_id}: ${r.summary} [${r.injection_id}, ${Date.now() - t0} ms]`);
}

main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
