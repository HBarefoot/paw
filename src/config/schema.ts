import { z } from "zod";

export const configSchema = z.object({
  provider: z.enum(["claude", "ollama", "openai", "gemini"]).default("claude"),
  ai: z.object({
    apiKey: z.string().default(""),
    authMethod: z.enum(["api_key", "oauth"]).default("api_key"),
    model: z.string().default("claude-sonnet-4-5-20250929"),
    maxTokens: z.number().int().positive().default(4096),
    maxToolRoundtrips: z.number().int().positive().default(10),
  }),
  ollama: z.object({
    baseUrl: z.string().default("http://localhost:11434"),
    model: z.string().default("llama3.1"),
    maxToolRoundtrips: z.number().int().positive().default(10),
  }),
  openai: z.object({
    apiKey: z.string().default(""),
    model: z.string().default("gpt-4o"),
    maxTokens: z.number().int().positive().default(4096),
    maxToolRoundtrips: z.number().int().positive().default(10),
    baseUrl: z.string().default("https://api.openai.com/v1"),
  }),
  gemini: z.object({
    apiKey: z.string().default(""),
    model: z.string().default("gemini-2.0-flash"),
    maxTokens: z.number().int().positive().default(4096),
    maxToolRoundtrips: z.number().int().positive().default(10),
  }),
  memory: z.object({
    enabled: z.boolean().default(true),
    embeddingModel: z.string().default("Xenova/all-MiniLM-L6-v2"),
    vectorWeight: z.number().default(0.7),
    ftsWeight: z.number().default(0.3),
    autoExtract: z.boolean().default(true),
    maxRecallResults: z.number().int().positive().default(10),
  }),
  cron: z.object({
    enabled: z.boolean().default(true),
    tickIntervalMs: z.number().int().positive().default(60_000),
  }),
  heartbeat: z.object({
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().int().positive().default(30),
    triggerAiOnFailure: z.boolean().default(true),
    workspacePath: z.string().default("."),
  }),
  security: z.object({
    enforcePermissions: z.boolean().default(true),
    requireApproval: z.boolean().default(false),
    pairingCodeTtlMinutes: z.number().int().positive().default(10),
    rateLimiting: z.object({
      enabled: z.boolean().default(true),
      maxRequestsPerMinute: z.number().int().positive().default(30),
    }),
    allowedUsers: z.array(z.string()).default([]),
    blockedUsers: z.array(z.string()).default([]),
  }),
  web: z.object({
    enabled: z.boolean().default(false),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(3000),
    authToken: z.string().optional(),
    username: z.string().default("admin"),
    password: z.string().default(""),
  }),
  workspace: z.object({
    path: z.string().default("."),
    maxFileSize: z.number().int().positive().default(1_048_576),
    maxOutputLength: z.number().int().positive().default(10_000),
    execTimeout: z.number().int().positive().default(30_000),
    allowedCommands: z.array(z.string()).optional(),
  }),
  slack: z.object({
    botToken: z.string().default(""),
    appToken: z.string().default(""),
    signingSecret: z.string().default(""),
  }),
  webPilot: z.object({
    headless: z.boolean().default(true),
    maxPages: z.number().int().positive().default(3),
    defaultTimeout: z.number().int().positive().default(30_000),
  }),
  agent: z.object({
    name: z.string().default("Paw"),
    systemPrompt: z.string().default(""),
  }).default({}),
  store: z.object({
    dbPath: z.string().default("./data/paw.db"),
    customSqlitePath: z.string().optional(),
    messageHistoryLimit: z.number().int().positive().default(20),
  }),
  log: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
  skills: z.record(z.string(), z.object({
    description: z.string().optional(),
    alwaysActive: z.boolean().optional(),
    disabledTools: z.array(z.string()).optional(),
  })).default({}),
  mcpServers: z.record(z.string(), z.object({
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    transport: z.enum(["stdio", "sse", "http"]).default("stdio"),
  })).default({}),
});

export type ConfigSchema = z.infer<typeof configSchema>;
