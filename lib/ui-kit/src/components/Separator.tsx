import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";

import { cn } from "../lib/utils";
import {
  SEPARATOR_DEFAULT_DECORATIVE,
  SEPARATOR_DEFAULT_ORIENTATION,
  SEPARATOR_ORIENTATION_CLASSNAMES,
} from "../constants/separator.js";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    {
      className,
      orientation = SEPARATOR_DEFAULT_ORIENTATION,
      decorative = SEPARATOR_DEFAULT_DECORATIVE,
      ...props
    },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn("shrink-0 bg-border", SEPARATOR_ORIENTATION_CLASSNAMES[orientation], className)}
      {...props}
    />
  )
);
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
