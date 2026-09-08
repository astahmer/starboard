import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"ui-button",
	{
		variants: {
			variant: {
				default: "ui-button-default",
				secondary: "ui-button-secondary",
				outline: "ui-button-outline",
				ghost: "ui-button-ghost",
				destructive: "ui-button-destructive",
			},
			size: {
				default: "ui-button-default-size",
				sm: "ui-button-sm",
				lg: "ui-button-lg",
				icon: "ui-button-icon",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
	<button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));

Button.displayName = "Button";

export { buttonVariants };
