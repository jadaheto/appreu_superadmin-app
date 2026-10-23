/** Infrastructure-dependent naming rules of a school (configured by environment). */
export interface TenantNamingPort {
  /** Physical database for a slug, e.g. `apreu_colegio_norte`. */
  databaseNameFor(slug: string): string;
  /** Public URL of the school, e.g. `https://apreu.co/colegio-norte`. */
  publicUrlFor(slug: string): string;
}

export const TENANT_NAMING = Symbol('TenantNamingPort');
