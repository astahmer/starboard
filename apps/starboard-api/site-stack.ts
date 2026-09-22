import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
	"StarboardDemo",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const site = yield* Cloudflare.Website.StaticSite("StarboardDemo", {
			cwd: "../starboard",
			command: "pnpm build",
			outdir: "dist",
			assets: {
				notFoundHandling: "single-page-application",
			},
		});

		return { url: site.url };
	}),
);
