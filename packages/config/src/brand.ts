/**
 * The single source of truth for the product brand.
 * Rename the product by editing this object only; never hard-code these values elsewhere.
 */
export const brand = {
  name: "BINERY FTT",
  shortName: "BINERY",
} as const;

export type Brand = typeof brand;
