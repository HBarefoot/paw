/**
 * WordPress integration types. The agent talks to the WP REST API
 * (`/wp-json/wp/v2`) authenticated with an Application Password (HTTP Basic).
 * The password is overlaid from the vault (slot `wordpress.appPassword`) and
 * never reaches the model.
 */

export interface WordPressClientConfig {
	url: string;
	username: string;
	appPassword: string;
	timeout?: number;
}

/** Posts and pages share the same CRUD surface. */
export type WordPressContentType = "posts" | "pages";

export interface WordPressContentInput {
	title?: string;
	content?: string;
	excerpt?: string;
	/** Defaults to "draft" on create unless explicitly set to "publish" etc. */
	status?: string;
	slug?: string;
	categories?: number[];
	tags?: number[];
}

export interface WordPressTerm {
	id: number;
	name: string;
	slug: string;
	count?: number;
}

export class WordPressError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly statusText: string,
	) {
		super(message);
		this.name = "WordPressError";
	}
}

export class WordPressTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WordPressTimeoutError";
	}
}
