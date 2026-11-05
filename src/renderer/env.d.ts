// The host provides react-dom 17 as a global; only the calls used here are typed.
declare module "react-dom" {
  import type { ReactElement, ReactNode, ReactPortal } from "react";

  export function render(element: ReactElement, container: Element): void;
  export function unmountComponentAtNode(container: Element): boolean;
  export function createPortal(children: ReactNode, container: Element): ReactPortal;
}
