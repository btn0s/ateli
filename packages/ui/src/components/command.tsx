"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"

import { cn } from "@workspace/ui/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "@workspace/ui/components/input-group"
import { SearchIcon, CheckIcon } from "lucide-react"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-none bg-popover text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-none p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  leading,
  trailing,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  leading?: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <div data-slot="command-input-wrapper" className="ateli-surface-input-stripe pb-0">
      <InputGroup className="ateli-skeuo-input-dish h-9 min-h-9 rounded-md border border-border/15 bg-input/20 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
        <InputGroupAddon align="inline-start">
          {leading ?? (
            <SearchIcon className="size-4 shrink-0 text-muted-foreground/55" />
          )}
        </InputGroupAddon>
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full text-xs tracking-tight text-foreground/95 outline-hidden placeholder:text-muted-foreground/65 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        {trailing ? (
          <InputGroupAddon align="inline-end">
            {trailing}
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar flex max-h-72 flex-col gap-0.5 scroll-py-1.5 overflow-x-hidden overflow-y-auto px-1.5 py-1.5 outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-pretty text-xs", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden text-foreground **:[[cmdk-group-heading]]:px-0.5 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-[0.65rem] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-wider **:[[cmdk-group-heading]]:text-balance **:[[cmdk-group-heading]]:text-muted-foreground/80",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("ateli-skeuo-divider -mx-0.5 my-0.5", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex min-h-10 w-full cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-xs leading-snug -outline-offset-1 outline-hidden transition-[background-color,color,opacity,transform] duration-100 ease-out motion-reduce:transition-none in-data-[slot=dialog-content]:rounded-md! data-[disabled=true]:pointer-events-none data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 data-selected:bg-muted/90 data-selected:text-foreground data-selected:ring-1 data-selected:ring-inset data-selected:ring-ring/20 data-selected:active:bg-muted active:scale-[0.96] active:bg-muted/50 data-[disabled=true]:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs tabular-nums tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
