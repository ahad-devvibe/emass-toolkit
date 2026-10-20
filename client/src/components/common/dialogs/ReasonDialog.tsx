import { useId, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { FormField } from "../FormField"
import { fieldA11y } from "../form.utils"
import { ConfirmDialog, type ConfirmDialogProps, type ConfirmHandler } from "./ConfirmDialog"

export type ReasonField = { label: string; placeholder?: string; required?: boolean; maxLength?: number; hint?: string }

type ReasonDialogProps = Omit<ConfirmDialogProps, "onConfirm" | "children"> & {
  field: ReasonField
  /** Receives the trimmed text ("" when optional and left blank). */
  onConfirm: (text: string) => ReturnType<ConfirmHandler>
}

/** Confirm dialog that collects a reason / note / feedback before confirming. */
export function ReasonDialog({ field, onConfirm, onOpenChange, ...dialog }: ReasonDialogProps) {
  const id = useId()
  const [text, setText] = useState("")
  const [showError, setShowError] = useState(false)
  const missing = Boolean(field.required) && !text.trim()
  const error = showError && missing ? `${field.label} is required` : undefined

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setText("")
      setShowError(false)
    }
  }

  return (
    <ConfirmDialog
      {...dialog}
      onOpenChange={handleOpenChange}
      onConfirm={() => {
        if (missing) {
          setShowError(true)
          return false
        }
        return onConfirm(text.trim())
      }}
    >
      <FormField
        id={id}
        label={field.label}
        optional={!field.required}
        error={error}
        hint={field.hint}
        labelAside={field.maxLength ? <span className={cn("text-xs tabular-nums text-muted-foreground", text.length >= field.maxLength && "text-destructive")}>{text.length}/{field.maxLength}</span> : undefined}
      >
        <Textarea {...fieldA11y(id, error)} value={text} onChange={(event) => setText(event.target.value)} placeholder={field.placeholder} maxLength={field.maxLength} className="max-h-60 min-h-28" autoFocus />
      </FormField>
    </ConfirmDialog>
  )
}
