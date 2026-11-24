"use client";
// <select> that submits its parent GET form on change (filters on server-rendered pages).
export function FilterSelect({ name, value, options, label, className }: { name: string; value: string; options: { value: string; label: string }[]; label: string; className?: string }) {
  return (
    <label className={className}>
      <span className="label">{label}</span>
      <select name={name} defaultValue={value} className="input h-10 py-1.5 sm:h-9" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
