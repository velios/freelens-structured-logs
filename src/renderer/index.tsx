import { computed } from "mobx";
import { Renderer } from "@freelensapp/extensions";
import { DockTabs, openLogsTab, startDockTabs, stopDockTabs } from "./dock-tabs";
import { LogsMenuItem } from "./logs-menu-item";

class TabsIpc extends Renderer.Ipc {}

export default class StructuredLogsRenderer extends Renderer.LensExtension {
  async onActivate() {
    await startDockTabs(TabsIpc.createInstance(this));
  }

  async onDeactivate() {
    stopDockTabs();
  }

  clusterFrameComponents = [{ id: "structured-logs-dock", Component: DockTabs, shouldRender: computed(() => true) }];

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
