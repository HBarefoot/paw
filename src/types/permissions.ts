export enum Permission {
	Net = "net",
	Browser = "browser",
	FileRead = "file:read",
	FileWrite = "file:write",
	Exec = "exec",
}

export interface PluginManifest {
	name: string;
	version: string;
	description: string;
	permissions: string[]; // e.g. ["net:*.slack.com", "browser"]
}
