/** One content script per frame; everything it does lives in the controller. */
import { startController } from "./controller";

startController({ window: globalThis as unknown as Window & typeof globalThis });
