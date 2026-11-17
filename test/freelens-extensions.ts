// Minimal stub of the host-provided `@freelensapp/extensions` module.
//
// At runtime the package reads `globalThis.FreelensExtensionApi` supplied by
// Freelens. Unit tests run without the host, so they alias the import to this
// file instead (see the `alias` option in `vitest.config.ts`).
//
// Only the surface actually exercised by the tests is stubbed here. Extend it
// as your tests need more of the host API.
import { vi } from "vitest";

class LensExtensionKubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: unknown;
  spec?: unknown;
  status?: unknown;

  constructor(data: Record<string, unknown> = {}) {
    Object.assign(this, data);
  }
}

export const Renderer = {
  K8sApi: {
    LensExtensionKubeObject,
    KubeApi: class KubeApi {},
    KubeObjectStore: class KubeObjectStore {},
  },
};

export const Common = {
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
};
