/**
 * Platform operator authenticated in the superadmin console.
 *
 * Unlike the school ERP actor, it is not bound to any tenant: superadmins
 * live in the `users` table of the master database (`role = 'superadmin'`).
 */
export interface PlatformActor {
  userId: number;
  email: string;
  name: string;
  role: 'superadmin';
}
