// Side-effect imports: each capability module registers itself with the job engine.
// Import this once at every entry point (server actions, scripts, tests).
import "./transport/trips";
import "./finance/payments";
import "./documents/documents";
import "./transport/billing";
import "./transport/statements";
import "./jobs/activities";
