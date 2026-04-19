import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
    zIndex?: "base" | "nested" | "alert" | "top";
  }
>(({ className, zIndex = "base", ...props }, ref) => {
  const zIndexMap = {
    base: "z-40",
    nested: "z-50",
    alert: "z-[60]",
    top: "z-[110]",
  };

  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        zIndexMap[zIndex],
        className,
      )}
      {...props}
    />
  );
});
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    zIndex?: "base" | "nested" | "alert" | "top";
    variant?: "default" | "fullscreen";
    overlayClassName?: string;
  }
>(
  (
    {
      className,
      children,
      zIndex = "base",
      variant = "default",
      overlayClassName,
      ...props
    },
    ref,
  ) => {
    const isOpenWrtHostedDialog =
      typeof className === "string" &&
      className.includes("ccswitch-openwrt-provider-ui-dialog");
    const zIndexMap = {
      base: "z-40",
      nested: "z-50",
      alert: "z-[60]",
      top: "z-[110]",
    };
    const positionerZIndexMap = {
      base: "z-[41]",
      nested: "z-[51]",
      alert: "z-[61]",
      top: "z-[111]",
    };

    const positionerClass = {
      default:
        "pointer-events-none fixed inset-0 flex items-start justify-center overflow-y-auto overscroll-contain p-4 sm:items-center sm:p-6",
      fullscreen: "pointer-events-none fixed inset-0",
    }[variant];

    const variantClass = {
      default:
        "relative pointer-events-auto flex max-h-full w-full max-w-lg min-h-0 flex-col overflow-hidden border border-border-default bg-background text-foreground shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg",
      fullscreen:
        "relative pointer-events-auto flex h-full w-full flex-col bg-background p-0 text-foreground shadow-none sm:rounded-none",
    }[variant];

    return (
      <DialogPortal>
        <DialogOverlay
          zIndex={zIndex}
          className={cn(
            isOpenWrtHostedDialog && "ccswitch-openwrt-provider-ui-overlay",
            overlayClassName,
          )}
        />
        <div
          className={cn(
            positionerClass,
            positionerZIndexMap[zIndex],
            isOpenWrtHostedDialog && "ccswitch-openwrt-provider-ui-positioner",
          )}
        >
          <DialogPrimitive.Content
            ref={ref}
            className={cn(variantClass, zIndexMap[zIndex], className)}
            onInteractOutside={(e) => {
              // 防止点击遮罩层关闭对话框
              e.preventDefault();
            }}
            {...props}
          >
            {children}
          </DialogPrimitive.Content>
        </div>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left px-6 py-5 border-b border-border-default bg-muted/20 flex-shrink-0",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:items-center px-6 py-5 border-t border-border-default bg-muted/20 flex-shrink-0",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-tight tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
};
