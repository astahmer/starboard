import { execFileSync, spawn, spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) process.exit(2);

const child = spawn(command, args, { stdio: "inherit", env: process.env });
const rootParentPid = process.ppid;
let stopping = false;

function descendants(pid) {
	if (process.platform === "win32") return [];
	try {
		const output = execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		return output ? output.split(/\s+/).flatMap((value) => { const childPid = Number(value); return [childPid, ...descendants(childPid)]; }) : [];
	} catch {
		return [];
	}
}

function terminateTree(pid) {
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
		return;
	}
	for (const childPid of descendants(pid).reverse()) {
		try { process.kill(childPid, "SIGTERM"); } catch { /* already gone */ }
	}
	try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
}

function stop(exitCode = 130) {
	if (stopping) return;
	stopping = true;
	clearInterval(parentWatch);
	terminateTree(child.pid);
	setTimeout(() => process.exit(exitCode), 250).unref();
}

const parentWatch = setInterval(() => {
	if (process.ppid !== rootParentPid && process.ppid === 1) stop(0);
}, 100);
parentWatch.unref();

child.once("error", () => stop(1));
child.once("exit", (code, signal) => {
	if (!stopping) {
		clearInterval(parentWatch);
		process.exitCode = code ?? (signal ? 1 : 0);
	}
});

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
process.on("exit", () => {
	clearInterval(parentWatch);
	if (child.pid !== undefined) terminateTree(child.pid);
});
