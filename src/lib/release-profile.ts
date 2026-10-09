// The personal-agent installer is released independently of Exec Workspace.
export const sharedWorkspaceAvailable = import.meta.env.VITE_CHIEF_AGENT_ONLY !== "1";
export const upstreamServicesAvailable = sharedWorkspaceAvailable;
