import { Main } from "@freelensapp/extensions";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

class TabsIpc extends Main.Ipc {}

export default class StructuredLogsMain extends Main.LensExtension {
  onActivate() {
    const file = async (clusterId: string) => {
      if (!/^[0-9a-f]{32}$/.test(clusterId)) throw new Error("Invalid cluster ID");
      return join(await this.getExtensionFileFolder(), `tabs-${clusterId}.json`);
    };
    const ipc = TabsIpc.createInstance(this);
    ipc.handle("load-tabs", async (_event, clusterId: string) => {
      const path = await file(clusterId);
      try {
        return JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
      }
    });
    ipc.handle("save-tabs", async (_event, clusterId: string, targets: Record<string, unknown>) => {
      writeFileSync(await file(clusterId), JSON.stringify(targets));
    });
  }
}
