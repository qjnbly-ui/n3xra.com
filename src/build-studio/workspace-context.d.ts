export function readWorkspaceContext(scope: string, userId: string): { websiteId?: string };
export function writeWorkspaceContext(scope: string, userId: string, values: Record<string, unknown>): void;
