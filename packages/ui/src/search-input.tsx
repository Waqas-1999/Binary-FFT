"use client";

import { Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { IconButton } from "./icon-button.tsx";
import { Input, type InputProps } from "./input.tsx";

export interface SearchInputProps extends Omit<InputProps, "type" | "leading" | "trailing" | "defaultValue"> {
  defaultValue?: string;
  /** Called on every change, including when the clear button is used. */
  onValueChange?: (value: string) => void;
}

export function SearchInput({ value, defaultValue = "", onValueChange, onChange, ...props }: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [internal, setInternal] = useState(defaultValue);
  const current = value === undefined ? internal : String(value);

  const update = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <Input
      ref={inputRef}
      type="search"
      autoComplete="off"
      enterKeyHint="search"
      value={current}
      onChange={(event) => {
        onChange?.(event);
        update(event.target.value);
      }}
      leading={<Search />}
      // Hide the browser's own clear button; ours is larger and consistent across browsers.
      className="[&::-webkit-search-cancel-button]:appearance-none"
      {...props}
      trailing={
        current &&
        !props.disabled && (
          <IconButton
            label="Clear search"
            icon={<X />}
            onClick={() => {
              update("");
              inputRef.current?.focus();
            }}
            className="size-10"
          />
        )
      }
    />
  );
}
