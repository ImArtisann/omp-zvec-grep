/** Native Oh My Pi entry point for omp-zvec-grep. */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
    registerAutoIndex,
    registerZvecCommands,
    registerZvecTools,
} from "./src/extension/tools.ts";

export default function (pi: ExtensionAPI): void {
    registerZvecTools(pi);
    registerZvecCommands(pi);
    registerAutoIndex(pi);
}
