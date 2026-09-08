import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("ui-badge", {
	variants: {
		variant: {
			default: "ui-badge-default",
			secondary: "ui-badge-secondary",
			outline: "ui-badge-outline",
			danger: "ui-badge-danger",
		},
	},
	defaultVariants: { variant: "default" },
});

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(({ className, variant, ...props }, ref) => (
	<div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));

Badge.displayName = "Badge";
