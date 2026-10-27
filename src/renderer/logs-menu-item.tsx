import { Renderer } from "@freelensapp/extensions";

const {
  Component: { MenuItem, Icon },
} = Renderer;

export interface LogsMenuItemProps extends Renderer.Component.KubeObjectMenuProps<Renderer.K8sApi.Pod> {
  onOpenLogs: (pod: Renderer.K8sApi.Pod) => void;
}

export const LogsMenuItem = ({ object, toolbar, onOpenLogs }: LogsMenuItemProps) => {
  if (!object) return null;

  return (
    <MenuItem onClick={() => onOpenLogs(object)}>
      <Icon material="data_object" interactive={toolbar} tooltip="Structured logs" />
      <span className="title">Structured logs</span>
    </MenuItem>
  );
};
