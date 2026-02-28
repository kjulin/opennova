import { createRegistry } from "./resolvers.js";

// Re-export types
export type {
  ResolverContext,
  CapabilityConfig,
  CapabilitiesRecord,
  ToolDescriptor,
  CapabilityDescriptor,
  ResolvedCapability,
  ResolvedCapabilities,
  CapabilityResolver,
} from "./registry.js";

export { CapabilityRegistry } from "./registry.js";
export { filterTools } from "./tool-filter.js";

// Singleton registry with all built-in capabilities
export const capabilityRegistry = createRegistry();

// Re-export resolveInjections (unchanged from old module)
export { resolveInjections } from "./injections.js";
