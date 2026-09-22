import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export default Alchemy.Stack(
	"Starboard",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const optional = <A>(config: Config.Config<A>, fallback: A) => config.pipe(Effect.orElseSucceed(() => fallback));
		const database = yield* Cloudflare.D1.Database("StarboardDb", {
			jurisdiction: "eu",
			primaryLocationHint: "weur",
			migrations: "./migrations",
		});

		const api = yield* Cloudflare.Worker("StarboardApi", {
			main: "./src/index.ts",
			env: {
				DB: database,
				APP_URL: yield* optional(Config.string("APP_URL"), ""),
				WEB_APP_URL: yield* optional(Config.string("WEB_APP_URL"), ""),
				SESSION_SECRET: yield* optional(Config.redacted("SESSION_SECRET"), Redacted.make("")),
				GITHUB_CLIENT_ID: yield* optional(Config.string("GITHUB_CLIENT_ID"), ""),
				GITHUB_CLIENT_SECRET: yield* optional(Config.redacted("GITHUB_CLIENT_SECRET"), Redacted.make("")),
				GITHUB_API_URL: yield* optional(Config.string("GITHUB_API_URL"), ""),
				TANGLED_BOBBIN_URL: yield* optional(Config.string("TANGLED_BOBBIN_URL"), ""),
				TANGLED_RESOLVER_URL: yield* optional(Config.string("TANGLED_RESOLVER_URL"), ""),
				TANGLED_CLIENT_ID: yield* optional(Config.string("TANGLED_CLIENT_ID"), ""),
				TANGLED_AUTHORIZATION_URL: yield* optional(Config.string("TANGLED_AUTHORIZATION_URL"), ""),
				TANGLED_TOKEN_URL: yield* optional(Config.string("TANGLED_TOKEN_URL"), ""),
				TANGLED_SCOPE: yield* optional(Config.string("TANGLED_SCOPE"), ""),
				TANGLED_CLIENT_SECRET: yield* optional(Config.redacted("TANGLED_CLIENT_SECRET"), Redacted.make("")),
				EMBEDDING_API_URL: yield* optional(Config.string("EMBEDDING_API_URL"), ""),
				EMBEDDING_API_KEY: yield* optional(Config.redacted("EMBEDDING_API_KEY"), Redacted.make("")),
				EMBEDDING_MODEL: yield* optional(Config.string("EMBEDDING_MODEL"), ""),
				LLM_API_URL: yield* optional(Config.string("LLM_API_URL"), ""),
				LLM_API_KEY: yield* optional(Config.redacted("LLM_API_KEY"), Redacted.make("")),
				LLM_MODEL: yield* optional(Config.string("LLM_MODEL"), ""),
				AUTOMATION_SIGNING_SECRET: yield* optional(Config.redacted("AUTOMATION_SIGNING_SECRET"), Redacted.make("")),
			},
			crons: ["*/15 * * * *"],
		});

		return {
			apiUrl: api.url,
			mcpUrl: Output.interpolate`${api.url}/mcp`,
		};
	}),
);
