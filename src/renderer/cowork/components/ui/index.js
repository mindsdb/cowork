// Single import surface for the cowork UI primitives.
//
//   import { Button, Input, Card, Dialog, Menu, Tooltip } from '../components/ui';

// Core components (CSS-class based — stable, use these)
export { default as Button } from './Button.jsx';
export { default as Input, Textarea } from './Input.jsx';
export { default as Card, Bubble } from './Card.jsx';
export { default as Eyebrow } from './Eyebrow.jsx';
export { default as Pill } from './Pill.jsx';
export { default as Spinner } from './Spinner.jsx';
export { default as OrbitMorph } from './OrbitMorph.jsx';

// Radix-based interactive primitives (Tailwind-styled)
export { Dialog, DialogHeader, DialogBody, DialogFooter, DialogClose, DialogTrigger } from './Dialog.jsx';
export { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, MenuLabel, MenuSub, MenuSubTrigger, MenuSubContent } from './Menu.jsx';
export { Tooltip, TooltipProvider } from './Tooltip.jsx';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs.jsx';
export { default as Switch } from './Switch.jsx';
export { Popover, PopoverTrigger, PopoverContent, PopoverClose, PopoverAnchor } from './Popover.jsx';

// Utility
export { cn } from './cn.js';
