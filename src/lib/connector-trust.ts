import type { ConnectorTrustOverview, ConnectorTrustPolicy, ConnectorTrustReview } from "../../shared/connector-trust";
import { api } from "@/state/store";

const path = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/connector-trust`;
export const readConnectorTrust = (botId: string, signal?: AbortSignal): Promise<ConnectorTrustOverview> => api(path(botId), { signal });
export const saveConnectorTrust = (botId: string, review: ConnectorTrustReview): Promise<{ policy: ConnectorTrustPolicy }> => api(path(botId), { method: "PUT", body: JSON.stringify(review) });
export const revokeConnectorTrust = (botId: string, expectedRevision: number): Promise<{ policy: ConnectorTrustPolicy }> => api(`${path(botId)}/revoke`, { method: "POST", body: JSON.stringify({ expectedRevision }) });
