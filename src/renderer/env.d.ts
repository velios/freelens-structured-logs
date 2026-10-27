// The host provides react-dom 17 as a global; only the calls used here are typed.
declare module "react-dom" {
  import type { ReactElement } from "react";

  export function render(element: ReactElement, container: Element): void;
  export function unmountComponentAtNode(container: Element): boolean;
}
