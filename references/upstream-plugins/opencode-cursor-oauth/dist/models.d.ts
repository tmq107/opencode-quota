export interface CursorModel {
    id: string;
    name: string;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
}
export interface CursorModelDiscoveryOptions {
    apiKey: string;
    baseUrl?: string;
    clientVersion?: string;
    timeoutMs?: number;
}
/**
 * Fetch models from Cursor's GetUsableModels gRPC endpoint.
 * Returns null on failure (caller should use fallback list).
 */
export declare function fetchCursorUsableModels(options: CursorModelDiscoveryOptions): Promise<CursorModel[] | null>;
export declare function getCursorModels(apiKey: string): Promise<CursorModel[]>;
