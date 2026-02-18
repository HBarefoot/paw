export interface PawConfig {
  provider: "claude" | "ollama" | "openai" | "gemini";
  ai: {
    apiKey: string;
    authMethod: "api_key" | "oauth";
    model: string;
    maxTokens: number;
    maxToolRoundtrips: number;
  };
  ollama: {
    baseUrl: string;
    model: string;
    maxToolRoundtrips: number;
  };
  openai: {
    apiKey: string;
    model: string;
    maxTokens: number;
    maxToolRoundtrips: number;
    baseUrl: string;
  };
  gemini: {
    apiKey: string;
    model: string;
    maxTokens: number;
    maxToolRoundtrips: number;
  };
  memory: {
    enabled: boolean;
    embeddingModel: string;
    vectorWeight: number;
    ftsWeight: number;
    autoExtract: boolean;
    maxRecallResults: number;
  };
  cron: {
    enabled: boolean;
    tickIntervalMs: number;
  };
  heartbeat: {
    enabled: boolean;
    intervalMinutes: number;
    triggerAiOnFailure: boolean;
    workspacePath: string;
  };
  security: {
    enforcePermissions: boolean;
    requireApproval: boolean;
    pairingCodeTtlMinutes: number;
    rateLimiting: {
      enabled: boolean;
      maxRequestsPerMinute: number;
    };
    allowedUsers: string[];
    blockedUsers: string[];
  };
  web: {
    enabled: boolean;
    host: string;
    port: number;
    authToken?: string;
    username: string;
    password: string;
  };
  workspace: {
    path: string;
    maxFileSize: number;
    maxOutputLength: number;
    execTimeout: number;
    allowedCommands?: string[];
  };
  slack: {
    botToken: string;
    appToken: string;
    signingSecret: string;
  };
  webPilot: {
    headless: boolean;
    maxPages: number;
    defaultTimeout: number;
  };
  agent: {
    name: string;
    systemPrompt: string;
  };
  store: {
    dbPath: string;
    customSqlitePath?: string;
    messageHistoryLimit: number;
  };
  log: {
    level: "debug" | "info" | "warn" | "error";
  };
  mcpServers: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    transport?: "stdio" | "sse" | "http";
  }>;
}
