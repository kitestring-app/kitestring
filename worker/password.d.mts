export const ITERATIONS: number;
export interface PasswordHash { pw_hash: string; salt: string; iterations: number }
export function hex(bytes: ArrayBuffer | Uint8Array): string;
export function hashPassword(password: string, salt?: string, iterations?: number): Promise<PasswordHash>;
export function constantEqual(a: string, b: string): boolean;
export function verifyPassword(password: string, user: PasswordHash): Promise<boolean>;
