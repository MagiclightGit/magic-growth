import type { ComponentProps } from 'react';
import { Input } from './ui/input';
export function Field({
  label,
  ...props
}: { label: string } & ComponentProps<typeof Input>) {
  return (
    <label className="block space-y-2 text-sm">
      <span>{label}</span>
      <Input {...props} />
    </label>
  );
}
export function SelectField({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Record<string, string>;
  defaultValue?: string;
}) {
  return (
    <label className="block space-y-2 text-sm">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
      >
        {Object.entries(options).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
