"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@football-app/ui";
import { buttonVariants } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// "select2-style" — search-as-you-type dropdown thay Select thường (2026-08-20, xem
// /admin/team-statistics), dùng chung 1 pattern cho single-select (đây) và multi-select
// (MultiCombobox.tsx cùng thư mục). `search`/`onSearchChange` do CALLER sở hữu (thường dùng để
// gọi lại API `search=` param, xem apps/api/src/routes/teams.ts|seasons.ts) — component tự
// debounce input gõ tay trước khi gọi `onSearchChange`, tránh gọi API mỗi lần gõ 1 ký tự.
const SEARCH_DEBOUNCE_MS = 300;

export interface ComboboxOption {
  id: string;
  label: string;
  description?: string;
}

export interface ComboboxProps {
  value: string;
  onChange: (id: string) => void;
  options: ComboboxOption[];
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  search,
  onSearchChange,
  placeholder = "Chọn...",
  searchPlaceholder = "Tìm kiếm...",
  emptyText = "Không tìm thấy kết quả nào.",
  loading,
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(search);

  // Đồng bộ lại khi `search` bị đổi TỪ BÊN NGOÀI (vd reset khi season đổi) — không đồng bộ ngược
  // lại mỗi lần gõ (xem debounce effect dưới), tránh 2 effect đè lẫn nhau.
  useEffect(() => {
    setInputValue(search);
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (inputValue !== search) onSearchChange(inputValue);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ cần re-arm khi inputValue đổi, onSearchChange/search đọc qua closure mới nhất mỗi lần gọi lại là đủ
  }, [inputValue]);

  const selected = options.find((option) => option.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "w-full justify-between font-normal",
          !selected && "text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={inputValue}
            onValueChange={setInputValue}
          />
          <CommandList>
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Đang tải...</p>
            ) : (
              <>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={option.id}
                      data-checked={option.id === value}
                      onSelect={() => {
                        onChange(option.id === value ? "" : option.id);
                        setOpen(false);
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{option.label}</span>
                        {option.description ? (
                          <span className="truncate text-xs text-muted-foreground">{option.description}</span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
