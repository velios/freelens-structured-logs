import { Renderer } from "@freelensapp/extensions";
import { openLogsTab, startDockTabs, stopDockTabs } from "./dock-tabs";
import { LogsMenuItem } from "./logs-menu-item";

export default class StructuredLogsRenderer extends Renderer.LensExtension {
  async onActivate() {
    startDockTabs(await this.getExtensionFileFolder());
  }

  async onDeactivate() {
    stopDockTabs();
  }

  kubeObjectMenuItems = [
    {
      kind: "Pod",
      apiVersions: ["v1"],
      components: {
        MenuItem: (props: Renderer.Component.KubeObjectMenuProps<Renderer.K8sApi.Pod>) => (
          <LogsMenuItem {...props} onOpenLogs={openLogsTab} />
        ),
      },
    },
  ];
}
