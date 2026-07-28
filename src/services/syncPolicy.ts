export const AUTO_SAVE_DELAY_MS = 800;
export const HEALTH_POLL_INTERVAL_MS = 5_000;

export type RemoteRevisionAction = "none" | "reload" | "conflict";

export const decideRemoteRevisionAction = (
  localRevision: number,
  remoteRevision: number,
  hasLocalChanges: boolean,
): RemoteRevisionAction => {
  if (localRevision === remoteRevision) return "none";
  return hasLocalChanges ? "conflict" : "reload";
};
