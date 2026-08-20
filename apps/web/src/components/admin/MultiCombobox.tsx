"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { cn } from "@football-app/ui";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ComboboxOption } from "./Combobox";

const SEARCH_DEBOUNCE_MS = 300;

export interface MultiComboboxProps {
  value: string[];
  onChange: (ids: string[]) => void;
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

/**
 * Multi-select "select2-style" — cùng pattern Combobox.tsx nhưng chọn được nhiều item, KHÔNG
 * đóng popover sau mỗi lần chọn (cho phép tick liên tục nhiều đội), hiện lại các item đã chọn
 * dưới dạng badge có thể bỏ ngay (không cần mở lại popover). `options` chỉ cần chứa item hiện tại
 * đang fetch được (search-scoped) — item đã chọn nhưng rớt khỏi `options` (vd đổi search text)
 * vẫn giữ nguyên trong `value`, chỉ mất label hiển thị ở badge (hiếm khi xảy ra vì đổi season sẽ
 * reset `value`, xem trang gọi component này).
 */
export function MultiCombobox({
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
}: MultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(search);
  // Đồng bộ lại khi `search` bị đổi TỪ BÊN NGOÀI (vd reset khi season đổi) — cập nhật NGAY LÚC
  // RENDER (KHÔNG qua useEffect, tránh setState-trong-effect gây thêm 1 vòng render thừa), theo
  // đúng pattern React khuyến nghị cho "adjust state when a prop changes"
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [prevSearch, setPrevSearch] = useState(search);
  if (search !== prevSearch) {
    setPrevSearch(search);
    setInputValue(search);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (inputValue !== search) onSearchChange(inputValue);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ cần re-arm khi inputValue đổi
  }, [inputValue]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((existing) => existing !== id) : [...value, id]);
  }

  function remove(id: string) {
    onChange(value.filter((existing) => existing !== id));
  }

  const selectedOptions = value.map((id) => options.find((option) => option.id === id)).filter(Boolean) as ComboboxOption[];
  const selectedLabelById = new Map(selectedOptions.map((option) => [option.id, option.label]));

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "w-full justify-between font-normal",
            value.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {value.length === 0 ? placeholder : `${value.length} đội đã chọn`}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={searchPlaceholder} value={inputValue} onValueChange={setInputValue} />
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
                        data-checked={value.includes(option.id)}
                        onSelect={() => toggle(option.id)}
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

      {selectedOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1">
              {selectedLabelById.get(id) ?? id}
              <button
                type="button"
                onClick={() => remove(id)}
                aria-label={`Bỏ chọn ${selectedLabelById.get(id) ?? id}`}
                className="rounded-full p-0.5 hover:bg-foreground/10"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
