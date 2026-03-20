export declare function getProxyPort(): number | undefined;
export declare function startProxy(getAccessToken: () => Promise<string>): Promise<number>;
export declare function stopProxy(): void;
