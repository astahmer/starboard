import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import App from "./App";
import { workspaceSearchSchema } from "./lib/workspace-route-state";

const rootRoute = createRootRoute({
	component: () => <Outlet />,
});

const workspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: "workspace",
	component: App,
	validateSearch: workspaceSearchSchema.parse,
});

const allSavesRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: "/",
});

const providerRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: "/sources/$providerId",
});

const collectionRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: "/collections/$collectionId",
});

export const routeTree = rootRoute.addChildren([workspaceRoute.addChildren([allSavesRoute, providerRoute, collectionRoute])]);
