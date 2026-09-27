import { z } from 'zod';

// Our CSP forbids eval (script-src 'self', brief 15.5). zod 4 probes `new Function` for its JIT;
// the probe is caught, but browsers still report it as a CSP violation. jitless skips the probe.
// Imported first in main.tsx so it applies before any schema is used.
z.config({ jitless: true });
