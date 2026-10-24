import * as RCheckbox from '@radix-ui/react-checkbox'
import * as RSwitch from '@radix-ui/react-switch'
import { Check, Minus } from 'lucide-react'
import { useId } from 'react'

export function Checkbox({
  label, checked, onCheckedChange, disabled, hideLabel,
}: { label: string; checked: boolean | 'indeterminate'; onCheckedChange: (v: boolean) => void; disabled?: boolean; hideLabel?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <RCheckbox.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="flex size-4 shrink-0 items-center justify-center rounded-xs border border-border-input bg-bg
          data-[state=checked]:border-accent data-[state=checked]:bg-accent
          data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent
          disabled:opacity-50"
      >
        <RCheckbox.Indicator className="text-on-accent">
          {checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-sm text-text select-none'}>{label}</label>
    </div>
  )
}

export function Switch({
  label, checked, onCheckedChange, disabled,
}: { label: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <RSwitch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="relative h-5 w-9 shrink-0 rounded-pill border border-border-input bg-surface-sunken transition-colors
          data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-pill bg-bg shadow-card transition-transform data-[state=checked]:translate-x-[17px]" />
      </RSwitch.Root>
      <label htmlFor={id} className="text-sm text-text select-none">{label}</label>
    </div>
  )
}
