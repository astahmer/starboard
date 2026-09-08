import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const children = [];
const baseEnv = { ...process.env };
const childScript = fileURLToPath(new URL("./starboard-child.mjs", import.meta.url));

function start(args, env) {
	const child = spawn(process.execPath, [childScript, "pnpm", ...args], { stdio: "inherit", env: { ...baseEnv, ...env }, detached: process.platform !== "win32" });
	children.push(child);
	return child;
}

start(["--filter", "starboard-api", "dev"], {
	APP_URL: process.env.APP_URL ?? "http://localhost:1337",
	WEB_APP_URL: process.env.WEB_APP_URL ?? "http://localhost:5174",
});
start(["--filter", "starboard", "dev", "--host", "localhost"], {
	VITE_STARBOARD_API_URL: process.env.VITE_STARBOARD_API_URL ?? "http://localhost:1337",
});

let stopping = false;

function stop(exitCode = 130) {
	if (stopping) return;
	stopping = true;
	process.exitCode = exitCode;
	for (const child of children) {
		if (child.pid !== undefined) child.kill("SIGTERM");
	}
	setTimeout(() => process.exit(exitCode), 300).unref();
}

for (const child of children) {
	child.once("exit", (code) => {
		if (!stopping) stop(code ?? 0);
	});
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
process.on("exit", () => {
	for (const child of children) if (child.pid !== undefined) child.kill("SIGTERM");
});
