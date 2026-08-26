/** The injected script's only job: start the agent with the key it was given. */
import { bootstrapFromScript } from "./agent";

bootstrapFromScript(document.currentScript as HTMLScriptElement | null);
