import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type FieldConfig =
  | { key: string; label: string; type: "text" }
  | { key: string; label: string; type: "number" }
  | { key: string; label: string; type: "checkbox" }
  | {
      key: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      placeholder?: string;
      /** shadcn/base-ui Select forbids value="" on a SelectItem (reserved as "no selection"
       * internally) — an option meaning "clear this field" needs a real sentinel string instead.
       * AdminResourcePage.tsx maps this sentinel back to "" right before submitting, so the
       * backend still sees a proper clear (empty string -> null, see e.g. teams.ts's Zod schema). */
      noneValue?: string;
    };

export interface ResourceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fields: FieldConfig[];
  values: Record<string, unknown>;
  onValuesChange: (values: Record<string, unknown>) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

/** Generic create/edit form for admin CRUD pages — no delete action wired here on purpose (see
 * ROADMAP Phase 4 note: Competition/Team/Player skip Delete this pass, onDelete: Cascade risk). */
export function ResourceFormDialog({
  open,
  onOpenChange,
  title,
  fields,
  values,
  onValuesChange,
  onSubmit,
  submitting,
  error,
}: ResourceFormDialogProps) {
  function setField(key: string, value: unknown) {
    onValuesChange({ ...values, [key]: value });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="flex flex-col gap-4"
        >
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={field.key}>{field.label}</Label>
              {field.type === "text" ? (
                <Input
                  id={field.key}
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              ) : field.type === "number" ? (
                <Input
                  id={field.key}
                  type="number"
                  value={values[field.key] == null ? "" : String(values[field.key])}
                  onChange={(e) => setField(field.key, e.target.value === "" ? null : Number(e.target.value))}
                />
              ) : field.type === "checkbox" ? (
                <input
                  id={field.key}
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(e) => setField(field.key, e.target.checked)}
                  className="h-4 w-4 self-start"
                />
              ) : (
                <Select
                  value={(values[field.key] as string) ?? undefined}
                  onValueChange={(value) => setField(field.key, value)}
                >
                  <SelectTrigger id={field.key} className="w-full">
                    <SelectValue placeholder={field.placeholder ?? "Chọn..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
