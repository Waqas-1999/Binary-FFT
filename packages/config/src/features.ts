/**
 * Feature flags shared by every app. Add a flag here when a feature needs a
 * rollout switch, then gate it with `isFeatureEnabled`.
 */
export const features = {} as const satisfies Record<string, boolean>;

export type FeatureFlag = keyof typeof features;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}
