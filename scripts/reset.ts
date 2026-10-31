// Run: pnpm demo:reset. Wipes all 7 schemas and reseeds, in one process.
import { reset } from "../src/inject/reset";

reset().then(({ truncate_ms, ms }) => {
  console.log(`truncated in ${truncate_ms} ms; reset ok in ${ms} ms`);
  process.exit(0);
}, (e) => { console.error(e); process.exit(1); });
